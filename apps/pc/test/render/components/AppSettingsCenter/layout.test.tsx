// @vitest-environment happy-dom
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from '@/render/components/AppSettingsCenter/layout';
import AiSection from '@/render/components/AppSettingsCenter/AiSection';
import { DEFAULT_AI_SETTINGS } from '@/render/utils/appSettings';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

afterEach(() => {
  uninstallElectronMock();
});

describe('设置中心版式：SettingsSection / SettingsGroup / SettingsRow', () => {
  it('分区头：图标 + 标题 + 一行说明', () => {
    render(
      <SettingsSection icon={<svg data-testid="icon" />} title="通用设置" description="一行说明">
        <div>内容</div>
      </SettingsSection>
    );
    const heading = screen.getByRole('heading', { level: 4, name: '通用设置' });
    expect(within(heading).getByTestId('icon')).toBeTruthy();
    expect(screen.getByText('一行说明').tagName).toBe('P');
    expect(heading.closest('[data-settings-section]')).toBeTruthy();
    expect(screen.getByText('内容')).toBeTruthy();
  });

  it('有标题的分组是以标题命名的区域；附注与说明显示在标题旁 / 下方；没有标题时是普通容器', () => {
    const { container } = render(
      <>
        <SettingsGroup title="界面" description="分组说明" meta="默认：A" data-testid="g1">
          <SettingsRow label="行 1" />
        </SettingsGroup>
        <SettingsGroup data-testid="g2">
          <SettingsRow label="行 2" />
        </SettingsGroup>
        <SettingsGroup aria-label="具名" data-testid="g3" />
      </>
    );
    const group = screen.getByRole('region', { name: '界面' });
    expect(group.getAttribute('data-testid')).toBe('g1');
    expect(within(group).getByText('分组说明')).toBeTruthy();
    expect(within(group).getByText('默认：A')).toBeTruthy();
    expect(screen.getByTestId('g2').tagName).toBe('DIV');
    expect(screen.getByRole('region', { name: '具名' })).toBeTruthy();
    expect(container.querySelectorAll('[data-settings-group]')).toHaveLength(3);
  });

  it('行：左侧标签 / 说明 / 补充内容，右侧控件；对齐、控件宽度与语气通过类名区分', () => {
    render(
      <>
        <SettingsRow
          label="显示状态栏"
          description="底部状态栏"
          extra={<span>补充</span>}
          data-testid="r1"
        >
          <button type="button">开关</button>
        </SettingsRow>
        <SettingsRow label="阈值" control="field" align="start" tone="danger" data-testid="r2">
          <input aria-label="阈值" />
        </SettingsRow>
        <SettingsRow label="只读" data-testid="r3" />
      </>
    );
    const r1 = screen.getByTestId('r1');
    expect(r1.hasAttribute('data-settings-row')).toBe(true);
    expect(r1.getAttribute('data-tone')).toBe('default');
    expect(within(r1).getByText('底部状态栏')).toBeTruthy();
    expect(within(r1).getByText('补充')).toBeTruthy();
    expect(within(r1).getByRole('button', { name: '开关' }).parentElement?.className).toContain(
      'rowControl'
    );

    const r2 = screen.getByTestId('r2');
    expect(r2.className).toContain('rowField');
    expect(r2.className).toContain('rowStart');
    expect(r2.className).toContain('rowDanger');
    expect(r2.getAttribute('data-tone')).toBe('danger');

    // 没有控件时不渲染控件列
    expect(screen.getByTestId('r3').querySelector('[class*="rowControl"]')).toBeNull();
  });

  it('强调 / 提醒语气', () => {
    render(
      <>
        <SettingsRow label="A" tone="emphasis" data-testid="a" />
        <SettingsRow label="B" tone="attention" data-testid="b" />
      </>
    );
    expect(screen.getByTestId('a').className).toContain('rowEmphasis');
    expect(screen.getByTestId('b').className).toContain('rowAttention');
  });
});

describe('设置中心「AI」总开关', () => {
  function renderAi(enabled: boolean) {
    installElectronMock((channel) => {
      if (channel === 'ai-providers-list') return { ok: true, data: [] };
      if (channel === 'video-settings-get') return { ok: true, data: {} };
      return { ok: true, data: null };
    });
    const setSettings = vi.fn();
    render(
      <AiSection aiSettings={{ ...DEFAULT_AI_SETTINGS, enabled }} setSettings={setSettings} />
    );
    return { setSettings, row: screen.getByTestId('ai-master-row') };
  }

  it('打开时：强调行（强调色标签 + 底纹），大号开关，没有关闭提示', () => {
    const { row } = renderAi(true);
    expect(row.className).toContain('rowEmphasis');
    expect(row.getAttribute('data-tone')).toBe('emphasis');
    const master = within(row).getByRole('switch', { name: '启用 AI 功能' }) as HTMLInputElement;
    expect(master.checked).toBe(true);
    expect(master.closest('label')?.className).toContain('lg');
    expect(within(row).queryByText('已关闭：AI 功能不会发送请求')).toBeNull();
  });

  it('关闭时：提醒行（强调色描边）并提示「已关闭：AI 功能不会发送请求」', () => {
    const { row, setSettings } = renderAi(false);
    expect(row.className).toContain('rowAttention');
    expect(row.className).not.toContain('rowEmphasis');
    expect(within(row).getByText('已关闭：AI 功能不会发送请求')).toBeTruthy();
    fireEvent.click(within(row).getByRole('switch', { name: '启用 AI 功能' }));
    expect(setSettings).toHaveBeenCalledOnce();
  });

  it('总开关不在任何能力分组里，能力分组各自是一个分组（之间用分隔线）', () => {
    const { row } = renderAi(true);
    expect(row.closest('[data-testid^="ai-section-"]')).toBeNull();
    for (const capability of ['text', 'image', 'video', 'speech']) {
      expect(
        screen.getByTestId(`ai-section-${capability}`).hasAttribute('data-settings-group')
      ).toBe(true);
    }
  });
});

// ─── 样式守卫：设置中心不再用带边框的卡片包住分组 / 行 ───────────────────

const SETTINGS_DIR = path.resolve(__dirname, '../../../../src/render/components/AppSettingsCenter');

/** 已删除的卡片 / 盒子类名，不得再出现在设置中心的样式里 */
const REMOVED_BOX_CLASSES = [
  'formSection',
  'statusCard',
  'specCard',
  'comingSoon',
  'dataCard',
  'dataCardDanger',
  'dataConfirmBox',
  'readonlyShortcutItem',
  'readonlyShortcutList',
  'switchButton',
  'masterRow',
  'capabilityHeader',
];

function scssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return scssFiles(full);
    return name.endsWith('.scss') ? [full] : [];
  });
}

/** 取出某个类的规则体（只看第一层花括号，足够检查 border 声明） */
function ruleBody(source: string, className: string): string | null {
  const start = source.search(new RegExp(`(^|\\n)\\.${className}\\s*\\{`));
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

describe('设置中心样式守卫', () => {
  it('旧的卡片 / 盒子类名已删除', () => {
    const offenders = scssFiles(SETTINGS_DIR).flatMap((file) => {
      const source = readFileSync(file, 'utf-8');
      return REMOVED_BOX_CLASSES.filter((name) =>
        new RegExp(`\\.${name}(?![A-Za-z0-9_-])`).test(source)
      ).map((name) => `${path.relative(SETTINGS_DIR, file)}: .${name}`);
    });
    expect(offenders).toEqual([]);
  });

  it('分区 / 分组 / 行容器没有 border 盒子：只有组与组、行与行之间的 border-top 分隔线', () => {
    const source = readFileSync(path.join(SETTINGS_DIR, 'layout/styles.module.scss'), 'utf-8');
    for (const name of ['section', 'group', 'row', 'rowEmphasis', 'rowAttention']) {
      const body = ruleBody(source, name);
      expect(body, `.${name}`).not.toBeNull();
      // 去掉嵌套的 `& + &` 分隔线规则后，容器本身不能声明 border
      const own = (body ?? '').replace(/&[^{]*\{[^}]*\}/g, '');
      expect(own, `.${name}`).not.toMatch(/(^|\n)\s*border(-(left|right|bottom))?\s*:/);
    }
    expect(source).toMatch(/& \+ & \{\s*border-top: 1px solid var\(--ui-border-subtle\)/);
  });
});
