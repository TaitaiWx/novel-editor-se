import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { publishSampleMedia } from '../../scripts/sample-media-generation.mts';
import { computeSampleContentHash } from '../../scripts/sample-content-hash.mts';
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('素材与种子及内容指纹一起发布；默认预览、失败均保留原文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ne-media-'));
  temporary.push(root);
  await mkdir(path.join(root, '.novel-editor'));
  await writeFile(
    path.join(root, '.novel-editor/sample.json'),
    JSON.stringify({ sampleVersion: 7 })
  );
  await writeFile(path.join(root, 'author.txt'), 'original');
  const generate = async (stage: string) => {
    await writeFile(path.join(stage, 'asset.webp'), 'new image');
  };
  await publishSampleMedia(root, generate);
  await expect(readFile(path.join(root, 'asset.webp'))).rejects.toThrow();
  await expect(
    publishSampleMedia(
      root,
      async (stage) => {
        await generate(stage);
        throw new Error('encoder failed');
      },
      true
    )
  ).rejects.toThrow('encoder failed');
  expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('original');
  await publishSampleMedia(root, generate, true);
  expect(await readFile(path.join(root, 'asset.webp'), 'utf8')).toBe('new image');
  expect(
    JSON.parse(await readFile(path.join(root, '.novel-editor/seed.json'), 'utf8')).novels.length
  ).toBeGreaterThan(0);
  const meta = JSON.parse(await readFile(path.join(root, '.novel-editor/sample.json'), 'utf8'));
  expect(meta).toEqual({ sampleVersion: 8, contentHash: await computeSampleContentHash(root) });
});
