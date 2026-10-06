// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { applyGrowthEvent, createSheet } from '@novel-editor/core/growth';
import { GrowthView } from '@/render/components/RightPanel/GrowthView';
import {
  GROWTH_GUIDE_SECTIONS,
  GROWTH_QUICK_START,
  GROWTH_TOUR_STEPS,
  GROWTH_TOUR_STORAGE_KEY,
} from '@/render/components/RightPanel/GrowthView/growthGuide';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';
import { FOLDER, buildSnapshot, createGrowthBackend } from './fixtures';

const HELP = { name: '成长档案使用说明' };

beforeEach(() => {
  window.localStorage.setItem(GROWTH_TOUR_STORAGE_KEY, '1');
});

afterEach(() => {
  uninstallElectronMock();
  window.localStorage.clear();
});

function withTwoCharacters() {
  const base = buildSnapshot();
  const ruleset = base.ruleset;
  // 白芷一章连升 3 级：触发「偏快」提醒
  const baizhi = applyGrowthEvent(ruleset, createSheet(ruleset, '白芷'), {
    type: 'exp',
    delta: 2700,
    chapter: 9,
  }).sheet;
  return buildSnapshot({ sheets: [...base.sheets, baizhi] });
}

describe('成长档案总览', () => {
  it('卡片网格：名字、等级、经验条、最近章节与提醒圆点', async () => {
    installElectronMock(createGrowthBackend(withTwoCharacters()).handle);
    const onNavigate = vi.fn();
    render(
      <GrowthView
        folderPath={FOLDER}
        dbReady={false}
        onNavigateCharacter={onNavigate}
        onCreateSheet={vi.fn()}
      />
    );
    expect(await screen.findByRole('heading', { level: 1, name: '成长档案' })).toBeTruthy();
    expect(screen.getByText('2 个角色')).toBeTruthy();
    const al = screen.getByRole('button', { name: '打开 阿尔 的成长卡' });
    expect(al.textContent).toContain('Lv.2');
    expect(al.textContent).toContain('距下一级 500');
    expect(al.textContent).toContain('最近 第 3 章');
    expect(within(al).queryByLabelText(/处需要留意/)).toBeNull();
    const bz = screen.getByRole('button', { name: '打开 白芷 的成长卡' });
    expect(bz.textContent).toContain('Lv.4');
    expect(within(bz).getByLabelText('1 处需要留意')).toBeTruthy();
    // 汇总横幅带角色名
    const banner = screen.getByRole('region', { name: '需要留意' });
    fireEvent.click(within(banner).getByRole('button', { name: /需要留意/ }));
    expect(within(banner).getByText(/白芷：第 9 章连升 3 级/)).toBeTruthy();

    fireEvent.click(bz);
    expect(onNavigate).toHaveBeenCalledWith('白芷');
    // 世界分区：队伍 / 地图 / 规则
    fireEvent.click(screen.getByRole('tab', { name: '世界' }));
    expect(await screen.findByText('组队历史')).toBeTruthy();
  });

  it('首次使用的空状态：新建成长卡与查看使用说明', async () => {
    installElectronMock(createGrowthBackend(buildSnapshot({ sheets: [] })).handle);
    const onCreateSheet = vi.fn();
    render(<GrowthView folderPath={FOLDER} dbReady={false} onCreateSheet={onCreateSheet} />);
    const empty = await screen.findByRole('region', { name: '还没有成长卡' });
    fireEvent.click(within(empty).getByRole('button', { name: '+ 新建成长卡' }));
    expect(onCreateSheet).toHaveBeenCalledWith({});
    fireEvent.click(within(empty).getByRole('button', { name: '查看使用说明' }));
    expect(screen.getByRole('dialog', HELP)).toBeTruthy();
  });

  it('记忆库未创建时先选规则模板，「开始使用」创建记忆库', async () => {
    const electron = installElectronMock(
      createGrowthBackend(buildSnapshot({ initialized: false, sheets: [] })).handle
    );
    render(<GrowthView folderPath={FOLDER} dbReady={false} />);
    const setup = await screen.findByRole('region', { name: '开始使用成长档案' });
    fireEvent.click(within(setup).getByRole('radio', { name: /空白规则/ }));
    fireEvent.click(within(setup).getByRole('button', { name: '使用说明' }));
    expect(screen.getByRole('dialog', HELP)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('关闭使用说明'));
    fireEvent.click(within(setup).getByRole('button', { name: '开始使用' }));
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith('growth-init', FOLDER, 'blank')
    );
    expect(await screen.findByRole('region', { name: '还没有成长卡' })).toBeTruthy();
  });
});

describe('使用说明', () => {
  it('从成长卡的「?」与「⋯」菜单都能打开，章节齐全，Esc 关闭', async () => {
    installElectronMock(createGrowthBackend().handle);
    render(<GrowthView folderPath={FOLDER} dbReady={false} initialCharacter="阿尔" />);
    fireEvent.click(await screen.findByRole('button', { name: '使用说明' }));
    const dialog = screen.getByRole('dialog', HELP);
    // 默认只展开「3 步上手」，进阶说明折叠为摘要行
    expect(within(dialog).getByRole('heading', { level: 3, name: '3 步上手' })).toBeTruthy();
    for (const step of GROWTH_QUICK_START) expect(dialog.textContent).toContain(step);
    for (const section of GROWTH_GUIDE_SECTIONS) {
      const details = dialog.querySelector(`#growth-guide-${section.id}`);
      expect(details?.tagName, section.id).toBe('DETAILS');
      expect((details as HTMLDetailsElement).open, section.id).toBe(false);
      expect(details?.querySelector('summary')?.textContent).toBe(section.title);
    }
    expect(dialog.textContent).toContain('林舟');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', HELP)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '使用说明' }));
    expect(screen.getByRole('dialog', HELP)).toBeTruthy();
  });

  it('右侧面板摘要的「?」也能打开', async () => {
    installElectronMock(createGrowthBackend().handle);
    render(<GrowthView folderPath={FOLDER} dbReady={false} content="" />);
    fireEvent.click(await screen.findByRole('button', { name: '使用说明' }));
    expect(screen.getByRole('dialog', HELP)).toBeTruthy();
  });
});

describe('首次引导', () => {
  it('第一次打开成长卡时显示，跳过后不再出现，可从使用说明重新打开', async () => {
    window.localStorage.removeItem(GROWTH_TOUR_STORAGE_KEY);
    installElectronMock(createGrowthBackend().handle);
    const view = render(<GrowthView folderPath={FOLDER} dbReady={false} initialCharacter="阿尔" />);
    const first = await screen.findByRole('dialog', {
      name: `引导 1/${GROWTH_TOUR_STEPS.length}：${GROWTH_TOUR_STEPS[0].title}`,
    });
    fireEvent.click(within(first).getByRole('button', { name: '下一步' }));
    const second = screen.getByRole('dialog', { name: new RegExp(`^引导 2/`) });
    expect(second.textContent).toContain(GROWTH_TOUR_STEPS[1].title);
    fireEvent.click(within(second).getByRole('button', { name: '跳过' }));
    expect(screen.queryByRole('dialog', { name: /^引导/ })).toBeNull();
    expect(window.localStorage.getItem(GROWTH_TOUR_STORAGE_KEY)).toBe('1');

    view.unmount();
    render(<GrowthView folderPath={FOLDER} dbReady={false} initialCharacter="阿尔" />);
    fireEvent.click(await screen.findByRole('button', { name: '使用说明' }));
    expect(screen.queryByRole('dialog', { name: /^引导/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新查看引导' }));
    expect(screen.queryByRole('dialog', HELP)).toBeNull();
    const again = screen.getByRole('dialog', { name: /^引导 1\// });
    // 走完全部步骤后记为已看过
    for (let i = 0; i < GROWTH_TOUR_STEPS.length - 1; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    }
    expect(again).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(screen.queryByRole('dialog', { name: /^引导/ })).toBeNull();
  });
});

describe('首次使用', () => {
  it('记忆库未创建时总览显示开始引导', async () => {
    installElectronMock(
      createGrowthBackend(buildSnapshot({ initialized: false, sheets: [] })).handle
    );
    render(<GrowthView folderPath={FOLDER} dbReady={false} />);
    expect(await screen.findByRole('region', { name: '开始使用成长档案' })).toBeTruthy();
  });
});
