import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  DEFAULT_STRUCTURE_CONFIG,
  initProject,
  readStructureConfig,
  writeStructureConfig,
} from '@novel-editor/core';
import { runCli } from '../src/run';
let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const io = { stdout: () => undefined, stderr: () => undefined, readStdin: async () => '' };

it('updates the explicit project config when cwd has an independent structure configuration', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-cli-resource-'));
  const cwd = path.join(root, 'cwd');
  const projectRoot = path.join(root, 'project');
  await mkdir(cwd);
  const { project } = await initProject(projectRoot);
  await writeStructureConfig(cwd, DEFAULT_STRUCTURE_CONFIG);
  const result = await runCli(
    ['structure', 'preset', '--disable', 'en', '--config', project.configPath],
    { cwd, io }
  );
  expect(result.envelope).toMatchObject({ ok: true });
  expect((await readStructureConfig(projectRoot)).config.presets).not.toContain('en');
  expect((await readStructureConfig(cwd)).config.presets).toContain('en');
});

it('converts a single file to an explicit output directory with its complete core resource declaration', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-cli-resource-'));
  const source = path.join(root, 'source/chapter.md'),
    out = path.join(root, 'output');
  await mkdir(path.dirname(source));
  await writeFile(source, '正文');
  const result = await runCli(
    ['batch', 'convert', source, '--out', out, '--from', 'md', '--to', 'txt'],
    { cwd: root, io }
  );
  expect(result.envelope).toMatchObject({ ok: true });
  expect(await readFile(path.join(out, 'chapter.txt'), 'utf8')).toBe('正文');
});
