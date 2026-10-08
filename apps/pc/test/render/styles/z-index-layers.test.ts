import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDER = path.resolve(__dirname, '../../../src/render');

function scssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return scssFiles(full);
    return name.endsWith('.scss') ? [full] : [];
  });
}

function token(name: string): number {
  const global = readFileSync(path.join(RENDER, 'styles/global.scss'), 'utf-8');
  const match = new RegExp(`--${name}:\\s*(\\d+)`).exec(global);
  if (!match) throw new Error(`global.scss 缺少 --${name}`);
  return Number(match[1]);
}

describe('浮层层级', () => {
  it('浮层 / toast / 悬停提示的层级依次升高', () => {
    expect(token('z-floating')).toBeLessThan(token('z-toast'));
    expect(token('z-toast')).toBeLessThan(token('z-tooltip'));
    expect(token('z-tooltip')).toBeLessThan(token('z-blocking'));
  });

  it('任何组件写死的 z-index 都低于浮层：弹窗里打开的下拉列表 / 右键菜单 / 弹出面板不会被遮住', () => {
    const floating = token('z-floating');
    const offenders = scssFiles(path.join(RENDER, 'components')).flatMap((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => {
          const match = /z-index:\s*(\d+)/.exec(line);
          return match ? Number(match[1]) >= floating : false;
        })
        .map(({ index }) => `${path.relative(RENDER, file)}:${index + 1}`)
    );
    expect(offenders).toEqual([]);
  });

  it('下拉列表、右键菜单、弹出面板、悬停提示使用层级变量', () => {
    const uses = (relative: string, variable: string) =>
      readFileSync(path.join(RENDER, relative), 'utf-8').includes(`var(--${variable})`);
    expect(uses('components/Select/styles.module.scss', 'z-floating')).toBe(true);
    expect(uses('components/ContextMenu/styles.module.scss', 'z-floating')).toBe(true);
    expect(uses('components/Popover/styles.module.scss', 'z-floating')).toBe(true);
    expect(uses('components/Tooltip/styles.module.scss', 'z-tooltip')).toBe(true);
    expect(uses('components/Toast/styles.module.scss', 'z-toast')).toBe(true);
  });
});
