/**
 * 示例作品集（apps/pc/sample-data）完整性：
 * 它既是首次启动展示给用户的示范项目，也是 GUI E2E 的 fixture，任何改动都要保持这里全部通过。
 */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkMemory,
  getConfigPath,
  isSeedRuntimeArtifact,
  listChapters,
  listNovels,
  loadMemory,
  loadProjectFromConfig,
  normalizeAtlas,
  normalizePartyBook,
  normalizeRuleset,
  normalizeSheet,
  type LoadedMemory,
  type Project,
} from '@novel-editor/core';
import { validateProjectSeed } from '@novel-editor/store';
import {
  SAMPLE_DATA_DIR,
  buildSampleSeed,
  writeSampleData,
} from '../../scripts/generate-sample-data.mts';

const ROOT = SAMPLE_DATA_DIR;
const MEMORY_DIR = path.join(ROOT, '资料', '记忆');

/** 递归列出目录下所有文件（相对路径，统一 / 分隔） */
async function listFiles(dir: string, base = dir): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(absolute, base)));
    else result.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return result.sort();
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf-8')) as unknown;
}

let project: Project;
let memory: LoadedMemory;
let files: string[];

beforeAll(async () => {
  project = await loadProjectFromConfig(getConfigPath(ROOT));
  memory = await loadMemory(ROOT);
  files = await listFiles(ROOT);
});

describe('示例作品集 sample-data', () => {
  it('是标准的 ne init 项目：配置有效，作品与卷章顺序正确', async () => {
    expect(project.config).toMatchObject({
      schemaVersion: 1,
      name: '示例作品集',
      novelsDir: 'novels',
      chapterExtension: '.md',
    });
    const novels = await listNovels(project);
    expect(novels.map((novel) => [novel.name, novel.chapterCount])).toEqual([
      ['剑与诗', 2],
      ['星河旅人', 6],
    ]);
    const chapters = await listChapters(project, '星河旅人');
    expect(chapters.map((chapter) => [chapter.volume, chapter.order])).toEqual([
      ['第一卷-离乡', 1],
      ['第一卷-离乡', 2],
      ['第一卷-离乡', 3],
      ['第二卷-星海', 4],
      ['第二卷-星海', 5],
      ['第二卷-星海', 6],
    ]);
  });

  it('E2E 依赖的开篇文本保持不变', async () => {
    const read = (relative: string) => readFile(path.join(ROOT, relative), 'utf-8');
    expect(await read('novels/星河旅人/第一卷-离乡/001-启程.md')).toMatch(
      /^# 启程\n\n林舟背起行囊，走出了小镇。\n/
    );
    expect(await read('novels/星河旅人/第一卷-离乡/002-迷雾森林.md')).toContain(
      '森林里的雾气越来越浓。'
    );
    expect(await read('novels/剑与诗/001-少年.md')).toContain('少年握紧了手中的木剑。');
  });

  it('幕剧示例：每一章都有「第X幕 / 第X场」或「第X场」结构', async () => {
    for (const chapter of await listChapters(project, '星河旅人')) {
      const text = await readFile(chapter.path, 'utf-8');
      expect(text, chapter.file).toMatch(/^第[一二三四五六七八九十]+幕 /m);
      expect(text, chapter.file).toMatch(/^第[一二三四五六七八九十]+场 /m);
    }
  });

  it('记忆库与生成脚本的输出逐字节一致（修改后请运行 generate-sample-data.mts）', async () => {
    const out = await mkdtemp(path.join(os.tmpdir(), 'ne-sample-regen-'));
    try {
      await writeSampleData(out);
      const generated = (await listFiles(out)).filter((file) => !file.endsWith('.tmp'));
      const committed = files.filter(
        (file) => file.startsWith('资料/记忆/') || file === '.novel-editor/seed.json'
      );
      expect(committed).toEqual(generated);
      for (const file of generated) {
        expect(await readFile(path.join(ROOT, file), 'utf-8'), file).toBe(
          await readFile(path.join(out, file), 'utf-8')
        );
      }
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it('成长数据通过 core 规范化（再次规范化不变）且一致性检查没有错误与警告', async () => {
    expect(memory.initialized).toBe(true);
    expect(memory.issues).toEqual([]);
    const ruleset = await readJson(path.join(MEMORY_DIR, '规则.json'));
    expect(normalizeRuleset(ruleset)).toEqual(ruleset);
    expect(normalizePartyBook(await readJson(path.join(MEMORY_DIR, '队伍.json')))).toEqual(
      memory.party
    );
    expect(normalizeAtlas(await readJson(path.join(MEMORY_DIR, '地图.json')))).toEqual(
      memory.atlas
    );
    for (const sheet of memory.sheets) {
      const raw = await readJson(path.join(MEMORY_DIR, '角色', `${sheet.name}.json`));
      expect(normalizeSheet(raw)).toEqual(raw);
    }

    expect(memory.sheets.map((sheet) => [sheet.name, sheet.level])).toEqual([
      ['林舟', 4],
      ['苏晴', 3],
    ]);
    // 二选一 / 三选一示例：两人各自完成了道途抉择
    expect(memory.sheets.map((sheet) => sheet.choices.map((choice) => choice.optionId))).toEqual([
      ['warrior'],
      ['priest'],
    ]);
    const check = checkMemory(memory);
    expect(check.warnings).toEqual([]);
    expect(check.currentChapter).toBe(6);
    // 「被遗忘的配角」示例：秦伯（重点配角）与小石头
    expect(check.forgotten.map((item) => [item.name, item.important])).toEqual([
      ['秦伯', true],
      ['小石头', false],
    ]);
  });

  it('成长记录与正文一致：事件章节存在，且该章正文提到了这个角色', async () => {
    const chapters = await listChapters(project, '星河旅人');
    const textByOrder = new Map<number, string>();
    for (const chapter of chapters) {
      textByOrder.set(chapter.order as number, await readFile(chapter.path, 'utf-8'));
    }
    for (const sheet of memory.sheets) {
      for (const event of sheet.events) {
        const text = textByOrder.get(event.chapter as number);
        expect(text, `${sheet.name} 第 ${event.chapter} 章`).toBeDefined();
        expect(text, `${sheet.name} 第 ${event.chapter} 章`).toContain(sheet.name);
      }
    }
    for (const location of memory.atlas.locations) {
      expect(textByOrder.has(location.firstChapter as number), location.name).toBe(true);
    }
  });

  it('seed.json 可被 store 导入，人物覆盖成长档案中的角色', async () => {
    const raw = await readJson(path.join(ROOT, '.novel-editor', 'seed.json'));
    const seed = validateProjectSeed(raw);
    expect(raw).toEqual(buildSampleSeed());
    const names = seed.characters.map((row) => row.name);
    for (const sheet of memory.sheets) expect(names).toContain(sheet.name);
    expect(seed.world_settings?.length).toBeGreaterThan(0);
    expect(seed.outlines?.length).toBeGreaterThan(0);
    // 大纲里引用的章节 / 卷都真实存在
    for (const row of seed.outlines ?? []) {
      const scopePath = String(row.scope_path ?? '');
      if (scopePath)
        expect(
          files.some((file) => file.startsWith(scopePath)),
          scopePath
        ).toBe(true);
    }
  });

  it('欢迎使用.md 中提到的每个路径都存在', async () => {
    const welcome = await readFile(path.join(ROOT, '欢迎使用.md'), 'utf-8');
    const mentioned = Array.from(welcome.matchAll(/`([^`\s]+)`/g))
      .map((match) => match[1])
      .filter((token) => token.includes('/') || /\.\w+$/.test(token));
    expect(mentioned.length).toBeGreaterThan(15);
    for (const token of mentioned) {
      const relative = token.replace(/\/$/, '');
      const exists = files.some((file) => file === relative || file.startsWith(`${relative}/`));
      expect(exists, `欢迎使用.md 引用了不存在的路径: ${token}`).toBe(true);
    }
  });

  it('没有垃圾文件、空文件或本机运行产物，总体积可控', async () => {
    for (const file of files) {
      expect(isSeedRuntimeArtifact(file), file).toBe(false);
      expect(path.basename(file)).not.toMatch(/^(monica|large-novel\.txt|test-autosave\.md)$/);
      expect(file).not.toMatch(/\.tmp$/);
      expect((await stat(path.join(ROOT, file))).size, `${file} 不应为空`).toBeGreaterThan(0);
    }
    // 素材保持成对，便于版本对比演示
    const media = files.filter((file) => file.startsWith('资料/素材/') && !file.endsWith('.md'));
    for (const file of media.filter((item) => !/-alt\.\w+$/.test(item))) {
      expect(media, file).toContain(file.replace(/(\.\w+)$/, '-alt$1'));
    }
    let total = 0;
    for (const file of files) total += (await stat(path.join(ROOT, file))).size;
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });

  it('打包配置排除示例目录中的数据库与系统文件', async () => {
    const builder = await readFile(path.resolve(ROOT, '../electron-builder.yml'), 'utf-8');
    const block = builder.slice(builder.indexOf('- from: sample-data'));
    for (const pattern of ["'!**/.DS_Store'", "'!.novel-editor/*.db*'"]) {
      expect(block).toContain(pattern);
    }
  });
});
