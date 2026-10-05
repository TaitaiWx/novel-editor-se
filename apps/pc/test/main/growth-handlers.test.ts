import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

const invokeConfiguredAI = vi.fn();
vi.mock('../../src/main/handlers/ai', () => ({
  invokeConfiguredAI: (...args: unknown[]) => invokeConfiguredAI(...args),
}));

const storeRows = {
  novel: { id: 7 } as { id: number } | undefined,
  characters: [] as unknown[],
  settings: [] as unknown[],
};
vi.mock('@novel-editor/store', () => ({
  novelOps: { getByFolder: () => storeRows.novel },
  characterOps: { getByNovel: () => storeRows.characters },
  worldSettingOps: { getByNovel: () => storeRows.settings },
}));

const { registerGrowthHandlers } = await import('../../src/main/handlers/growth');
const { registerMemoryHandlers, toCharacterSnapshot, toSettingSnapshot } = await import(
  '../../src/main/handlers/memory'
);
registerGrowthHandlers();
registerMemoryHandlers();

interface Result<T> {
  ok: boolean;
  data: T;
  error: string;
}

async function call<T = Record<string, unknown>>(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({}, ...args)) as Result<T>;
}

interface SnapshotLike {
  initialized: boolean;
  sheets: Array<{
    name: string;
    level: number;
    exp: number;
    aliases: string[];
    choices: unknown[];
  }>;
  check: { summary: { errors: number } };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-growth-main-'));
  invokeConfiguredAI.mockReset();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('growth IPC handlers', () => {
  it('注册全部通道', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'growth-apply-branch',
        'growth-apply-event',
        'growth-ensure-sheet',
        'growth-init',
        'growth-load',
        'growth-save-atlas',
        'growth-save-party',
        'growth-save-ruleset',
        'growth-simulate',
        'growth-update-notes',
        'memory-sync-snapshots',
      ].sort()
    );
  });

  it('拒绝非法目录参数', async () => {
    expect(await call('growth-load', 'relative/path')).toMatchObject({
      ok: false,
      error: '无效的项目目录',
    });
    expect(await call('growth-load', 42)).toMatchObject({ ok: false });
    expect(await call('growth-load', path.join(dir, 'missing'))).toMatchObject({
      ok: false,
      error: expect.stringContaining('项目目录不存在'),
    });
  });

  it('init → ensure-sheet → apply-event（严格 / 强制）→ notes', async () => {
    expect((await call<SnapshotLike>('growth-load', dir)).data.initialized).toBe(false);
    expect((await call<SnapshotLike>('growth-init', dir, 'evil-template')).data.initialized).toBe(
      true
    );

    const ensured = await call<SnapshotLike>('growth-ensure-sheet', dir, '阿尔', ['小阿', 3]);
    expect(ensured.data.sheets[0]).toMatchObject({ name: '阿尔', aliases: ['小阿'] });
    expect((await call('growth-ensure-sheet', dir, '')).ok).toBe(false);

    const exp = await call<{ snapshot: SnapshotLike; levelUps: number }>(
      'growth-apply-event',
      dir,
      '阿尔',
      { type: 'exp', delta: 400, chapter: 2, evil: true }
    );
    expect(exp.ok).toBe(true);
    expect(exp.data.levelUps).toBe(1);
    const saved = JSON.parse(
      await readFile(path.join(dir, '资料', '记忆', '角色', '阿尔.json'), 'utf-8')
    );
    expect(saved.events[0]).toEqual(
      expect.objectContaining({ type: 'exp', delta: 400, source: 'gui' })
    );
    expect(saved.events[0]).not.toHaveProperty('evil');

    const blocked = await call('growth-apply-event', dir, '阿尔', {
      type: 'skill',
      target: 'fireball',
    });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringContaining('角色等级 5') });
    const forced = await call<{ warnings: Array<{ code: string }> }>(
      'growth-apply-event',
      dir,
      '阿尔',
      { type: 'skill', target: 'fireball' },
      { force: true }
    );
    expect(forced.data.warnings.map((w) => w.code)).toContain('SKILL_PREREQUISITE');
    expect((await call('growth-apply-event', dir, '阿尔', { type: 'teleport' })).ok).toBe(false);

    const notes = await call<SnapshotLike & { sheets: Array<{ notes: string[] }> }>(
      'growth-update-notes',
      dir,
      '阿尔',
      ['左臂受伤', 5]
    );
    expect(notes.data.sheets[0].notes).toEqual(['左臂受伤']);
  });

  it('保存规则 / 队伍 / 地图时校验并规范化', async () => {
    await call('growth-init', dir, 'blank');
    const ruleset = await call<{ ruleset: { name: string; coreRules: unknown[] } }>(
      'growth-save-ruleset',
      dir,
      { name: '新规则', coreRules: ['不能飞'] }
    );
    expect(ruleset.data.ruleset).toMatchObject({
      name: '新规则',
      coreRules: [{ id: 'rule-1', text: '不能飞' }],
    });
    expect((await call('growth-save-ruleset', dir, { schemaVersion: 99 })).ok).toBe(false);
    const party = await call<{ party: { parties: Array<{ members: string[] }> } }>(
      'growth-save-party',
      dir,
      {
        parties: [{ name: '队', members: 'a,b' }],
      }
    );
    expect(party.data.party.parties[0].members).toEqual(['a', 'b']);
    const atlas = await call<{ atlas: { locations: unknown[] } }>('growth-save-atlas', dir, {
      locations: [{ name: '霜城' }],
    });
    expect(atlas.data.atlas.locations).toHaveLength(1);
  });

  it('growth-simulate 调用已配置的 AI 并解析分支；采用分支写入角色卡', async () => {
    await call('growth-init', dir, 'dnd');
    await call('growth-apply-event', dir, '阿尔', { type: 'exp', delta: 900, chapter: 20 });
    invokeConfiguredAI.mockResolvedValue({
      ok: true,
      text: '```json\n{"branches":[{"id":"warrior","title":"铁壁","summary":"前排","events":[{"chapter":21,"type":"exp","delta":2000}]}],"recommendation":"warrior"}\n```',
    });
    const sim = await call<{
      result: {
        branches: Array<{
          id: string;
          events: Array<{ type: string }>;
          projected: { level: number };
        }>;
      };
      candidates: Array<{ id: string }>;
      startChapter: number;
    }>('growth-simulate', dir, '阿尔', {
      choices: ['warrior', 'mage', 42],
      mode: 'controlled',
      horizon: 5,
    });
    expect(sim.ok).toBe(true);
    expect(sim.data.startChapter).toBe(21);
    expect(sim.data.candidates.map((c) => c.id)).toEqual(['warrior', 'mage']);
    expect(sim.data.result.branches[0].events[0].type).toBe('choice');
    expect(sim.data.result.branches[0].projected.level).toBe(4);
    const payload = invokeConfiguredAI.mock.calls[0][0] as { prompt: string; systemPrompt: string };
    expect(payload.prompt).toContain('【受控成长】');
    expect(payload.systemPrompt).toContain('JSON');

    // 推演不会自动写入
    const before = await call<SnapshotLike>('growth-load', dir);
    expect(before.data.sheets[0].choices).toEqual([]);

    const applied = await call<{ snapshot: SnapshotLike; levelUps: number }>(
      'growth-apply-branch',
      dir,
      '阿尔',
      sim.data.result.branches[0]
    );
    expect(applied.ok).toBe(true);
    expect(applied.data.levelUps).toBe(1);
    expect(applied.data.snapshot.sheets[0].choices).toHaveLength(1);
    expect((await call('growth-apply-branch', dir, '阿尔', { nope: true })).ok).toBe(false);
  });

  it('growth-simulate 错误：受控模式缺候选、AI 未配置、AI 返回乱码、角色不存在', async () => {
    await call('growth-init', dir, 'dnd');
    await call('growth-ensure-sheet', dir, '阿尔');
    expect(await call('growth-simulate', dir, '阿尔', { mode: 'controlled' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('至少选择一个候选项'),
    });
    invokeConfiguredAI.mockResolvedValueOnce({ ok: false, error: '未配置 AI Key' });
    expect(await call('growth-simulate', dir, '阿尔', { mode: 'free' })).toMatchObject({
      ok: false,
      error: '未配置 AI Key',
    });
    invokeConfiguredAI.mockResolvedValueOnce({ ok: true, text: '我拒绝' });
    expect(await call('growth-simulate', dir, '阿尔', { mode: 'free' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('不是有效的 JSON'),
    });
    expect(await call('growth-simulate', dir, '路人', { mode: 'free' })).toMatchObject({
      ok: false,
      error: '角色成长卡不存在',
    });
  });

  it('memory-sync-snapshots 把数据库人物卡与设定导出为 Markdown', async () => {
    storeRows.characters = [
      {
        name: '阿尔',
        role: '主角',
        description: '北境少年',
        attributes: JSON.stringify({
          aliases: ['小阿'],
          currentState: [{ id: '1', label: '位置', value: '霜城' }],
        }),
      },
    ];
    storeRows.settings = [
      { title: '魔法体系', category: 'system', content: '元素魔法', tags: '["魔法"]' },
    ];
    const result = await call<{ characterFiles: string[]; settingFiles: string[] }>(
      'memory-sync-snapshots',
      dir
    );
    expect(result.ok).toBe(true);
    expect(result.data.characterFiles.map((f) => path.basename(f))).toEqual(['阿尔.md']);
    expect(result.data.settingFiles.map((f) => path.basename(f))).toEqual(['体系-魔法体系.md']);
    const card = await readFile(path.join(dir, '资料', '记忆', '角色卡', '阿尔.md'), 'utf-8');
    expect(card).toContain('- 位置：霜城');

    storeRows.novel = undefined;
    const empty = await call<{ characterFiles: string[]; removed: string[] }>(
      'memory-sync-snapshots',
      dir
    );
    expect(empty.data.characterFiles).toEqual([]);
    expect(empty.data.removed.map((f) => path.basename(f))).toContain('阿尔.md');
    storeRows.novel = { id: 7 };
  });

  it('数据库行解析容错', () => {
    expect(toCharacterSnapshot({ name: ' 阿尔 ', attributes: '{bad json' })).toEqual({
      name: '阿尔',
      role: undefined,
      description: undefined,
      aliases: [],
      currentState: [],
    });
    expect(toSettingSnapshot({ title: '术语', category: 'custom', tags: 'x' })).toEqual({
      title: '术语',
      category: 'custom',
      content: undefined,
      tags: [],
    });
  });
});
