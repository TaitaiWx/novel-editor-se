import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [
  path.resolve(__dirname, '../../../src/render'),
  path.resolve(__dirname, '../../../../../packages'),
];

function styleFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return styleFiles(full);
    return /\.(scss|css)$/.test(name) ? [full] : [];
  });
}

describe('多行输入框不显示右下角拖拽手柄', () => {
  it('全局样式禁止 textarea 拖拽调整大小', () => {
    const global = readFileSync(path.join(ROOTS[0], 'styles/global.scss'), 'utf-8');
    expect(global).toMatch(/textarea\s*\{[^}]*resize:\s*none/);
  });

  it('任何组件样式都不重新打开 resize', () => {
    const offenders = ROOTS.flatMap(styleFiles).flatMap((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), index }))
        .filter(({ line }) => /^resize:(?!\s*none)/.test(line))
        .map(({ index }) => `${path.relative(process.cwd(), file)}:${index + 1}`)
    );
    expect(offenders).toEqual([]);
  });
});
