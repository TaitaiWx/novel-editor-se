import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** 仓库根目录（packages/core/test → 上三级） */
const ROOT = path.resolve(__dirname, '../../..');

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const { name } = entry;
      if (name === 'node_modules' || name === 'dist') continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
    }
  };
  for (const app of ['apps/pc/src', 'apps/cli/src']) walk(path.join(ROOT, app));
  for (const pkg of readdirSync(path.join(ROOT, 'packages'))) {
    const src = path.join(ROOT, 'packages', pkg, 'src');
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      // 没有 src 的包
    }
  }
  return files.sort();
}

/** 正则字面量与 RegExp(...) 的字符串参数里出现的非 ASCII 字符（汉字、全角标点等） */
function findOffenders(file: string): string[] {
  const text = readFileSync(file, 'utf-8');
  if (!/\P{ASCII}/u.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];
  const report = (node: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    offenders.push(`${path.relative(ROOT, file)}:${line + 1}`);
  };
  const visit = (node: ts.Node) => {
    if (
      node.kind === ts.SyntaxKind.RegularExpressionLiteral &&
      /\P{ASCII}/u.test(node.getText(sf))
    ) {
      report(node);
    }
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'RegExp' &&
      node.arguments?.[0] &&
      /\P{ASCII}/u.test(node.arguments[0].getText(sf))
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offenders;
}

// Scan the complete source tree, but bound each synchronous AST task. One test for the
// entire growing repository can exceed Vitest's per-test limit on shared CI runners.
const files = sourceFiles();
const batches = Array.from({ length: Math.ceil(files.length / 32) }, (_, index) => ({
  batch: index + 1,
  files: files.slice(index * 32, (index + 1) * 32),
}));

describe('禁止按汉字做判断', () => {
  it.each(batches)(
    '源码正则不直接写汉字 / 全角字符（需要时用 \\uXXXX 转义）批次 $batch',
    ({ files }) => {
      expect(files.flatMap(findOffenders)).toEqual([]);
    }
  );
});
