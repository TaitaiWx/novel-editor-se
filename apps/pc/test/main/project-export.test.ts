import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportPreparedProject } from '../../src/main/project-export';
import { withWorkspaceMutation } from '../../src/main/workspace-mutation-gate';
let dir: string;
let source: string;
let output: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ne-export-coordination-'));
  source = path.join(dir, 'project');
  output = path.join(dir, 'output');
  await mkdir(source);
  await mkdir(output);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

it('exports pending renderer drafts and queued saves, keeping later saves outside the snapshot boundary', async () => {
  await mkdir(path.join(source, '.novel-editor'));
  await writeFile(path.join(source, '.novel-editor/novel-editor.db'), 'live');
  let pending: Promise<void>;
  let later: Promise<void>;
  let released = false;
  const destination = await exportPreparedProject(source, output, {
    prepare: [
      async () => {
        pending = withWorkspaceMutation(async () => {
          await new Promise((r) => setTimeout(r, 5));
          await writeFile(path.join(source, 'chapter.md'), 'captured draft');
        });
        return {
          release: () => {
            released = true;
          },
        };
      },
    ],
    drain: async () => {
      await pending;
    },
    backupDatabase: async (_src, dest) => {
      later = withWorkspaceMutation(() =>
        writeFile(path.join(source, 'chapter.md'), 'after snapshot')
      );
      await writeFile(dest, 'SQLite snapshot');
    },
  });
  await later!;
  expect(await readFile(path.join(destination!, 'chapter.md'), 'utf8')).toBe('captured draft');
  expect(await readFile(path.join(source, 'chapter.md'), 'utf8')).toBe('after snapshot');
  expect(released).toBe(true);
});

it('cancels without publishing if any window cannot flush and releases previously prepared windows', async () => {
  let released = false;
  expect(
    await exportPreparedProject(source, output, {
      prepare: [
        async () => ({
          release: () => {
            released = true;
          },
        }),
        async () => null,
      ],
      drain: async () => {
        throw new Error('must not copy');
      },
    })
  ).toBeNull();
  expect(released).toBe(true);
  expect(await readdir(output)).toEqual([]);
});

it('releases the renderer and writer barrier after snapshot failure', async () => {
  await mkdir(path.join(source, '.novel-editor'));
  await writeFile(path.join(source, '.novel-editor/novel-editor.db'), 'live');
  let released = false;
  await expect(
    exportPreparedProject(source, output, {
      prepare: [
        async () => ({
          release: () => {
            released = true;
          },
        }),
      ],
      drain: async () => undefined,
      backupDatabase: async () => {
        throw new Error('snapshot failed');
      },
    })
  ).rejects.toThrow('snapshot failed');
  expect(released).toBe(true);
  expect(await readdir(output)).toEqual([]);
  await withWorkspaceMutation(() => writeFile(path.join(source, 'recovered.md'), 'saved'));
  expect(await readFile(path.join(source, 'recovered.md'), 'utf8')).toBe('saved');
});
