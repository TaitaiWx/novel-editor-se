// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  applySimulationBranch,
  parseGrowthSimulationResult,
  resolveSimulationCandidates,
} from '@novel-editor/core/growth';
import { GrowthView } from '@/render/components/RightPanel/GrowthView';
import { GROWTH_TOUR_STORAGE_KEY } from '@/render/components/RightPanel/GrowthView/growthGuide';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';
import { FOLDER, buildSnapshot, createGrowthBackend, ok } from './fixtures';

beforeEach(() => {
  // 引导单独测试；其余用例视为已看过
  window.localStorage.setItem(GROWTH_TOUR_STORAGE_KEY, '1');
});

afterEach(() => {
  uninstallElectronMock();
  window.localStorage.clear();
});

function renderSheet(props: Partial<React.ComponentProps<typeof GrowthView>> = {}) {
  return render(
    <GrowthView
      folderPath={FOLDER}
      dbReady={false}
      layout="workspace"
      initialCharacter="阿尔"
      {...props}
    />
  );
}

async function openRecord() {
  fireEvent.click(await screen.findByRole('button', { name: '为 阿尔 记一笔' }));
  return screen.findByRole('form', { name: '为 阿尔 记一笔' });
}

describe('成长卡：记一笔', () => {
  it('标题区只保留等级、经验条与三个操作', async () => {
    installElectronMock(createGrowthBackend().handle);
    renderSheet();
    await screen.findByRole('heading', { level: 1, name: '阿尔' });
    expect(screen.getByLabelText('等级 2')).toBeTruthy();
    // 2 级区间 300~900：已获得 100 / 600
    expect(screen.getByText('本级 100 / 600 · 距下一级 500')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('17');
    expect(screen.getByRole('button', { name: '使用说明' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeTruthy();
    // 推演、世界收进次级导航
    expect(screen.getByRole('tab', { name: '档案' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '推演' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '世界' })).toBeTruthy();
    // 卡片：属性 / 技能 / 抉择 / 时间线，各自带「?」
    for (const name of ['属性', '技能', '抉择', '成长时间线']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByLabelText(/^属性说明：/)).toBeTruthy();
    expect(screen.getByLabelText(/^时间线说明：/)).toBeTruthy();
  });

  it('章节默认取当前打开的章节，记录经验后提示升级并写入事件', async () => {
    const backend = createGrowthBackend();
    const electron = installElectronMock(backend.handle);
    renderSheet({ currentChapter: 12 });
    const form = await openRecord();
    expect((within(form).getByLabelText('章节') as HTMLInputElement).value).toBe('12');
    expect(within(form).getByText('当前章节')).toBeTruthy();

    const value = within(form).getByLabelText('获得多少经验') as HTMLInputElement;
    // 打开后焦点直接落在数值框
    await waitFor(() => expect(document.activeElement).toBe(value));
    fireEvent.change(value, { target: { value: '+500' } });
    fireEvent.change(within(form).getByLabelText('发生了什么'), {
      target: { value: '击败狼王' },
    });
    fireEvent.submit(form);

    expect(await screen.findByText('阿尔 获得 500 经验，升到 Lv.3')).toBeTruthy();
    expect(electron.invoke).toHaveBeenCalledWith(
      'growth-apply-event',
      FOLDER,
      '阿尔',
      { type: 'exp', delta: 500, chapter: 12, note: '击败狼王' },
      { force: false }
    );
    // 弹层关闭，时间线按章节分组、最新在上
    await waitFor(() => expect(screen.queryByRole('form', { name: '为 阿尔 记一笔' })).toBeNull());
    const timeline = screen.getByRole('region', { name: '成长时间线' });
    expect(within(timeline).getAllByText(/^第 \d+ 章$/)[0].textContent).toBe('第 12 章');
    expect(within(timeline).getByText('击败狼王')).toBeTruthy();
  });

  it('没有打开章节时沿用最近记录的章节', async () => {
    installElectronMock(createGrowthBackend().handle);
    renderSheet();
    const form = await openRecord();
    expect((within(form).getByLabelText('章节') as HTMLInputElement).value).toBe('3');
    expect(within(form).getByText('上次记录')).toBeTruthy();
  });

  it('属性 / 技能 / 记事各有自然的字段，高级里可选技能经验与直接调整等级', async () => {
    const electron = installElectronMock(createGrowthBackend().handle);
    renderSheet({ currentChapter: 5 });
    let form = await openRecord();

    fireEvent.click(within(form).getByRole('tab', { name: '属性变化' }));
    fireEvent.submit(form);
    expect(within(form).getByRole('alert').textContent).toContain('请选择属性');
    fireEvent.change(within(form).getByLabelText('属性'), { target: { value: 'str' } });
    fireEvent.change(within(form).getByLabelText('变化多少'), { target: { value: '+2' } });
    fireEvent.submit(form);
    expect(await screen.findByText('阿尔 的力量 +2')).toBeTruthy();

    form = await openRecord();
    fireEvent.click(within(form).getByRole('tab', { name: '技能' }));
    expect(within(form).getByRole('option', { name: '回气（学会）' })).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('技能'), { target: { value: 'second-wind' } });
    fireEvent.submit(form);
    expect(await screen.findByText('阿尔 学会了「回气」')).toBeTruthy();

    form = await openRecord();
    fireEvent.click(within(form).getByRole('tab', { name: '记事' }));
    fireEvent.submit(form);
    expect(within(form).getByRole('alert').textContent).toContain('请写下要记的事');
    fireEvent.change(within(form).getByLabelText('记事内容'), {
      target: { value: '左臂受伤' },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith(
        'growth-apply-event',
        FOLDER,
        '阿尔',
        { type: 'note', chapter: 5, note: '左臂受伤' },
        { force: false }
      )
    );

    form = await openRecord();
    expect(within(form).queryByRole('button', { name: '直接调整等级' })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: '高级' }));
    fireEvent.click(within(form).getByRole('button', { name: '直接调整等级' }));
    fireEvent.change(within(form).getByLabelText('等级变化'), { target: { value: '1' } });
    fireEvent.submit(form);
    expect(await screen.findByText('阿尔 等级 +1')).toBeTruthy();
  });

  it('违反规则时说明原因，可「仍然记录」', async () => {
    const electron = installElectronMock(createGrowthBackend().handle);
    renderSheet({ currentChapter: 4 });
    const form = await openRecord();
    fireEvent.click(within(form).getByRole('tab', { name: '技能' }));
    fireEvent.change(within(form).getByLabelText('技能'), { target: { value: 'fireball' } });
    fireEvent.submit(form);
    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toContain('无法提升「火球术」');
    fireEvent.click(within(alert).getByText('仍然记录'));
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenLastCalledWith(
        'growth-apply-event',
        FOLDER,
        '阿尔',
        { type: 'skill', target: 'fireball', delta: 1, chapter: 4 },
        { force: true }
      )
    );
  });
});

describe('成长卡：提醒', () => {
  it('没有问题时不显示提醒横幅', async () => {
    installElectronMock(createGrowthBackend().handle);
    renderSheet();
    await screen.findByRole('heading', { level: 1, name: '阿尔' });
    expect(screen.queryByRole('region', { name: '需要留意' })).toBeNull();
  });

  it('有战力冲突或曾同队的配角被遗忘时显示一条可展开的横幅', async () => {
    const base = buildSnapshot();
    const broken = buildSnapshot({
      sheets: [{ ...base.sheets[0], attributes: { ...base.sheets[0].attributes, str: 99 } }],
      party: {
        schemaVersion: 1,
        parties: [{ id: 'p', name: '银月小队', members: ['阿尔', '老铁'], fromChapter: 1 }],
        companions: [{ name: '老铁', lastSeenChapter: 1, important: true }],
      },
      atlas: {
        schemaVersion: 1,
        locations: [{ id: 'c', name: '霜城', visits: [{ character: '阿尔', chapter: 80 }] }],
      },
    });
    installElectronMock(createGrowthBackend(broken).handle);
    renderSheet();
    const banner = await screen.findByRole('region', { name: '需要留意' });
    expect(banner.textContent).toContain('1 位配角很久没出场');
    expect(within(banner).queryByText(/力量 99/)).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: /需要留意/ }));
    expect(within(banner).getByText(/力量 99 超出取值范围/)).toBeTruthy();
    expect(within(banner).getByText(/老铁 已 79 章未出场/)).toBeTruthy();
    expect(within(banner).getByText(/曾在 银月小队/)).toBeTruthy();

    // 世界 → 队伍 里有完整的配角记录
    fireEvent.click(screen.getByRole('tab', { name: '世界' }));
    fireEvent.click(screen.getByRole('tab', { name: /队伍/ }));
    expect(await screen.findByText('第 1 章后已 79 章未出场 · 曾在 银月小队')).toBeTruthy();
  });
});

describe('成长卡：次级功能', () => {
  it('世界里可切换队伍 / 地图 / 规则，「⋯ → 编辑规则」直达规则', async () => {
    installElectronMock(createGrowthBackend().handle);
    renderSheet();
    fireEvent.click(await screen.findByRole('tab', { name: '世界' }));
    expect(await screen.findByText('组队历史')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '地图' }));
    expect(screen.getByRole('tab', { name: '地图' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: '档案' }));
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑规则' }));
    expect(await screen.findByText('核心规则')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '规则' }).getAttribute('aria-selected')).toBe('true');
  });

  it('「⋯」菜单：同步、打开数据文件夹、两步确认删除成长卡', async () => {
    const backend = createGrowthBackend();
    const electron = installElectronMock(backend.handle);
    const onSheetDeleted = vi.fn();
    renderSheet({ onSheetDeleted });
    fireEvent.click(await screen.findByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '同步人物卡 / 设定到记忆文件夹' }));
    expect(await screen.findByText('已同步 1 张角色卡、0 条设定到 资料/记忆/')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '打开数据文件夹' }));
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith('open-in-system-app', `${FOLDER}/资料/记忆`)
    );

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除成长卡…' }));
    expect(electron.invoke).not.toHaveBeenCalledWith('delete-file', expect.anything());
    fireEvent.click(screen.getByRole('menuitem', { name: /确认删除「阿尔」的成长卡/ }));
    await waitFor(() => expect(onSheetDeleted).toHaveBeenCalledWith('阿尔'));
    expect(electron.invoke).toHaveBeenCalledWith(
      'delete-file',
      `${FOLDER}/资料/记忆/角色/阿尔.json`
    );
    expect(electron.invoke).toHaveBeenCalledWith('delete-file', `${FOLDER}/资料/记忆/角色/阿尔.md`);
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
      if (channel === 'growth-ensure-sheet') return ok(snapshot);
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
    renderSheet();
    fireEvent.click(await screen.findByRole('tab', { name: '推演' }));

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

    fireEvent.click(screen.getAllByText('采用此分支')[1]);
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

  it('推演失败时展示错误；状态备注也在推演页', async () => {
    installElectronMock((channel) => {
      if (channel === 'growth-load' || channel === 'growth-ensure-sheet') {
        return ok(buildSnapshot());
      }
      if (channel === 'growth-simulate') return { ok: false, error: '未配置 AI Key' };
      return null;
    });
    renderSheet();
    fireEvent.click(await screen.findByRole('tab', { name: '推演' }));
    expect(screen.getByRole('region', { name: '状态备注' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '自由成长' }));
    fireEvent.click(screen.getByText('开始推演'));
    expect(await screen.findByText('未配置 AI Key')).toBeTruthy();
  });
});
