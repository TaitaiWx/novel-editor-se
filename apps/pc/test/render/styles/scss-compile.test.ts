/**
 * 所有 SCSS 都能编译：单测不处理 CSS，样式错误原本要到构建 / E2E 才暴露，这里提前拦截
 */
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PC_ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(PC_ROOT, 'src');

type SassModule = { compile: (file: string, options: { loadPaths: string[] }) => unknown };
const sass = createRequire(path.join(PC_ROOT, 'package.json'))('sass') as SassModule;

function collectScss(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : collectScss(full);
    // 以 _ 开头的是 partial，由引用它的文件一起编译
    return entry.name.endsWith('.scss') && !entry.name.startsWith('_') ? [full] : [];
  });
}

describe('SCSS 编译', () => {
  const files = collectScss(SRC);

  it('找到了样式文件', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((file) => [path.relative(SRC, file), file]))('%s', (_name, file) => {
    expect(() => sass.compile(file, { loadPaths: [path.dirname(file), SRC] })).not.toThrow();
  });
});
