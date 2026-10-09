import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { checkBundleBudget } from '../../scripts/check-bundles.mjs';

const temporary: string[] = [];
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bundle-budget-'));
  temporary.push(dir);
  const chunks = [
    {
      file: 'render.js',
      entry: true,
      imports: ['react.js'],
      modules: ['apps/pc/src/render/main.tsx'],
    },
    { file: 'react.js', entry: false, imports: [], modules: ['node_modules/react/index.js'] },
    {
      file: 'app.js',
      entry: false,
      imports: ['shared.js', 'react.js'],
      modules: ['apps/pc/src/render/App.tsx'],
    },
    {
      file: 'shared.js',
      entry: false,
      imports: ['app.js'],
      modules: ['apps/pc/src/render/utils/shared.ts'],
    },
    {
      file: 'preview.js',
      entry: false,
      imports: ['shared.js'],
      modules: ['apps/pc/src/render/components/TextEditor/live-preview/index.ts'],
    },
    { file: 'math.js', entry: false, imports: [], modules: ['node_modules/katex/dist/katex.mjs'] },
  ].map((chunk) => ({ ...chunk, externalImports: [] }));
  for (const c of [...chunks, { file: 'main.mjs' }])
    await writeFile(path.join(dir, c.file), 'x'.repeat(100));
  await writeFile(
    path.join(dir, 'bundle-renderer.json'),
    JSON.stringify({ version: 1, target: 'renderer', mode: 'production', chunks })
  );
  await writeFile(
    path.join(dir, 'bundle-main.json'),
    JSON.stringify({
      version: 1,
      target: 'main',
      mode: 'production',
      chunks: [
        {
          file: 'main.mjs',
          entry: true,
          imports: [],
          externalImports: [],
          modules: ['apps/pc/src/main/index.ts'],
        },
      ],
    })
  );
  return dir;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('counts transitive static dependencies once, handles cycles, and excludes lazy-only code', async () => {
  const result = await checkBundleBudget(await fixture());
  expect(result.errors).toEqual([]);
  expect(result.metrics.rendererStartup.bytes).toBe(400);
  expect(result.metrics.markdownPreview.bytes).toBe(400);
  expect(result.metrics.mainStartup.bytes).toBe(100);
});

it('rejects a heavy library reintroduced indirectly into the initial app', async () => {
  const dir = await fixture();
  const reportPath = path.join(dir, 'bundle-renderer.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.chunks.find((c: { file: string }) => c.file === 'shared.js').imports.push('math.js');
  await writeFile(reportPath, JSON.stringify(report));
  expect((await checkBundleBudget(dir)).errors.join('\n')).toContain('katex');
});

it('rejects eager heavy dependencies even when bundler externalizes their code', async () => {
  const dir = await fixture();
  const file = path.join(dir, 'bundle-main.json');
  const report = JSON.parse(await readFile(file, 'utf8'));
  report.chunks[0].externalImports = ['node:fs', 'electron', 'docx/dist/index.mjs'];
  await writeFile(file, JSON.stringify(report));
  expect((await checkBundleBudget(dir)).errors.join('\n')).toContain('docx/dist/index.mjs');
});

it('rejects large real output bytes even if metadata looks small', async () => {
  const dir = await fixture();
  await writeFile(path.join(dir, 'main.mjs'), 'x'.repeat(800_001));
  expect((await checkBundleBudget(dir)).errors.join('\n')).toContain('mainStartup');
});

it('fails closed on incomplete builds and on missing dependency chunks', async () => {
  const dir = await fixture();
  await rm(path.join(dir, 'react.js'));
  await expect(checkBundleBudget(dir)).rejects.toThrow();
  const empty = path.join(dir, 'empty');
  await mkdir(empty);
  await expect(checkBundleBudget(empty)).rejects.toThrow();
});

it('makes a failed budget a nonzero CI command and preserves the measured report', async () => {
  const dir = await fixture();
  await writeFile(path.join(dir, 'main.mjs'), 'x'.repeat(800_001));
  await expect(
    promisify(execFile)(process.execPath, [path.resolve('apps/pc/scripts/check-bundles.mjs'), dir])
  ).rejects.toMatchObject({ code: 1 });
  const report = JSON.parse(await readFile(path.join(dir, 'bundle-budget-report.json'), 'utf8'));
  expect(report.errors).toContain('mainStartup: 800001 bytes exceeds 800000');
  expect(report.metrics.mainStartup.bytes).toBe(800_001);
});
