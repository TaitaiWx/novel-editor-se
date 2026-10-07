import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** 仓库根目录（packages/core/test → 上三级） */
const ROOT = path.resolve(__dirname, '../../..');

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
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
  return files;
}

/** 正则字面量与 RegExp(...) 的字符串参数里出现的非 ASCII 字符（汉字、全角标点等） */
function findOffenders(file: string): string[] {
  const text = readFileSync(file, 'utf-8');
  if (!/[^\x00-\x7f]/.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];
  const report = (node: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    offenders.push(`${path.relative(ROOT, file)}:${line + 1}`);
  };
  const visit = (node: ts.Node) => {
    if (
      node.kind === ts.SyntaxKind.RegularExpressionLiteral &&
      /[^\x00-\x7f]/.test(node.getText(sf))
    ) {
      report(node);
    }
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'RegExp' &&
      node.arguments?.[0] &&
      /[^\x00-\x7f]/.test(node.arguments[0].getText(sf))
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offenders;
}

describe('禁止按汉字做判断', () => {
  it('源码里的正则不直接写汉字 / 全角字符（需要时用 \\uXXXX 转义）', () => {
    const offenders = sourceFiles().flatMap(findOffenders);
    expect(offenders).toEqual([]);
  });
});
