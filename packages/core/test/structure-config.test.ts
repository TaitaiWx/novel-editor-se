import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertValidStructureConfig,
  findStructureConfigRoot,
  readStructureConfig,
  writeStructureConfig,
} from '../src/structure-config';
import { initProject, loadProjectFromConfig, readProjectLayout } from '../src/project';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'structure-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('正文结构配置的存储', () => {
  it('普通文件夹：没有配置时用默认规则；保存到 .novel-editor/structure.json，不会变成 ne init 项目', async () => {
    const before = await readStructureConfig(dir);
    expect(before.stored).toBe(false);
    expect(before.location.kind).toBe('folder');
    expect(before.config).toEqual({ presets: ['zh', 'en'], custom: [] });

    const saved = await writeStructureConfig(dir, {
      presets: ['en'],
      custom: [{ id: 'sep', kind: 'scene', pattern: '^=== (.+) ===$' }],
    });
    expect(saved.location.file).toBe(path.join(dir, '.novel-editor', 'structure.json'));
    const json = JSON.parse(await readFile(saved.location.file, 'utf-8'));
    expect(json).toEqual({
      schemaVersion: 1,
      structure: {
        presets: ['en'],
        custom: [{ id: 'sep', kind: 'scene', pattern: '^=== (.+) ===$' }],
      },
    });
    expect(await readProjectLayout(dir)).toBeNull();
    const after = await readStructureConfig(dir);
    expect(after.stored).toBe(true);
    expect(after.config.presets).toEqual(['en']);
  });

  it('ne init 项目：写在 config.json 的 structure 字段，保留其他字段；ProjectConfig 读得到', async () => {
    const { project } = await initProject(dir, { name: '测试项目' });
    await writeStructureConfig(dir, { presets: ['zh', 'numbered'], custom: [] });
    const raw = JSON.parse(await readFile(project.configPath, 'utf-8'));
    expect(raw.name).toBe('测试项目');
    expect(raw.novelsDir).toBe('novels');
    expect(raw.structure).toEqual({ presets: ['zh', 'numbered'], custom: [] });
    const loaded = await loadProjectFromConfig(project.configPath);
    expect(loaded.config.structure).toEqual({ presets: ['zh', 'numbered'], custom: [] });
    expect((await readStructureConfig(dir)).location.kind).toBe('project');
  });

  it('读取时宽松：无效规则丢弃并给出 warnings；旧配置（没有 structure）用默认', async () => {
    await initProject(dir);
    expect(
      (await loadProjectFromConfig(path.join(dir, '.novel-editor/config.json'))).config.structure
    ).toBeUndefined();
    const configPath = path.join(dir, '.novel-editor', 'config.json');
    const raw = JSON.parse(await readFile(configPath, 'utf-8'));
    raw.structure = {
      presets: ['zh', 'nope'],
      custom: [
        { id: 'ok', kind: 'act', pattern: '^ACT' },
        { id: 'evil', kind: 'scene', pattern: '(x+)+y' },
      ],
    };
    await writeFile(configPath, JSON.stringify(raw), 'utf-8');
    const result = await readStructureConfig(dir);
    expect(result.config).toEqual({
      presets: ['zh'],
      custom: [{ id: 'ok', kind: 'act', pattern: '^ACT' }],
    });
    expect(result.warnings).toHaveLength(2);
  });

  it('写入时严格：任何无效项都拒绝，文件不变', async () => {
    await expect(writeStructureConfig(dir, { presets: ['xx'], custom: [] })).rejects.toThrow(
      /未知的预设/
    );
    await expect(
      writeStructureConfig(dir, {
        presets: [],
        custom: [{ id: 'a', kind: 'scene', pattern: '(a+)+' }],
      })
    ).rejects.toThrow(/嵌套量词/);
    await expect(
      writeStructureConfig(dir, {
        presets: [],
        custom: [
          { id: 'a', kind: 'scene', pattern: 'x' },
          { id: 'a', kind: 'act', pattern: 'y' },
        ],
      })
    ).rejects.toThrow(/重复/);
    expect(() => assertValidStructureConfig({ presets: [] })).toThrow(/presets 与 custom/);
    expect(() => assertValidStructureConfig(null)).toThrow();
    expect((await readStructureConfig(dir)).stored).toBe(false);
  });

  it('配置文件损坏时报错', async () => {
    await mkdir(path.join(dir, '.novel-editor'), { recursive: true });
    await writeFile(path.join(dir, '.novel-editor', 'structure.json'), '{oops', 'utf-8');
    await expect(readStructureConfig(dir)).rejects.toThrow(/解析失败/);
  });

  it('findStructureConfigRoot 向上查找', async () => {
    const nested = path.join(dir, 'a', 'b');
    await mkdir(nested, { recursive: true });
    expect(await findStructureConfigRoot(nested)).not.toBe(dir);
    await writeStructureConfig(dir, { presets: ['en'], custom: [] });
    expect(await findStructureConfigRoot(nested)).toBe(dir);
  });
});
