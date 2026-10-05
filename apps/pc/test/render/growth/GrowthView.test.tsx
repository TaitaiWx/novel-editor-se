// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  applySimulationBranch,
  parseGrowthSimulationResult,
  resolveSimulationCandidates,
} from '@novel-editor/core/growth';
import { GrowthView } from '@/render/components/RightPanel/GrowthView';
import type { GrowthSnapshot } from '@/render/types/growth-api';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';
import { FOLDER, buildSnapshot } from './fixtures';

afterEach(() => {
  uninstallElectronMock();
});

function ok<T>(data: T) {
  return { ok: true as const, data };
}

describe('GrowthView', () => {
  it('未初始化时引导创建记忆库', async () => {
    const initialized = buildSnapshot();
    const electron = installElectronMock((channel) => {
      if (channel === 'growth-load') return ok(buildSnapshot({ initialized: false, sheets: [] }));
      if (channel === 'growth-init') return ok(initialized);
      return null;
    });
    render(<GrowthView folderPath={FOLDER} dbReady={false} />);
    fireEvent.click(await screen.findByText('创建记忆库'));
    await screen.findByText('距下一级 500 经验');
    expect(electron.invoke).toHaveBeenCalledWith('growth-init', FOLDER, 'dnd');
    expect(screen.getByText('记忆库已创建：资料/记忆/')).toBeTruthy();
  });

  it('从人物库选择角色自动建卡，记录经验后刷新角色卡', async () => {
    let snapshot: GrowthSnapshot = buildSnapshot({ sheets: [] });
    const electron = installElectronMock((channel, ...args) => {
      switch (channel) {
        case 'growth-load':
          return ok(snapshot);
        case 'db-novel-get-by-folder':
          return { id: 1 };
        case 'db-character-list':
          return [
            {
              id: 1,
              name: '莉娜',
              role: '配角',
              description: '',
              attributes: JSON.stringify({ aliases: ['小莉'] }),
            },
          ];
        case 'growth-ensure-sheet': {
          const base = buildSnapshot();
          snapshot = buildSnapshot({
            sheets: [
              { ...base.sheets[0], name: '莉娜', aliases: ['小莉'], events: [], exp: 0, level: 1 },
            ],
          });
          return ok(snapshot);
        }
        case 'growth-apply-event': {
          const event = args[2] as { delta: number };
          snapshot = buildSnapshot({
            sheets: [{ ...snapshot.sheets[0], exp: event.delta, level: 2 }],
          });
          return ok({ snapshot, levelUps: 1, warnings: [] });
        }
        default:
          return null;
      }
    });
    render(<GrowthView folderPath={FOLDER} dbReady />);
    const select = await screen.findByLabelText('选择角色');
    await screen.findByText('莉娜（新建成长卡）');
    fireEvent.change(select, { target: { value: '莉娜' } });
    await screen.findByText('已为「莉娜」创建成长卡');
    expect(electron.invoke).toHaveBeenCalledWith('growth-ensure-sheet', FOLDER, '莉娜', ['小莉']);

    fireEvent.change(screen.getByLabelText('数值'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('章节'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('记录'));
    await screen.findByText('升级！莉娜 升到 2 级');
    expect(electron.invoke).toHaveBeenCalledWith(
      'growth-apply-event',
      FOLDER,
      '莉娜',
      { type: 'exp', delta: 400, chapter: 12 },
      { force: false }
    );
    expect(screen.getByText('距下一级 500 经验')).toBeTruthy();
  });

  it('展示战力警告与被遗忘的配角', async () => {
    const base = buildSnapshot();
    const broken = buildSnapshot({
      sheets: [{ ...base.sheets[0], attributes: { ...base.sheets[0].attributes, str: 99 } }],
      party: {
        schemaVersion: 1,
        parties: [{ id: 'p', name: '银月小队', members: ['老铁'], fromChapter: 1 }],
        companions: [{ name: '老铁', lastSeenChapter: 1, important: true }],
      },
      atlas: {
        schemaVersion: 1,
        locations: [{ id: 'c', name: '霜城', visits: [{ character: '阿尔', chapter: 80 }] }],
      },
    });
    installElectronMock((channel) => (channel === 'growth-load' ? ok(broken) : null));
    render(<GrowthView folderPath={FOLDER} dbReady={false} />);
    expect(await screen.findByText(/力量 99 超出取值范围/)).toBeTruthy();
    expect(screen.getByText('1 错误')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /队伍/ }));
    expect(await screen.findByText('第 1 章后已 79 章未出场 · 曾在 银月小队')).toBeTruthy();
    expect(screen.getByText('当前第 80 章')).toBeTruthy();
  });

  it('AI 推演：选择候选项 → 并排展示分支 → 二次确认后采用', async () => {
    let snapshot = buildSnapshot();
    const aiText = JSON.stringify({
      branches: [
        {
          id: 'warrior',
          title: '铁壁',
          summary: '站在最前排',
          events: [{ chapter: 4, type: 'exp', delta: 600 }],
        },
        {
          id: 'mage',
          title: '元素',
          summary: '研习奥术',
          events: [{ chapter: 4, type: 'attribute', target: 'int', delta: 1 }],
          risks: ['前期脆弱'],
        },
      ],
      recommendation: 'mage',
    });
    const electron = installElectronMock((channel, ...args) => {
      if (channel === 'growth-load') return ok(snapshot);
      if (channel === 'growth-simulate') {
        const request = args[2] as { choices: string[] };
        const candidates = resolveSimulationCandidates(snapshot.ruleset, request.choices);
        const parsed = parseGrowthSimulationResult(aiText, {
          ruleset: snapshot.ruleset,
          sheet: snapshot.sheets[0],
          candidates,
        });
        if (!parsed.ok) return { ok: false, error: parsed.error };
        return ok({ result: parsed.result, issues: parsed.issues, candidates, startChapter: 4 });
      }
      if (channel === 'growth-apply-branch') {
        const branch = args[2] as { events: Parameters<typeof applySimulationBranch>[2]['events'] };
        const applied = applySimulationBranch(snapshot.ruleset, snapshot.sheets[0], branch);
        snapshot = buildSnapshot({ sheets: [applied.sheet] });
        return ok({ snapshot, levelUps: 0, warnings: applied.warnings });
      }
      return null;
    });
    render(<GrowthView folderPath={FOLDER} dbReady={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI 推演' }));

    const run = screen.getByText('开始推演');
    expect((run as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '战士之道' }));
    fireEvent.click(screen.getByRole('button', { name: '法师之道' }));
    fireEvent.click(run);

    await waitFor(() => expect(screen.getAllByTestId('growth-branch')).toHaveLength(2));
    expect(electron.invoke).toHaveBeenCalledWith('growth-simulate', FOLDER, '阿尔', {
      choices: ['warrior', 'mage'],
      mode: 'controlled',
      horizon: 10,
      extraRules: [],
    });
    expect(screen.getByText('推荐')).toBeTruthy();
    expect(screen.getByText('等级 2 → 3')).toBeTruthy();
    expect(screen.getByText('风险：前期脆弱')).toBeTruthy();

    const adopt = screen.getAllByText('采用此分支')[1];
    fireEvent.click(adopt);
    expect(electron.invoke).not.toHaveBeenCalledWith(
      'growth-apply-branch',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    fireEvent.click(screen.getByText('确认写入成长卡'));
    await screen.findByText('已采用');
    const call = electron.invoke.mock.calls.find(([channel]) => channel === 'growth-apply-branch');
    expect(call?.[2]).toBe('阿尔');
    expect((call?.[3] as { events: Array<{ type: string }> }).events[0]).toMatchObject({
      type: 'choice',
      target: 'path',
      value: 'mage',
    });
  });

  it('推演失败时展示错误', async () => {
    installElectronMock((channel) => {
      if (channel === 'growth-load') return ok(buildSnapshot());
      if (channel === 'growth-simulate') return { ok: false, error: '未配置 AI Key' };
      return null;
    });
    render(<GrowthView folderPath={FOLDER} dbReady={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'AI 推演' }));
    fireEvent.click(screen.getByRole('radio', { name: '自由成长' }));
    fireEvent.click(screen.getByText('开始推演'));
    expect(await screen.findByText('未配置 AI Key')).toBeTruthy();
  });
});
