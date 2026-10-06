/**
 * 示例作品集（apps/pc/sample-data）内容指纹：防止改了示例却忘记递增 sampleVersion。
 *
 * `.novel-editor/sample.json` 同时记录 `sampleVersion` 与 `contentHash`（对除 sample.json 本身与
 * 本机运行产物（core isSeedRuntimeArtifact）之外的所有文件，按相对路径排序后对「路径 + 字节」做 sha256）。
 * 单测（apps/pc/test/main/sample-data.test.ts）重新计算指纹，与记录不一致时失败，提示运行本脚本。
 *
 * 修改示例内容后运行（递增 sampleVersion 并刷新 contentHash，老用户的本机副本会在下次启动时升级）：
 *   pnpm exec tsx apps/pc/scripts/sample-content-hash.mts --bump
 * 只刷新指纹、不递增版本（例如只调整了换行且确认不需要老用户升级）：
 *   pnpm exec tsx apps/pc/scripts/sample-content-hash.mts --write
 * 不带参数时只检查，不一致时退出码为 1。
 *
 * core readSeedVersion / syncSeededDirectory 只读取 sampleVersion，contentHash 字段被忽略。
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSeedRuntimeArtifact } from '@novel-editor/core';

export const SAMPLE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../sample-data'
);
export const SAMPLE_META_RELATIVE = '.novel-editor/sample.json';
export const SAMPLE_HASH_COMMAND = 'pnpm exec tsx apps/pc/scripts/sample-content-hash.mts --bump';

/** 文本文件统一按 LF 计算，避免 Windows 检出（autocrlf）导致指纹不同 */
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.svg', '.yml']);

export interface SampleMeta {
  sampleVersion: number;
  contentHash?: string;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(absolute, base)));
    else if (entry.isFile()) result.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return result;
}

/** 参与指纹计算的文件（相对路径，/ 分隔，按码点排序） */
export async function listSampleContentFiles(root: string = SAMPLE_ROOT): Promise<string[]> {
  return (await listFiles(root))
    .filter((file) => file !== SAMPLE_META_RELATIVE && !isSeedRuntimeArtifact(file))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 计算示例内容指纹：sha256(路径 \0 字节数 \0 字节 …) */
export async function computeSampleContentHash(root: string = SAMPLE_ROOT): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await listSampleContentFiles(root)) {
    let bytes = await readFile(path.join(root, ...file.split('/')));
    if (TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      bytes = Buffer.from(bytes.toString('utf-8').replace(/\r\n/g, '\n'), 'utf-8');
    }
    hash.update(`${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function readSampleMeta(root: string = SAMPLE_ROOT): Promise<SampleMeta> {
  const raw = await readFile(path.join(root, ...SAMPLE_META_RELATIVE.split('/')), 'utf-8');
  return JSON.parse(raw) as SampleMeta;
}

export async function writeSampleMeta(meta: SampleMeta, root: string = SAMPLE_ROOT): Promise<void> {
  const ordered: SampleMeta = { sampleVersion: meta.sampleVersion, contentHash: meta.contentHash };
  await writeFile(
    path.join(root, ...SAMPLE_META_RELATIVE.split('/')),
    `${JSON.stringify(ordered, null, 2)}\n`,
    'utf-8'
  );
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function main(args: string[]): Promise<void> {
  const meta = await readSampleMeta();
  const contentHash = await computeSampleContentHash();
  if (args.includes('--bump') || args.includes('--write')) {
    const sampleVersion = args.includes('--bump') ? meta.sampleVersion + 1 : meta.sampleVersion;
    await writeSampleMeta({ sampleVersion, contentHash });
    console.log(`sample.json 已更新：sampleVersion ${sampleVersion}，contentHash ${contentHash}`);
    return;
  }
  if (meta.contentHash === contentHash) {
    console.log(`示例内容与 sample.json 一致（sampleVersion ${meta.sampleVersion}）`);
    return;
  }
  console.error(
    `示例内容已变更，请递增 sampleVersion 并更新 contentHash（运行 ${SAMPLE_HASH_COMMAND}）`
  );
  process.exitCode = 1;
}

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
