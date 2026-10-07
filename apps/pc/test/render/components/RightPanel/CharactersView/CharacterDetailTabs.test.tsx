// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  CHARACTER_DETAIL_TABS,
  CharacterDetailWorkspace,
} from '@/render/components/RightPanel/CharactersView/CharacterDetailWorkspace';
import type { Character } from '@/render/components/RightPanel/types';
import type { CharacterTimelineController } from '@/render/components/RightPanel/CharactersView/useCharacterTimeline';
import type { CharacterCurrentStateController } from '@/render/components/RightPanel/CharactersView/useCharacterCurrentState';
import { clearAvatarCache } from '@/render/utils/characterAvatar';
import { installElectronMock, uninstallElectronMock } from '../../../hooks/electronMock';

const linZhou: Character = {
  id: 1,
  name: '林舟',
  role: '主角',
  category: 'major',
  description: '青石镇长大的少年',
  currentState: [],
  design: { appearance: '黑发', personality: '', background: '', speech: '', outfit: '' },
  media: [
    {
      id: 'm1',
      path: '资料/图集/人物/林舟/a.png',
      kind: 'turnaround',
      source: 'ai',
      createdAt: '2026-10-07T00:00:00.000Z',
    },
  ],
};

function renderDetail(
  overrides: Partial<React.ComponentProps<typeof CharacterDetailWorkspace>> = {}
) {
  installElectronMock((channel) => {
    if (channel === 'ai-providers-list') return { ok: true, data: [] };
    if (channel === 'read-file-binary') return { base64Content: 'AAAA', mimeType: 'image/png' };
    return null;
  });
  const update = vi.fn(async () => undefined);
  render(
    <CharacterDetailWorkspace
      focusedCharacter={linZhou}
      focusedCamp="protagonist"
      focusedHeat={3}
      focusedTimeline={[]}
      focusedTimelineEditedCount={0}
      selectedRelations={[]}
      characters={[linZhou]}
      novelCorpusFileCount={0}
      novelCorpusLoading={false}
      novelCorpusError=""
      timeline={{} as CharacterTimelineController}
      currentState={{} as CharacterCurrentStateController}
      handleUpdateCharacterAttributes={update}
      graphView={<div />}
      growthLevel={4}
      workPath="/w"
      {...overrides}
    />
  );
  return { update };
}

afterEach(() => {
  uninstallElectronMock();
  clearAvatarCache();
});

describe('人物详情分页（人物设计 / 图集 / 成长档案 / 经历 / 关系）', () => {
  it('分页齐全，计数显示在分页上；默认「人物设计」，失焦保存设计字段', async () => {
    const { update } = renderDetail();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '人物设计',
      '图集1',
      '成长档案Lv.4',
      '经历与状态',
      '关系与高亮',
    ]);
    expect(CHARACTER_DETAIL_TABS).toHaveLength(5);
    const design = screen.getByTestId('character-design');
    expect((within(design).getByLabelText('人物外貌') as HTMLTextAreaElement).value).toBe('黑发');
    const personality = within(design).getByLabelText('人物性格');
    fireEvent.change(personality, { target: { value: ' 嘴硬心软 ' } });
    fireEvent.blur(personality);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(1, {
        design: {
          appearance: '黑发',
          personality: '嘴硬心软',
          background: '',
          speech: '',
          outfit: '',
        },
      })
    );
    // 未变化的字段失焦不保存
    update.mockClear();
    fireEvent.blur(within(design).getByLabelText('人物外貌'));
    expect(update).not.toHaveBeenCalled();
    // 简介（资料摘要）在设计分页里
    expect(
      within(screen.getByRole('tabpanel', { name: '人物设计' })).getByText('青石镇长大的少年')
    ).toBeTruthy();
  });

  it('点击形象图打开图集分页；成长档案分页嵌入该人物的成长档案', async () => {
    const renderGrowth = vi.fn((name: string) => (
      <div data-testid="growth-embed">成长：{name}</div>
    ));
    renderDetail({ renderGrowth });
    // 封面取图集里的图（三视图）
    await waitFor(() =>
      expect(screen.getByTestId('character-portrait').querySelector('img')).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: '更换 林舟 的形象图' }));
    expect(screen.getByRole('tab', { name: /图集/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('entity-gallery')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /成长档案/ }));
    expect(screen.getByTestId('growth-embed').textContent).toBe('成长：林舟');
    expect(renderGrowth).toHaveBeenCalledWith('林舟');
    // 标题区的「成长档案」按钮切到本页的成长档案分页（不另开标签）
    fireEvent.click(screen.getByRole('tab', { name: '人物设计' }));
    fireEvent.click(screen.getByLabelText(/的成长档案$/));
    expect(screen.getByRole('tab', { name: /成长档案/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('没有 renderGrowth 时成长分页显示跳转按钮', () => {
    const onOpenGrowthSheet = vi.fn();
    renderDetail({ onOpenGrowthSheet, growthLevel: null });
    fireEvent.click(screen.getByRole('tab', { name: /成长档案/ }));
    const panel = screen.getByRole('tabpanel', { name: '成长档案' });
    fireEvent.click(within(panel).getByRole('button'));
    expect(onOpenGrowthSheet).toHaveBeenCalledWith('林舟');
  });
});
