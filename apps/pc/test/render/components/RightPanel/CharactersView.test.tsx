// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Character, CharacterCamp } from '@/render/components/RightPanel/types';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

// 图谱与详情工作区较重，替换为暴露关键 props 的轻量桩，聚焦 CharactersView 自身的编排逻辑
vi.mock('@/render/components/RightPanel/CharacterGraphPanel', () => ({
  CharacterGraphPanel: (props: {
    characters: Character[];
    links: unknown[];
    selectedCharacter: Character | null;
    selectedRelations: unknown[];
    clusteredCharacters: Record<CharacterCamp, Array<Character & { heat: number }>>;
    relationStageStats: Array<{ stage: string; count: number }>;
    onSelectCharacter: (id: number | null) => void;
  }) => (
    <div data-testid="graph">
      <span data-testid="graph-selected">{props.selectedCharacter?.name ?? '无'}</span>
      <span data-testid="graph-relations">{props.selectedRelations.length}</span>
      <span data-testid="graph-stages">
        {props.relationStageStats.map((s) => `${s.stage}:${s.count}`).join(',')}
      </span>
      <span data-testid="graph-heat">
        {(Object.keys(props.clusteredCharacters) as CharacterCamp[])
          .map((camp) =>
            props.clusteredCharacters[camp].map((c) => `${camp}:${c.name}:${c.heat}`).join(';')
          )
          .filter(Boolean)
          .join('|')}
      </span>
      {props.characters.map((c) => (
        <button key={c.id} onClick={() => props.onSelectCharacter(c.id)}>
          选择{c.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/render/components/RightPanel/CharactersView/CharacterDetailWorkspace', () => ({
  CharacterDetailWorkspace: (props: {
    focusedCharacter: Character | null;
    focusedCamp: CharacterCamp | null;
    focusedHeat: number;
    selectedRelations: unknown[];
    novelCorpusFileCount: number;
    graphView: React.ReactNode;
  }) => (
    <div data-testid="detail">
      <span data-testid="detail-name">{props.focusedCharacter?.name ?? '未找到'}</span>
      <span data-testid="detail-camp">{props.focusedCamp ?? '-'}</span>
      <span data-testid="detail-heat">{props.focusedHeat}</span>
      <span data-testid="detail-relations">{props.selectedRelations.length}</span>
      <span data-testid="detail-corpus">{props.novelCorpusFileCount}</span>
      {props.graphView}
    </div>
  ),
}));

import { CharactersView } from '@/render/components/RightPanel/CharactersView';

interface CharRow {
  id: number;
  name: string;
  role: string;
  description: string;
  attributes: string;
}

const RELATIONS_KEY = 'novel-editor:character-relations:/novel';

function installDb(
  opts: { rows?: CharRow[]; relations?: unknown[]; novel?: { id: number } | null } = {}
): { mock: ElectronMock; rows: CharRow[] } {
  const rows: CharRow[] = [...(opts.rows ?? [])];
  let nextId = 50;
  const mock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'db-novel-get-by-folder':
        return opts.novel === undefined ? { id: 7 } : opts.novel;
      case 'db-character-list':
        return rows.map((r) => ({ ...r }));
      case 'db-character-create': {
        const [, name, role, description, attributes] = args as [
          number,
          string,
          string,
          string,
          string,
        ];
        rows.push({ id: (nextId += 1), name, role, description, attributes });
        return { id: nextId };
      }
      case 'db-character-delete': {
        const idx = rows.findIndex((r) => r.id === args[0]);
        if (idx >= 0) rows.splice(idx, 1);
        return true;
      }
      case 'db-character-update':
        return true;
      case 'db-settings-get':
        if (String(args[0]).includes('relation') && opts.relations) {
          return JSON.stringify(opts.relations);
        }
        return null;
      case 'refresh-folder':
        return {
          files: [{ name: '第一章.md', path: '/novel/第一章.md', type: 'file' }],
        };
      case 'read-file':
        return '林舟走进青云门。';
      case 'db-world-setting-list-by-folder':
        return [];
      default:
        return undefined;
    }
  });
  return { mock, rows };
}

const seedRows: CharRow[] = [
  { id: 1, name: '林舟', role: '主角', description: '少年剑客', attributes: '{}' },
  { id: 2, name: '白芷', role: '配角', description: '', attributes: '{}' },
];

afterEach(() => {
  uninstallElectronMock();
});

describe('CharactersView', () => {
  it('无项目时显示空的人物中枢', () => {
    uninstallElectronMock();
    render(<CharactersView folderPath={null} content="" />);
    expect(screen.getByText('人物与关系')).toBeTruthy();
    expect(screen.getAllByText('人物 0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('阵营 0').length).toBeGreaterThan(0);
    expect(screen.getByText(/暂无角色/)).toBeTruthy();
  });

  it('加载人物、通知 onCharactersChange、统计阵营与热度', async () => {
    installDb({ rows: seedRows });
    const onCharactersChange = vi.fn();
    render(
      <CharactersView
        folderPath="/novel"
        content="林舟拔剑。林舟大笑。白芷"
        onCharactersChange={onCharactersChange}
      />
    );
    expect((await screen.findAllByText('人物 2')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(onCharactersChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: '林舟' })])
      )
    );
    expect(screen.getAllByText(/^关系 \d+$/).length).toBeGreaterThan(0);
    expect(Number(screen.getByText(/阵营 \d/).textContent?.replace(/\D/g, ''))).toBeGreaterThan(0);
    expect(screen.getByTestId('graph-heat').textContent).toContain('林舟');
  });

  it('选择人物后关系过滤到该人物', async () => {
    installDb({
      rows: [...seedRows, { id: 3, name: '墨渊', role: '反派', description: '', attributes: '{}' }],
      relations: [
        { id: 'r1', sourceId: 1, targetId: 2, tone: 'ally', label: '同门', note: '初识' },
        { id: 'r2', sourceId: 2, targetId: 3, tone: 'rival', label: '宿敌', note: '决裂' },
      ],
    });
    render(<CharactersView folderPath="/novel" content="" />);
    expect((await screen.findAllByText('人物 3')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('graph-relations').textContent).not.toBe('0'));
    const total = Number(screen.getByTestId('graph-relations').textContent);
    expect(screen.getByTestId('graph-stages').textContent).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: '选择林舟' }));
    expect(screen.getByTestId('graph-selected').textContent).toBe('林舟');
    expect(Number(screen.getByTestId('graph-relations').textContent)).toBeLessThan(total);
  });

  it('新增人物', async () => {
    const { mock } = installDb({ rows: seedRows });
    render(<CharactersView folderPath="/novel" content="" />);
    await screen.findAllByText('人物 2');
    fireEvent.click(screen.getByRole('button', { name: '+ 添加' }));
    fireEvent.change(screen.getByPlaceholderText('角色名称'), { target: { value: '墨渊' } });
    fireEvent.change(screen.getByPlaceholderText('角色定位 (主角/配角/反派...)'), {
      target: { value: '反派' },
    });
    fireEvent.change(screen.getByPlaceholderText('角色描述、设定...'), {
      target: { value: '魔道宗主' },
    });
    const submit = screen
      .getAllByRole('button')
      .find((b) => b.className.includes('submitButton')) as HTMLButtonElement;
    fireEvent.click(submit);
    expect((await screen.findAllByText('人物 3')).length).toBeGreaterThan(0);
    expect(mock.invoke).toHaveBeenCalledWith(
      'db-character-create',
      7,
      '墨渊',
      '反派',
      '魔道宗主',
      expect.any(String)
    );
  });

  it('删除人物', async () => {
    const { mock } = installDb({ rows: seedRows });
    render(<CharactersView folderPath="/novel" content="" />);
    await screen.findAllByText('人物 2');
    fireEvent.click(screen.getAllByTitle('删除角色')[0]);
    expect((await screen.findAllByText('人物 1')).length).toBeGreaterThan(0);
    expect(mock.invoke).toHaveBeenCalledWith('db-character-delete', expect.any(Number));
  });

  it('筛选无结果时显示提示', async () => {
    installDb({ rows: seedRows });
    render(<CharactersView folderPath="/novel" content="" />);
    await screen.findAllByText('人物 2');
    fireEvent.change(screen.getByPlaceholderText('快速筛选人物、定位、描述或别名'), {
      target: { value: '不存在的人' },
    });
    expect(screen.getByText(/当前筛选条件下没有角色/)).toBeTruthy();
  });

  it('AI 生成人物图：正文为空时提示', async () => {
    installDb({ rows: seedRows });
    render(<CharactersView folderPath="/novel" content="   " />);
    await screen.findAllByText('人物 2');
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成人物图' }));
    expect(await screen.findByText('正文为空，无法生成角色图谱')).toBeTruthy();
  });

  it('详情模式：聚焦初始人物', async () => {
    installDb({ rows: seedRows });
    render(
      <CharactersView folderPath="/novel" content="林舟林舟" initialSelectedCharacterId={1} />
    );
    await waitFor(() => expect(screen.getByTestId('detail-name').textContent).toBe('林舟'));
    expect(screen.getByTestId('detail-camp').textContent).not.toBe('-');
    expect(Number(screen.getByTestId('detail-heat').textContent)).toBeGreaterThanOrEqual(0);
    expect(screen.getByTestId('graph')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('detail-corpus').textContent).toBe('1'));
  });

  it('详情模式：初始人物不存在时不聚焦', async () => {
    installDb({ rows: seedRows });
    render(<CharactersView folderPath="/novel" content="" initialSelectedCharacterId={999} />);
    await screen.findByRole('button', { name: '选择林舟' });
    expect(screen.getByTestId('detail-name').textContent).toBe('未找到');
    expect(screen.getByTestId('detail-camp').textContent).toBe('-');
  });

  it('作品不在数据库中时保持空列表', async () => {
    const { mock } = installDb({ rows: seedRows, novel: null });
    render(<CharactersView folderPath="/novel" content="" />);
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith('db-novel-get-by-folder', '/novel')
    );
    expect(screen.getAllByText('人物 0').length).toBeGreaterThan(0);
  });
});

// 关系存储 key 仅用于文档化：useCharacterRelations 通过 db-settings-get 读取
void RELATIONS_KEY;
