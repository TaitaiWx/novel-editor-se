/**
 * 用真实 Key 检查各 AI 服务（与应用同一套 @novel-editor/ai 实现）：文本 / 图片 / 视频 / 配音。
 *
 * Key 只从环境变量读取，不写进仓库、不打印：
 *   NE_LIVE_DEEPSEEK_KEY / NE_LIVE_OPENAI_KEY / NE_LIVE_GROK_KEY / NE_LIVE_GEMINI_KEY /
 *   NE_LIVE_VOLC_KEY（火山方舟）/ NE_LIVE_VOLC_SPEECH_KEY（豆包语音）/ NE_LIVE_MINIMAX_KEY
 * 建议放在仓库外的文件里（chmod 600），运行前 `set -a; . <文件>; set +a`。
 *
 * 境外服务走代理：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890（国内服务加进 NO_PROXY）。
 *
 * 用法（在仓库根目录）：
 *   pnpm exec tsx apps/pc/scripts/live-ai-check.mts [--only text,image,video,speech] [--filter openai]
 * 视频会产生费用（每个服务只提交一条最短、最低分辨率的任务），默认不跑，需要 --only 里明确写 video。
 *
 * 结果写进示例作品《星河旅人》的 `资料/AI实测/`（可用 --out 改目录）：图片 / 音频 / 视频文件 +「实测结果.md」
 * （用 ::image / ::audio / ::video 嵌入，在应用里打开就能直接看、直接播放；多次运行按服务合并）。
 * 这个目录被 .gitignore 忽略、不进安装包与示例副本（core isSeedRuntimeArtifact），只在本机查看。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultRegistry, toAIError, type ProviderConfig } from '@novel-editor/ai';

type Kind = 'text' | 'image' | 'video' | 'speech';

interface LiveCase {
  name: string;
  kind: Kind;
  vendor: string;
  keyEnv: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
}

const CASES: LiveCase[] = [
  // 文本
  {
    name: 'DeepSeek',
    kind: 'text',
    vendor: 'openai-compatible',
    keyEnv: 'NE_LIVE_DEEPSEEK_KEY',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
  {
    name: 'OpenAI gpt-5.4-mini',
    kind: 'text',
    vendor: 'openai-compatible',
    keyEnv: 'NE_LIVE_OPENAI_KEY',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
  },
  {
    name: 'OpenAI gpt-6-luna',
    kind: 'text',
    vendor: 'openai-compatible',
    keyEnv: 'NE_LIVE_OPENAI_KEY',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
  },
  { name: 'Grok', kind: 'text', vendor: 'grok', keyEnv: 'NE_LIVE_GROK_KEY', model: 'grok-4.7' },
  {
    name: 'Gemini',
    kind: 'text',
    vendor: 'openai-compatible',
    keyEnv: 'NE_LIVE_GEMINI_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
  },
  {
    name: '豆包（火山方舟）',
    kind: 'text',
    vendor: 'openai-compatible',
    keyEnv: 'NE_LIVE_VOLC_KEY',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-lite-260915',
  },
  // 图片
  { name: 'Seedream', kind: 'image', vendor: 'seedream-image', keyEnv: 'NE_LIVE_VOLC_KEY' },
  { name: 'MiniMax 图片', kind: 'image', vendor: 'minimax-image', keyEnv: 'NE_LIVE_MINIMAX_KEY' },
  { name: 'Grok 图片', kind: 'image', vendor: 'grok-image', keyEnv: 'NE_LIVE_GROK_KEY' },
  { name: 'OpenAI 图片', kind: 'image', vendor: 'openai-image', keyEnv: 'NE_LIVE_OPENAI_KEY' },
  { name: 'Gemini 图片', kind: 'image', vendor: 'gemini-image', keyEnv: 'NE_LIVE_GEMINI_KEY' },
  // 配音
  { name: 'MiniMax 配音', kind: 'speech', vendor: 'minimax-speech', keyEnv: 'NE_LIVE_MINIMAX_KEY' },
  { name: 'OpenAI 配音', kind: 'speech', vendor: 'openai-speech', keyEnv: 'NE_LIVE_OPENAI_KEY' },
  { name: 'Gemini 配音', kind: 'speech', vendor: 'gemini-speech', keyEnv: 'NE_LIVE_GEMINI_KEY' },
  { name: 'Grok 配音', kind: 'speech', vendor: 'grok-speech', keyEnv: 'NE_LIVE_GROK_KEY' },
  {
    name: '豆包语音',
    kind: 'speech',
    vendor: 'volcengine-speech',
    keyEnv: 'NE_LIVE_VOLC_SPEECH_KEY',
  },
  // 视频（产生费用，需 --only video）
  { name: 'MiniMax 海螺', kind: 'video', vendor: 'minimax-video', keyEnv: 'NE_LIVE_MINIMAX_KEY' },
  {
    name: 'Seedance',
    kind: 'video',
    vendor: 'seedance-video',
    keyEnv: 'NE_LIVE_VOLC_KEY',
    model: 'doubao-seedance-2-0-mini-260615',
  },
  { name: 'Grok 视频', kind: 'video', vendor: 'grok-video', keyEnv: 'NE_LIVE_GROK_KEY' },
  { name: 'Gemini Omni', kind: 'video', vendor: 'gemini-video', keyEnv: 'NE_LIVE_GEMINI_KEY' },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const only = new Set((arg('only') ?? 'text,image,speech').split(',').map((item) => item.trim()));
const filter = arg('filter')?.toLowerCase();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 示例作品目录（媒体指令的 src 相对它） */
const WORK_DIR = path.resolve(SCRIPT_DIR, '..', 'sample-data', 'novels', '星河旅人');
const LIVE_DIR_NAME = 'AI实测';
const outDir = path.resolve(arg('out') ?? path.join(WORK_DIR, '资料', LIVE_DIR_NAME));
mkdirSync(outDir, { recursive: true });
const registry = createDefaultRegistry();

const KIND_LABEL: Record<Kind, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  speech: '配音',
};

/** 文件名：类型-服务（去掉路径分隔符等不安全字符） */
function fileBase(item: LiveCase): string {
  return `${KIND_LABEL[item.kind]}-${item.name}`.replace(/[\\/:*?"<>|\s]+/g, '_');
}

interface CaseOutcome {
  summary: string;
  /** 生成的文件名（相对 outDir） */
  file?: string;
  /** 文本结果 */
  text?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCase(item: LiveCase): Promise<CaseOutcome | null> {
  const apiKey = process.env[item.keyEnv]?.trim();
  if (!apiKey) return null;
  if (!registry.has(item.vendor)) return null;
  const config: ProviderConfig = {
    apiKey,
    ...(item.baseUrl ? { baseUrl: item.baseUrl } : {}),
    ...(item.model ? { model: item.model } : {}),
    ...(item.voice ? { voice: item.voice } : {}),
  };
  const base = fileBase(item);
  const save = (fileName: string, data: Uint8Array) =>
    writeFileSync(path.join(outDir, fileName), data);
  switch (item.kind) {
    case 'text': {
      const provider = registry.createText(item.vendor, config);
      await provider.testConnection();
      const result = await provider.complete({
        messages: [{ role: 'user', content: '用一句话描写黄昏的港口，不超过 30 字。' }],
        maxTokens: 400,
      });
      let streamed = '';
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: '只回复：好' }],
        maxTokens: 200,
      })) {
        if (chunk.type === 'delta') streamed += chunk.text;
      }
      return {
        summary: `测试连接 ✓｜补全：${result.text.trim().slice(0, 40)}｜流式：${streamed.trim().slice(0, 10)}`,
        text: `${result.text.trim()}\n\n流式：${streamed.trim()}`,
      };
    }
    case 'image': {
      const provider = registry.createImage(item.vendor, config);
      const result = await provider.generate({
        prompt: 'A lighthouse on a cliff at dusk, watercolor illustration',
        aspectRatio: '1:1',
        count: 1,
      });
      const image = result.images[0];
      if (!image) throw new Error('没有返回图片');
      let bytes: Buffer;
      if (image.base64) bytes = Buffer.from(image.base64, 'base64');
      else bytes = Buffer.from(await (await fetch(image.url ?? '')).arrayBuffer());
      const file = `${base}.${(image.mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`;
      save(file, bytes);
      return { summary: `图片 ${Math.round(bytes.length / 1024)}KB`, file };
    }
    case 'speech': {
      const provider = registry.createSpeech(item.vendor, config);
      const result = await provider.synthesize({
        text: '林舟把行囊往肩上一甩，朝码头走去。',
        language: 'zh-CN',
        voice: { gender: 'male' },
      });
      const file = `${base}.${result.format}`;
      save(file, result.data);
      const duration = result.durationSec ? ` ${result.durationSec.toFixed(1)}s` : '';
      return {
        summary: `音频 ${result.format}${duration} ${Math.round(result.data.length / 1024)}KB`,
        file,
      };
    }
    case 'video': {
      const provider = registry.createVideo(item.vendor, config);
      const task = await provider.submitTask({
        prompt: 'A paper boat drifting on a calm harbor at dusk, gentle camera push in',
        durationSec: 4,
        aspectRatio: '16:9',
        resolution: '480p',
      });
      const started = Date.now();
      for (;;) {
        await sleep(10_000);
        const poll = await provider.pollTask(task.remoteTaskId);
        if (poll.state === 'failed') throw new Error(poll.error?.message ?? '任务失败');
        if (poll.state === 'succeeded') break;
        if (Date.now() - started > 15 * 60_000) throw new Error('超过 15 分钟仍未完成');
      }
      const result = await provider.fetchResult(task.remoteTaskId);
      const response = await fetch(result.url, { headers: result.headers ?? {} });
      if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const file = `${base}.mp4`;
      save(file, bytes);
      return {
        summary: `视频 ${Math.round(bytes.length / 1024)}KB，生成 ${Math.round((Date.now() - started) / 1000)}s`,
        file,
      };
    }
  }
}

/** 历次结果（按「类型 + 服务」合并，生成实测结果.md） */
interface RecordEntry {
  kind: Kind;
  name: string;
  vendor: string;
  model?: string;
  ok: boolean;
  summary: string;
  file?: string;
  text?: string;
  seconds: number;
  at: string;
}
const recordFile = path.join(outDir, '结果.json');
const records: Record<string, RecordEntry> = existsSync(recordFile)
  ? (JSON.parse(readFileSync(recordFile, 'utf-8')) as Record<string, RecordEntry>)
  : {};

let ran = 0;
let failed = 0;
for (const item of CASES) {
  if (!only.has(item.kind)) continue;
  if (filter && !`${item.name} ${item.vendor}`.toLowerCase().includes(filter)) continue;
  const started = Date.now();
  let entry: Omit<RecordEntry, 'seconds' | 'at'>;
  try {
    const outcome = await runCase(item);
    if (!outcome) {
      console.log(`${item.kind}\t${item.name}\t跳过（没有 Key 或还没有实现）`);
      continue;
    }
    entry = {
      kind: item.kind,
      name: item.name,
      vendor: item.vendor,
      model: item.model,
      ok: true,
      ...outcome,
    };
  } catch (error) {
    const aiError = toAIError(error);
    entry = {
      kind: item.kind,
      name: item.name,
      vendor: item.vendor,
      model: item.model,
      ok: false,
      summary: `[${aiError.kind}] ${aiError.message}`.slice(0, 300),
    };
    failed += 1;
  }
  ran += 1;
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  records[`${item.kind}:${item.name}`] = { ...entry, seconds, at: new Date().toISOString() };
  console.log(
    `${item.kind}\t${item.name}\t${entry.ok ? '✓' : '✗'} ${entry.summary}（${seconds}s）`
  );
}

writeFileSync(recordFile, `${JSON.stringify(records, null, 2)}\n`);
writeFileSync(path.join(outDir, '实测结果.md'), renderReport(Object.values(records)));
console.log(`\n共 ${ran} 项，失败 ${failed} 项；结果：${path.join(outDir, '实测结果.md')}`);
process.exitCode = failed > 0 ? 1 : 0;

/** 实测结果.md：每个服务一节，媒体用 ::image / ::audio / ::video 就地显示（src 相对作品目录） */
function renderReport(entries: RecordEntry[]): string {
  const relative = path.relative(WORK_DIR, outDir).split(path.sep).join('/');
  const inWork = !relative.startsWith('..');
  const lines = [
    '# AI 服务实测结果',
    '',
    '用真实 Key 调用各服务的结果（apps/pc/scripts/live-ai-check.mts 生成，只在本机，不会提交）。',
    '把光标移开就能看到图片、播放音频和视频。',
    '',
  ];
  for (const kind of ['text', 'image', 'speech', 'video'] as const) {
    const group = entries.filter((entry) => entry.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${KIND_LABEL[kind]}`, '');
    for (const entry of group) {
      const model = entry.model ? ` · ${entry.model}` : '';
      lines.push(
        `### ${entry.ok ? '✓' : '✗'} ${entry.name}${model}`,
        '',
        `${entry.summary}（${entry.seconds}s，${new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}）`,
        ''
      );
      if (entry.text) lines.push(...entry.text.split('\n').map((line) => `> ${line}`), '');
      if (entry.file && inWork) {
        const directive = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio';
        lines.push(`::${directive}[${entry.name}]{src="${relative}/${entry.file}"}`, '');
      } else if (entry.file) {
        lines.push(`文件：${entry.file}`, '');
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
