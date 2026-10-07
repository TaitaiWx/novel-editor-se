import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDER_ROOT = path.resolve(__dirname, '../../../src/render');
// 只有这两个抽象组件内部允许出现真实的 checkbox
const ALLOWED_DIRS = ['components/Checkbox', 'components/Switch'].map((dir) =>
  path.join(RENDER_ROOT, dir)
);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const full = path.join(dir, name);
    if (ALLOWED_DIRS.some((allowed) => full === allowed)) return [];
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

describe('复选框统一使用抽象组件', () => {
  it('渲染进程组件不直接使用原生 <input type="checkbox">（请用 components/Checkbox 或 Switch）', () => {
    const offenders = tsxFiles(RENDER_ROOT).flatMap((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /type=\s*\{?\s*["'`]checkbox["'`]/.test(line))
        .map(({ index }) => `${path.relative(process.cwd(), file)}:${index + 1}`)
    );
    expect(offenders).toEqual([]);
  });

  it('扫描范围确实包含组件目录', () => {
    expect(tsxFiles(RENDER_ROOT).length).toBeGreaterThan(50);
  });
});
