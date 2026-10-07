// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CHARACTER_DESIGN_FIELDS, type MediaItem } from '@novel-editor/core/entity-media';
import CharacterOverview, {
  summarizeCharacter,
} from '@/render/components/RightPanel/CharactersView/CharacterOverview';
import type { Character } from '@/render/components/RightPanel/types';
import { uninstallElectronMock } from '../../../hooks/electronMock';

function character(partial: Partial<Character> = {}): Character {
  return {
    id: 1,
    name: '林舟',
    role: '主角',
    category: 'major',
    description: '',
    currentState: [],
    ...partial,
  };
}

function media(kind: MediaItem['kind'], path: string): MediaItem {
  return { id: path, path, kind, source: 'upload', createdAt: '2026-10-07T00:00:00.000Z' };
}

afterEach(() => uninstallElectronMock());

describe('summarizeCharacter', () => {
  it('什么都没有：三条待补充提示，没有封面', () => {
    const summary = summarizeCharacter(character(), null);
    expect(summary).toMatchObject({
      id: 1,
      name: '林舟',
      cover: undefined,
      designFilled: 0,
      designTotal: CHARACTER_DESIGN_FIELDS.length,
      imageCount: 0,
      hasTurnaround: false,
      level: null,
      hints: ['缺人物设计', '缺三视图', '没有成长档案'],
    });
  });

  it('只统计非空白的设计字段；有三视图与成长等级时不再提示', () => {
    const summary = summarizeCharacter(
      character({
        design: {
          appearance: '黑发',
          outfit: '   ',
          personality: '倔强',
          background: '',
          speech: '',
        },
        media: [media('turnaround', '资料/图集/人物/林舟/t.png')],
      }),
      3
    );
    expect(summary.designFilled).toBe(2);
    expect(summary.hasTurnaround).toBe(true);
    expect(summary.level).toBe(3);
    expect(summary.hints).toEqual([]);
    expect(summary.imageCount).toBe(1);
  });

  it('等级 0 也算有成长档案；封面优先形象图，没有图集时回退旧头像', () => {
    const withMedia = summarizeCharacter(
      character({
        media: [media('turnaround', 'a/t.png'), media('portrait', 'a/p.png')],
      }),
      0
    );
    expect(withMedia.cover).toBe('a/p.png');
    expect(withMedia.hints).toEqual(['缺人物设计']);

    const legacy = summarizeCharacter(character({ avatar: '资料/人物头像/林舟.png' }), null);
    expect(legacy.cover).toBe('资料/人物头像/林舟.png');
    expect(legacy.hints).toContain('缺三视图');
  });
});

describe('CharacterOverview', () => {
  it('有 onCreateCharacter 时显示「新建人物」卡片；没有成长渲染时没有「成长」分页', () => {
    const onCreate = vi.fn();
    render(
      <CharacterOverview
        characters={[character({ highlightColor: '#c9a27a' })]}
        levelOf={() => null}
        workPath={null}
        onOpenCharacter={vi.fn()}
        onCreateCharacter={onCreate}
        relationsView={<div data-testid="relations" />}
      />
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['人物', '关系']);
    fireEvent.click(screen.getByRole('button', { name: /新建人物/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('人物 1')).toBeTruthy();
    expect(screen.getByText('有设计 0')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '关系' }));
    expect(screen.getByTestId('relations')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /新建人物/ })).toBeNull();
  });

  it('没有 onCreateCharacter 时不显示「新建人物」', () => {
    render(
      <CharacterOverview
        characters={[]}
        levelOf={() => null}
        workPath={null}
        onOpenCharacter={vi.fn()}
        relationsView={null}
      />
    );
    expect(screen.queryByRole('button', { name: /新建人物/ })).toBeNull();
    expect(screen.getByText('人物 0')).toBeTruthy();
  });
});
