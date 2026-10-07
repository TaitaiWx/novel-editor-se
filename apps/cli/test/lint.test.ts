import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/run';

interface LintIssue {
  line: number;
  message: string;
}

interface LintData {
  target: string;
  fileCount: number;
  issueCount: number;
  files: { path: string; issues: LintIssue[] }[];
}

interface RunOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: {
    ok: boolean;
    data?: LintData;
    error?: { code: string; message: string; hint?: string };
  };
}

let dir: string;

async function ne(argv: string[]): Promise<RunOutput> {
  let stdout = '';
  let stderr = '';
  const { exitCode, envelope } = await runCli(argv, {
    cwd: dir,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      readStdin: async () => '',
    },
  });
  return { exitCode, stdout, stderr, json: envelope as RunOutput['json'] };
}

const CLEAN = [
  '---',
  'title: 离港',
  '---',
  ':::scene{#s-1 title=港口}',
  '12:30，雨夜，他喊了一声:char[阿舟]{id=linzhou}。',
  ':::',
  '',
].join('\n');

const BROKEN = [
  ':::scene{#s-1 title=港口}', // 1 未闭合（在下一场处结束）
  '雨夜。',
  ':::scene{#s-2 title=灯塔}', // 3
  '风大。',
  ':::', // 5
  ':::', // 6 多余
  '',
].join('\n');

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-cli-lint-'));
  await ne(['init']);
  await mkdir(path.join(dir, 'novels', '书'), { recursive: true });
  await writeFile(path.join(dir, 'novels', '书', '001-离港.md'), CLEAN, 'utf-8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ne lint 检查小说格式', () => {
  it('结构正确时 issueCount 为 0', async () => {
    const result = await ne(['lint', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.data?.issueCount).toBe(0);
    expect(result.json.data?.fileCount).toBeGreaterThanOrEqual(1);
    expect(result.json.data?.files).toEqual([]);

    const text = await ne(['lint']);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain('没有发现问题');
  });

  it('未闭合的场景与多余的 ::: 在 --json 中带行号', async () => {
    const file = path.join(dir, 'novels', '书', '002-灯塔.md');
    await writeFile(file, BROKEN, 'utf-8');
    const result = await ne(['lint', '--json']);
    expect(result.exitCode).toBe(0);
    const data = result.json.data;
    expect(data?.issueCount).toBe(2);
    expect(data?.files).toHaveLength(1);
    expect(data?.files[0].path).toBe(file);
    expect(data?.files[0].issues.map((issue) => issue.line)).toEqual([1, 6]);
    expect(data?.files[0].issues[0].message).toContain('港口');
    expect(data?.files[0].issues[1].message).toContain('多余的 :::');
  });

  it('可以只检查单个文件，人类可读输出为 路径:行号', async () => {
    await writeFile(path.join(dir, 'novels', '书', '002-灯塔.md'), BROKEN, 'utf-8');
    const result = await ne(['lint', 'novels/书/002-灯塔.md']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/002-灯塔\.md:1 /);
    expect(result.stdout).toMatch(/002-灯塔\.md:6 /);

    const clean = await ne(['lint', 'novels/书/001-离港.md', '--json']);
    expect(clean.json.data?.fileCount).toBe(1);
    expect(clean.json.data?.issueCount).toBe(0);
  });

  it('--strict 且有问题时以退出码 2 结束', async () => {
    await writeFile(path.join(dir, 'novels', '书', '002-灯塔.md'), BROKEN, 'utf-8');
    const result = await ne(['lint', '--strict', '--json']);
    expect(result.exitCode).toBe(2);
    expect(result.json.ok).toBe(false);
    expect(result.json.error?.code).toBe('INVALID_ARGUMENT');
    expect(result.json.error?.message).toContain('2 个');
  });

  it('--strict 没有问题时正常退出', async () => {
    const result = await ne(['lint', '--strict', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.json.data?.issueCount).toBe(0);
  });
});
