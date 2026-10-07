import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/run';

interface RunOutput {
  exitCode: number;
  stdout: string;
  json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
}

let dir: string;

async function ne(argv: string[], stdin = ''): Promise<RunOutput> {
  let stdout = '';
  const { exitCode, envelope } = await runCli(argv, {
    cwd: dir,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => undefined,
      readStdin: async () => stdin,
    },
  });
  return { exitCode, stdout, json: envelope as RunOutput['json'] };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cli-structure-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ne structure', () => {
  it('list：没有保存时显示默认规则', async () => {
    const result = await ne(['structure', 'list', '--json']);
    expect(result.exitCode).toBe(0);
    const data = result.json.data as {
      stored: boolean;
      location: string;
      presets: { id: string; enabled: boolean }[];
    };
    expect(data.stored).toBe(false);
    expect(data.location).toBe('folder');
    expect(data.presets.map((p) => [p.id, p.enabled])).toEqual([
      ['zh', true],
      ['en', true],
      ['numbered', false],
    ]);
    const text = await ne(['structure', 'list']);
    expect(text.stdout).toContain('[x] zh');
    expect(text.stdout).toContain('[ ] numbered');
  });

  it('test：参数与 --stdin', async () => {
    const result = await ne([
      'structure',
      'test',
      'Chapter 1: The Harbor',
      'Act II',
      '第一场 清晨',
      'plain text.',
      '--json',
    ]);
    expect(result.json.data).toEqual({
      results: [
        { line: 'Chapter 1: The Harbor', kind: 'chapter', rule: 'en-chapter' },
        { line: 'Act II', kind: 'act', rule: 'en-act' },
        { line: '第一场 清晨', kind: 'scene', rule: 'zh-scene' },
        { line: 'plain text.', kind: null, rule: null },
      ],
    });
    const piped = await ne(['structure', 'test', '--stdin', '--json'], 'Scene 4\n\nhello\n');
    expect((piped.json.data as { results: unknown[] }).results).toHaveLength(2);
    expect((await ne(['structure', 'test'])).exitCode).toBe(2);
  });

  it('add / remove / preset：普通文件夹写 .novel-editor/structure.json', async () => {
    const added = await ne([
      'structure',
      'add',
      '--kind',
      'scene',
      '--pattern',
      '^=== (.+) ===$',
      '--json',
    ]);
    expect(added.exitCode).toBe(0);
    expect((added.json.data as { custom: unknown[] }).custom).toEqual([
      { id: 'custom-1', kind: 'scene', pattern: '^=== (.+) ===$' },
    ]);
    const file = path.join(dir, '.novel-editor', 'structure.json');
    expect(JSON.parse(await readFile(file, 'utf-8')).structure.custom).toHaveLength(1);

    const tested = await ne(['structure', 'test', '=== Dawn ===', '--json']);
    expect((tested.json.data as { results: { kind: string }[] }).results[0].kind).toBe('scene');

    const unsafe = await ne(['structure', 'add', '--kind', 'scene', '--pattern', '(a+)+']);
    expect(unsafe.exitCode).toBe(2);
    expect((await ne(['structure', 'add', '--kind', 'volume', '--pattern', 'x'])).exitCode).toBe(2);
    const dup = await ne([
      'structure',
      'add',
      '--kind',
      'act',
      '--pattern',
      'x',
      '--id',
      'custom-1',
    ]);
    expect(dup.exitCode).toBe(4);

    const preset = await ne([
      'structure',
      'preset',
      '--enable',
      'numbered',
      '--disable',
      'en',
      '--json',
    ]);
    expect(
      (preset.json.data as { presets: { id: string; enabled: boolean }[] }).presets
        .filter((p) => p.enabled)
        .map((p) => p.id)
    ).toEqual(['zh', 'numbered']);
    expect((await ne(['structure', 'preset', '--enable', 'klingon'])).exitCode).toBe(2);
    expect((await ne(['structure', 'preset'])).exitCode).toBe(2);

    expect((await ne(['structure', 'remove', 'custom-1'])).exitCode).toBe(0);
    expect((await ne(['structure', 'remove', 'custom-1'])).exitCode).toBe(3);
    expect(JSON.parse(await readFile(file, 'utf-8')).structure).toEqual({
      presets: ['zh', 'numbered'],
      custom: [],
    });
  });

  it('ne init 项目写 config.json 的 structure 字段；子目录里执行也找到项目', async () => {
    await ne(['init', '.']);
    await mkdir(path.join(dir, 'novels', 'Book'), { recursive: true });
    const sub = path.join(dir, 'novels', 'Book');
    const { exitCode } = await runCli(['structure', 'preset', '--disable', 'en', '--json'], {
      cwd: sub,
      io: { stdout: () => undefined, stderr: () => undefined, readStdin: async () => '' },
    });
    expect(exitCode).toBe(0);
    const config = JSON.parse(
      await readFile(path.join(dir, '.novel-editor', 'config.json'), 'utf-8')
    );
    expect(config.structure).toEqual({ presets: ['zh'], custom: [] });
    expect(config.novelsDir).toBe('novels');
  });

  it('ne lint 与 ne stats 使用项目的结构规则', async () => {
    const file = path.join(dir, 'a.md');
    await writeFile(
      file,
      [':::scene{title=Dock}', 'Rain.', '## next', '=== Part B ===', 'Chapter 2', 'text'].join(
        '\n'
      ),
      'utf-8'
    );
    const before = await ne(['stats', 'a.md', '--json']);
    expect((before.json.data as { structure: unknown }).structure).toEqual({
      chapters: 1,
      acts: 0,
      scenes: 0,
    });
    await ne(['structure', 'add', '--kind', 'chapter', '--pattern', '^=== .+ ===$']);
    const after = await ne(['stats', 'a.md', '--json']);
    expect((after.json.data as { structure: unknown }).structure).toEqual({
      chapters: 2,
      acts: 0,
      scenes: 0,
    });
    const lint = await ne(['lint', 'a.md', '--json']);
    expect((lint.json.data as { issueCount: number }).issueCount).toBe(1);
  });
});
