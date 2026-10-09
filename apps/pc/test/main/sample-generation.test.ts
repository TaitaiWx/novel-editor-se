import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGuiSession, writeGuiSession } from '@novel-editor/core';
import { publishGeneratedSample } from '../../scripts/sample-generation.mts';
const temporary: string[] = [];
async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ne-generator-'));
  temporary.push(parent);
  const root = path.join(parent, 'sample');
  await mkdir(path.join(root, '.novel-editor'), { recursive: true });
  await writeFile(
    path.join(root, '.novel-editor/sample.json'),
    JSON.stringify({ sampleVersion: 1, contentHash: 'old' })
  );
  await writeFile(path.join(root, 'author.txt'), 'keep');
  return { parent, root };
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
describe('sample generation publication', () => {
  it('拒绝把普通作者项目作为生成目标，原内容不变', async () => {
    const { root } = await fixture();
    await rm(path.join(root, '.novel-editor/sample.json'));
    await expect(publishGeneratedSample(root, async () => {}, true)).rejects.toThrow('示例');
    expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('keep');
  });
  it('生成中失败不会先删除原目录，清理临时产物', async () => {
    const { root, parent } = await fixture();
    await expect(
      publishGeneratedSample(
        root,
        async (stage) => {
          await writeFile(path.join(stage, 'author.txt'), 'changed');
          throw new Error('generation failed');
        },
        true
      )
    ).rejects.toThrow('generation failed');
    expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('keep');
    expect(await readdir(parent)).toEqual(['sample']);
  });
  it('预览不改目标；确认写入才发布完整生成树，保留无关文件', async () => {
    const { root } = await fixture();
    const generate = async (stage: string) => {
      await writeFile(path.join(stage, 'generated.txt'), 'new');
    };
    await publishGeneratedSample(root, generate, false);
    expect(await readdir(root)).not.toContain('generated.txt');
    await publishGeneratedSample(root, generate, true);
    expect(await readFile(path.join(root, 'generated.txt'), 'utf8')).toBe('new');
    expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('keep');
  });
  it('心跳过期但 GUI 进程存活时也拒绝替换工作区', async () => {
    const { root } = await fixture();
    await writeGuiSession(
      buildGuiSession(
        { workspaceRoot: root, activeFile: null, openFiles: [] },
        { pid: process.pid, now: new Date(0) }
      )
    );
    await expect(publishGeneratedSample(root, async () => {}, true)).rejects.toThrow('应用中打开');
    expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('keep');
  });
  it('拒绝符号链接子目录，不能让生成器写到目标外', async () => {
    const { root, parent } = await fixture();
    await symlink(parent, path.join(root, 'outside'), 'dir');
    await expect(publishGeneratedSample(root, async () => {}, true)).rejects.toThrow('符号链接');
  });
});

// Kill a real worker after the first directory rename; its finally block cannot run.
it('强杀两次 rename 之间后，下次预览恢复原稿并清理已知事务', async () => {
  const { root, parent } = await fixture();
  const publisher = pathToFileURL(path.resolve('apps/pc/scripts/sample-generation.mts')).href;
  const worker = path.join(parent, 'worker.mts');
  await writeFile(
    worker,
    `import { publishGeneratedSample } from ${JSON.stringify(publisher)};
    import { writeFile } from 'node:fs/promises';
    await publishGeneratedSample(${JSON.stringify(root)}, async stage => {
      await writeFile(stage + '/author.txt', 'new');
    }, true, { checkpoint: async phase => { if (phase === 'backed-up') process.kill(process.pid, 'SIGKILL'); } });`
  );
  const child = spawn(process.execPath, ['--import', 'tsx', worker], { stdio: 'pipe' });
  const exit = await new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal }))
  );
  expect(exit).toEqual({ code: null, signal: 'SIGKILL' });
  await publishGeneratedSample(root, async () => {}, false);
  expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('keep');
  expect((await readdir(parent)).filter((name) => name.startsWith('.sample'))).toEqual([]);
});
it('发布失败时恢复原稿；并发生成拒绝，不删另一事务的锁', async () => {
  const { root } = await fixture();
  await expect(
    publishGeneratedSample(
      root,
      async (stage) => {
        await expect(publishGeneratedSample(root, async () => {}, true)).rejects.toThrow();
        await writeFile(path.join(stage, 'author.txt'), 'changed');
      },
      true,
      {
        checkpoint: async (phase) => {
          if (phase === 'backed-up') throw new Error('injected rename failure');
        },
      }
    )
  ).rejects.toThrow('injected rename failure');
  expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe('keep');
});

it.each(['prepared', 'published'] as const)(
  '强杀 %s 时下一次调用恢复到完整旧版或新版',
  async (phase) => {
    const { root, parent } = await fixture();
    const publisher = pathToFileURL(path.resolve('apps/pc/scripts/sample-generation.mts')).href;
    const worker = path.join(parent, 'worker.mts');
    await writeFile(
      worker,
      `import { publishGeneratedSample } from ${JSON.stringify(publisher)};
    import { writeFile } from 'node:fs/promises';
    await publishGeneratedSample(${JSON.stringify(root)}, async stage => {
      await writeFile(stage + '/author.txt', 'new');
    }, true, { checkpoint: async phase => { if (phase === ${JSON.stringify(phase)}) process.kill(process.pid, 'SIGKILL'); } });`
    );
    const child = spawn(process.execPath, ['--import', 'tsx', worker], { stdio: 'pipe' });
    const exit = await new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal }))
    );
    expect(exit).toEqual({ code: null, signal: 'SIGKILL' });
    await publishGeneratedSample(root, async () => {}, false);
    expect(await readFile(path.join(root, 'author.txt'), 'utf8')).toBe(
      phase === 'published' ? 'new' : 'keep'
    );
    expect((await readdir(parent)).filter((name) => name.startsWith('.sample'))).toEqual([]);
  }
);

it('两个真实生成进程串行发布，不丢失另一进程新增的文件', async () => {
  const { root, parent } = await fixture();
  const publisher = pathToFileURL(path.resolve('apps/pc/scripts/sample-generation.mts')).href;
  const worker = path.join(parent, 'worker.mts');
  await writeFile(
    worker,
    `import { publishGeneratedSample } from ${JSON.stringify(publisher)};
    import { writeFile } from 'node:fs/promises';
    await publishGeneratedSample(${JSON.stringify(root)}, async stage => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await writeFile(stage + '/' + process.argv[2] + '.txt', process.argv[2]);
    }, true);`
  );
  const exits = await Promise.all(
    ['one', 'two'].map(
      (name) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, ['--import', 'tsx', worker, name], {
            stdio: 'pipe',
          });
          child.once('exit', (code) => resolve(code));
        })
    )
  );
  expect(exits).toEqual([0, 0]);
  expect(await readFile(path.join(root, 'one.txt'), 'utf8')).toBe('one');
  expect(await readFile(path.join(root, 'two.txt'), 'utf8')).toBe('two');
});

it('未知或不完整的锁不自动删除，保留备份供人工处理', async () => {
  const { root, parent } = await fixture();
  const lock = path.join(parent, '.sample.generation.lock');
  await writeFile(lock, '{incomplete');
  const backup = path.join(parent, '.sample.generate-unknown.previous');
  await mkdir(backup);
  await writeFile(path.join(backup, 'unique.txt'), 'only copy');
  await expect(publishGeneratedSample(root, async () => {}, true)).rejects.toThrow();
  expect(await readFile(lock, 'utf8')).toBe('{incomplete');
  expect(await readFile(path.join(backup, 'unique.txt'), 'utf8')).toBe('only copy');
});
