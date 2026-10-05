import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyGrowthEvent,
  deleteSheet,
  ensureSheet,
  getMemoryDir,
  initMemory,
  loadMemory,
  saveAtlas,
  saveParty,
  saveRuleset,
  saveSheet,
  syncMemorySnapshots,
  toMemoryFileName,
  addParty,
  recordVisit,
} from '../src';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ne-growth-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('记忆库文件读写', () => {
  it('未初始化时返回默认值', async () => {
    const memory = await loadMemory(root);
    expect(memory.initialized).toBe(false);
    expect(memory.dir).toBe(path.join(root, '资料', '记忆'));
    expect(memory.sheets).toEqual([]);
    expect(memory.ruleset.levels.maxLevel).toBe(20);
  });

  it('init 创建目录结构，重复执行不覆盖，--force 只覆盖规则', async () => {
    const first = await initMemory(root, { template: 'dnd' });
    expect(first.created.map((file) => path.basename(file))).toEqual([
      '规则.json',
      '队伍.json',
      '地图.json',
    ]);
    const files = await readdir(getMemoryDir(root));
    expect(files).toEqual(
      expect.arrayContaining(['规则.json', '队伍.json', '地图.json', 'README.md', '角色'])
    );
    const memory = await loadMemory(root);
    expect(memory.initialized).toBe(true);
    expect(memory.ruleset.attributes).toHaveLength(6);

    const second = await initMemory(root, { template: 'blank' });
    expect(second.created).toEqual([]);
    expect((await loadMemory(root)).ruleset.attributes).toHaveLength(6);

    const forced = await initMemory(root, { template: 'blank', force: true });
    expect(forced.created.map((file) => path.basename(file))).toEqual(['规则.json']);
    expect((await loadMemory(root)).ruleset.attributes).toHaveLength(0);
  });

  it('角色卡 round-trip，生成 Markdown 摘要与 README', async () => {
    await initMemory(root);
    const { sheet, created } = await ensureSheet(root, '阿尔', ['小阿']);
    expect(created).toBe(true);
    const memory = await loadMemory(root);
    const updated = applyGrowthEvent(memory.ruleset, sheet, {
      type: 'exp',
      delta: 400,
      chapter: 3,
    }).sheet;
    await saveSheet(root, updated);

    const reloaded = await loadMemory(root);
    expect(reloaded.sheets).toHaveLength(1);
    expect(reloaded.sheets[0]).toMatchObject({
      name: '阿尔',
      aliases: ['小阿'],
      level: 2,
      exp: 400,
    });
    const md = await readFile(path.join(getMemoryDir(root), '角色', '阿尔.md'), 'utf-8');
    expect(md).toContain('等级：**2**');
    const readme = await readFile(path.join(getMemoryDir(root), 'README.md'), 'utf-8');
    expect(readme).toContain('[阿尔](角色/');

    // 用别名查找已有角色，并合并新别名
    const again = await ensureSheet(root, '小阿', ['阿尔大人']);
    expect(again.created).toBe(false);
    expect(again.sheet.aliases).toEqual(['小阿', '阿尔大人']);

    await deleteSheet(root, '阿尔');
    expect((await loadMemory(root)).sheets).toEqual([]);
  });

  it('损坏的角色卡被跳过并报告，损坏的规则直接报错', async () => {
    await initMemory(root);
    const dir = path.join(getMemoryDir(root), '角色');
    await writeFile(path.join(dir, '坏.json'), '{ not json', 'utf-8');
    await writeFile(path.join(dir, '旧.json'), JSON.stringify({ level: 3 }), 'utf-8');
    const memory = await loadMemory(root);
    expect(memory.sheets.map((s) => s.name)).toEqual(['旧']);
    expect(memory.issues).toHaveLength(1);
    expect(memory.issues[0]).toContain('坏.json');

    await writeFile(path.join(getMemoryDir(root), '规则.json'), '{', 'utf-8');
    await expect(loadMemory(root)).rejects.toThrow(/JSON 解析失败/);
  });

  it('保存规则、队伍、地图时进行规范化', async () => {
    await initMemory(root);
    const memory = await loadMemory(root);
    const saved = await saveRuleset(root, { ...memory.ruleset, name: '新规则' });
    expect(saved.name).toBe('新规则');
    await saveParty(
      root,
      addParty(memory.party, { name: '银月', members: ['阿尔'], fromChapter: 1 })
    );
    await saveAtlas(root, recordVisit(memory.atlas, '霜城', '阿尔', 2));
    const reloaded = await loadMemory(root);
    expect(reloaded.ruleset.name).toBe('新规则');
    expect(reloaded.party.parties[0].name).toBe('银月');
    expect(reloaded.atlas.locations[0].visits).toEqual([{ character: '阿尔', chapter: 2 }]);
  });

  it('文件名去除非法字符', () => {
    expect(toMemoryFileName(' a/b:c ')).toBe('a_b_c');
    expect(toMemoryFileName('..secret')).toBe('_secret');
    expect(() => toMemoryFileName('   ')).toThrow();
  });

  it('同步数据库快照：生成 Markdown 并清理过期快照，保留作者文件', async () => {
    await initMemory(root);
    const cardsDir = path.join(getMemoryDir(root), '角色卡');
    await mkdir(cardsDir, { recursive: true });
    await writeFile(path.join(cardsDir, '已删除角色.md'), 'old', 'utf-8');
    await writeFile(path.join(cardsDir, '作者笔记.txt'), 'keep', 'utf-8');
    const result = await syncMemorySnapshots(root, {
      characters: [
        {
          name: '阿尔',
          role: '主角',
          description: '北境少年',
          aliases: ['小阿'],
          currentState: [{ label: '位置', value: '霜城' }],
        },
        { name: '阿尔', role: '同名' },
        { name: '  ' },
      ],
      settings: [{ title: '魔法体系', category: '体系', content: '元素魔法', tags: ['魔法'] }],
    });
    expect(result.characterFiles.map((f) => path.basename(f))).toEqual(['阿尔.md', '阿尔-2.md']);
    expect(result.settingFiles.map((f) => path.basename(f))).toEqual(['体系-魔法体系.md']);
    expect(result.removed.map((f) => path.basename(f))).toEqual(['已删除角色.md']);
    const card = await readFile(path.join(cardsDir, '阿尔.md'), 'utf-8');
    expect(card).toContain('定位：主角');
    expect(card).toContain('- 位置：霜城');
    expect(await readdir(cardsDir)).toContain('作者笔记.txt');
  });
});
