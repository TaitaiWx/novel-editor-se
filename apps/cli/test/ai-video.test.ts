import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/run';

/** 本地 mock 的 OpenAI 兼容服务：/v1/chat/completions，支持流式与非流式 */
interface MockState {
  requests: Array<{ auth?: string; body: Record<string, unknown> }>;
  reply: string;
  status: number;
}

const state: MockState = { requests: [], reply: '', status: 200 };
let server: Server;
let baseUrl: string;
let dir: string;

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    state.requests.push({ auth: req.headers.authorization, body });
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    if (state.status !== 200) {
      res.writeHead(state.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
      return;
    }
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: state.reply } }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // 故意按 5 个字符切片，验证 SSE 解析能处理分片
    const pieces = Array.from(state.reply).reduce<string[]>((acc, ch, i) => {
      if (i % 5 === 0) acc.push('');
      acc[acc.length - 1] += ch;
      return acc;
    }, []);
    for (const piece of pieces) {
      res.write(
        `data: ${JSON.stringify({ model: 'mock-1', choices: [{ delta: { content: piece } }] })}\n\n`
      );
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-cli-ai-'));
  state.requests = [];
  state.reply = '';
  state.status = 200;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function ne(argv: string[], options: { env?: Record<string, string>; stdin?: string } = {}) {
  let stdout = '';
  let stderr = '';
  const { exitCode, envelope } = await runCli(argv, {
    cwd: dir,
    env: options.env ?? {},
    io: {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      readStdin: async () => options.stdin ?? '',
    },
  });
  return {
    exitCode,
    stdout,
    stderr,
    json: envelope as {
      ok: boolean;
      data?: Record<string, unknown>;
      error?: { code: string; message: string; hint?: string };
    },
  };
}

const grokEnv = () => ({
  NOVEL_EDITOR_GROK_API_KEY: 'xai-test',
  NOVEL_EDITOR_GROK_BASE_URL: baseUrl,
});
const chapter = '林舟握紧长剑，望向雾林深处。\n\n苏晴低声说：“别冲动。”';

describe('ne ai continue', () => {
  it('没有 Key 时只输出提示词（含上下文摘要）', async () => {
    await writeFile(path.join(dir, '001.md'), chapter);
    const out = await ne(['ai', 'continue', '001.md', '--json']);
    expect(out.exitCode).toBe(0);
    expect(out.json.data).toMatchObject({
      mode: 'prompt',
      provider: 'grok',
      envKey: 'NOVEL_EDITOR_GROK_API_KEY',
    });
    expect(String(out.json.data?.prompt)).toContain('【前文（001）】');
    expect(String(out.json.data?.prompt)).toContain('别冲动');
    expect(out.stderr).toContain('未设置 NOVEL_EDITOR_GROK_API_KEY');
    expect(state.requests).toHaveLength(0);
    const human = await ne([
      'ai',
      'continue',
      '001.md',
      '--prompt-only',
      '--direction',
      'conflict',
    ]);
    expect(human.stdout).toContain('=== system ===');
    expect(human.stdout).toContain('制造新的冲突');
    expect(human.stderr).toBe('');
  });

  it('有 Key：流式输出到 stdout，请求带上成长档案与核心规则', async () => {
    await writeFile(path.join(dir, '001.md'), chapter);
    expect((await ne(['growth', 'init'])).exitCode).toBe(0);
    expect((await ne(['growth', 'exp', '林舟', '300'])).exitCode).toBe(0);
    expect((await ne(['growth', 'rules', '--add', '林舟在第十章前不得超过 5 级'])).exitCode).toBe(
      0
    );
    state.reply = '别冲动。”林舟收剑入鞘，雾气在他脚边翻涌。';
    const out = await ne(['ai', 'continue', '001.md', '--chars', '120'], { env: grokEnv() });
    expect(out.exitCode).toBe(0);
    // stdout 是模型原样流式输出（末尾补换行）
    expect(out.stdout).toBe(`${state.reply}\n`);
    const request = state.requests[0];
    expect(request.auth).toBe('Bearer xai-test');
    expect(request.body).toMatchObject({ model: 'grok-4', stream: true, max_tokens: 180 });
    const user = (request.body.messages as Array<{ role: string; content: string }>)[1].content;
    expect(user).toContain('【核心规则】');
    expect(user).toContain('林舟在第十章前不得超过 5 级');
    expect(user).toContain('【成长档案】');
    expect(user).toContain('续写约 120 字');
    // JSON 模式：清理掉与前文重复的开头
    const json = await ne(
      ['ai', 'continue', '001.md', '--json', '--no-memory', '-m', 'grok-3-mini'],
      { env: grokEnv() }
    );
    expect(json.stdout).not.toContain('林舟收剑入鞘，雾气在他脚边翻涌。\n{');
    expect(json.json.data).toMatchObject({
      mode: 'completion',
      text: '林舟收剑入鞘，雾气在他脚边翻涌。',
      finishReason: 'stop',
      model: 'mock-1',
    });
    expect(state.requests[1].body).toMatchObject({ model: 'grok-3-mini' });
    expect(
      (state.requests[1].body.messages as Array<{ content: string }>)[1].content
    ).not.toContain('【成长档案】');
  });

  it('鉴权失败：退出码 1，错误码 AI_ERROR 并提示检查环境变量', async () => {
    await writeFile(path.join(dir, '001.md'), chapter);
    state.status = 401;
    const out = await ne(['ai', 'continue', '001.md', '--json'], { env: grokEnv() });
    expect(out.exitCode).toBe(1);
    expect(out.json.error).toMatchObject({
      code: 'AI_ERROR',
      message: '[auth] Incorrect API key provided',
    });
    expect(out.json.error?.hint).toContain('NOVEL_EDITOR_GROK_API_KEY');
  });

  it('参数校验', async () => {
    await writeFile(path.join(dir, '001.md'), chapter);
    expect((await ne(['ai', 'continue', 'missing.md', '--json'])).json.error?.code).toBe(
      'NOT_FOUND'
    );
    expect((await ne(['ai', 'continue', '001.md', '--budget', '10'])).exitCode).toBe(2);
    expect((await ne(['ai', 'continue', '001.md', '--cursor', '-1'])).exitCode).toBe(2);
    expect((await ne(['ai', 'continue', '001.md', '--chars', '0'])).exitCode).toBe(2);
    expect((await ne(['ai', 'continue', '001.md', '--provider', 'minimax-video'])).exitCode).toBe(
      2
    );
    expect(
      (await ne(['ai', 'continue', '001.md', '--outline', 'nope.md', '--json'])).json.error?.code
    ).toBe('NOT_FOUND');
    await writeFile(path.join(dir, 'outline.md'), '林舟与狼王对峙');
    const withOutline = await ne([
      'ai',
      'continue',
      '001.md',
      '--outline',
      'outline.md',
      '--cursor',
      '5',
      '--json',
    ]);
    expect(String(withOutline.json.data?.prompt)).toContain('【本章章纲】');
    expect(String(withOutline.json.data?.prompt)).toContain('【光标后的内容】');
  });
});

const storyboardReply = JSON.stringify({
  shots: [
    { shotSize: '远景', durationSec: 6, description: '月夜雪原，林舟独立', camera: '缓慢推近' },
    {
      shotSize: 'close-up',
      durationSec: 4,
      description: '狼王的眼睛在雾中亮起',
      characters: ['狼王'],
    },
  ],
});

describe('ne video storyboard / validate', () => {
  it('没有 Key：从 stdin 读取场景，输出提示词与 schema', async () => {
    const out = await ne(
      [
        'video',
        'storyboard',
        '--stdin',
        '--json',
        '--style',
        '水墨',
        '--characters',
        '林舟:黑衣长剑,苏晴',
      ],
      { stdin: chapter }
    );
    expect(out.json.data).toMatchObject({
      mode: 'prompt',
      next: 'ne video validate <ai-result.json>',
    });
    expect(out.json.data?.schema).toMatchObject({ required: ['shots'] });
    expect(String(out.json.data?.prompt)).toContain('- 林舟：黑衣长剑');
    expect(String(out.json.data?.prompt)).toContain('画面风格：水墨');
  });

  it('有 Key：生成、校验并保存分镜', async () => {
    await writeFile(path.join(dir, 'scene.md'), chapter);
    state.reply = `\`\`\`json\n${storyboardReply}\n\`\`\``;
    const out = await ne(
      [
        'video',
        'storyboard',
        'scene.md',
        '--ratio',
        '9:16',
        '--title',
        '雾林',
        '--out',
        'board.json',
      ],
      { env: grokEnv() }
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('| 1 | 远景 | 6s | 月夜雪原，林舟独立 | 缓慢推近 |');
    expect(out.stdout).toContain('比例：9:16');
    const saved = JSON.parse(await readFile(path.join(dir, 'board.json'), 'utf-8'));
    expect(saved).toMatchObject({
      title: '雾林',
      aspectRatio: '9:16',
      shots: [{ shotSize: '远景' }, { shotSize: '特写' }],
    });
    const json = await ne(['video', 'storyboard', 'scene.md', '--json'], { env: grokEnv() });
    expect(json.json.data).toMatchObject({
      mode: 'completion',
      storyboard: { shots: [{ id: 'shot-1' }, { id: 'shot-2' }] },
    });
    expect(state.requests[0].body).toMatchObject({ temperature: 0.7, max_tokens: 2400 });
  });

  it('AI 返回无效分镜：退出码 2', async () => {
    await writeFile(path.join(dir, 'scene.md'), chapter);
    state.reply = '抱歉，我无法完成';
    const out = await ne(['video', 'storyboard', 'scene.md', '--json'], { env: grokEnv() });
    expect(out.exitCode).toBe(2);
    expect(out.json.error?.message).toContain('分镜无效');
  });

  it('validate：规范化、警告与错误', async () => {
    await writeFile(
      path.join(dir, 'ai.json'),
      storyboardReply.replace('"durationSec":6', '"durationSec":40')
    );
    const ok = await ne(['video', 'validate', 'ai.json', '--ratio', '1:1']);
    expect(ok.exitCode).toBe(0);
    expect(ok.stderr).toContain('超出范围');
    expect(ok.stdout).toContain('比例：1:1');
    const bad = await ne(['video', 'validate', '--stdin', '--json'], { stdin: '{"shots":[]}' });
    expect(bad.exitCode).toBe(2);
    expect((await ne(['video', 'validate', '--json'])).json.error?.code).toBe('USAGE');
    expect((await ne(['video', 'validate', 'nope.json', '--json'])).json.error?.code).toBe(
      'NOT_FOUND'
    );
    expect((await ne(['video', 'storyboard', '--stdin', '--json'], { stdin: '  ' })).exitCode).toBe(
      2
    );
    expect(
      (
        await ne(['video', 'storyboard', '--stdin', '--min-shots', '5', '--max-shots', '2'], {
          stdin: 'x',
        })
      ).exitCode
    ).toBe(2);
  });
});
