import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { copyProjectTo } from '../src/project-copy';

let root: string;
const children: ChildProcess[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-coordination-'));
  // Isolate this real-process user identity from other UT workers' wildcard leases.
  // Production core/CLI/GUI imports still execute unchanged and share one fixture home.
  await writeFile(
    path.join(root, 'isolated-home.mjs'),
    `import os from 'node:os';
    import { syncBuiltinESMExports } from 'node:module';
    os.homedir = () => ${JSON.stringify(path.join(root, 'home'))}; syncBuiltinESMExports();`
  );
});
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once('exit', () => resolve());
          child.kill('SIGKILL');
        })
    )
  );
  await rm(root, { recursive: true, force: true });
});

it('rejects publication if an uncooperative writer changes source files during the database backup', async () => {
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  await mkdir(path.join(source, '.novel-editor'), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(source, 'chapter.md'), 'before');
  await writeFile(path.join(source, '.novel-editor/a.db'), 'db');
  await expect(
    copyProjectTo(source, output, {
      backupDatabase: async (_, destination) => {
        await writeFile(path.join(source, 'chapter.md'), 'after');
        await writeFile(destination, 'db');
      },
    })
  ).rejects.toThrow(/变化|changed/);
  expect(await readdir(output)).toEqual([]);
});

// Import the production lock directly in separate OS processes, with no Vitest module mocks.
function child(script: string, withTsx = false) {
  const moduleUrl = pathToFileURL(path.resolve('packages/core/src/workspace-lock.ts')).href;
  const code = `import { withWorkspaceLease } from ${JSON.stringify(moduleUrl)};\n${script}`;
  const process = spawn(
    globalThis.process.execPath,
    [
      ...(withTsx
        ? ['--import', path.resolve('apps/cli/node_modules/tsx/dist/loader.mjs')]
        : ['--experimental-strip-types']),
      '--import',
      path.join(root, 'isolated-home.mjs'),
      '--input-type=module',
      '-e',
      code,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  children.push(process);
  let output = '';
  let errors = '';
  process.stdout!.on('data', (data) => {
    output += data;
  });
  process.stderr!.on('data', (data) => {
    errors += data;
  });
  return {
    process,
    async until(text: string) {
      await expect
        .poll(
          () => {
            if (process.exitCode !== null && !output.includes(text)) throw new Error(errors);
            return output;
          },
          { timeout: 5000 }
        )
        .toContain(text);
    },
    output: () => output,
  };
}

it('blocks a second process, never steals a live owner, and recovers an owner killed without cleanup', async () => {
  const options = JSON.stringify({ lockDirectory: path.join(root, 'locks'), timeoutMs: 10000 });
  const owner = child(
    `process.stdin.resume(); await withWorkspaceLease(async () => { console.log('held'); await new Promise(() => {}); }, ${options});`
  );
  // Keep the owner event loop alive, then terminate it abruptly after a contender starts waiting.
  owner.process.stdin!.write('keep alive');
  await owner.until('held');
  const contender = child(
    `console.log('waiting'); await withWorkspaceLease(() => console.log('entered'), ${options});`
  );
  await contender.until('waiting');
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(contender.output()).not.toContain('entered');
  owner.process.kill('SIGKILL');
  await contender.until('entered');
});

it('serializes concurrent child-process read-modify-write operations', async () => {
  const counter = path.join(root, 'counter');
  await writeFile(counter, '0');
  const options = JSON.stringify({ lockDirectory: path.join(root, 'locks'), resources: [counter] });
  const script = `import { readFile, writeFile } from 'node:fs/promises';
    for (let i = 0; i < 8; i++) await withWorkspaceLease(async () => {
      const value = Number(await readFile(${JSON.stringify(counter)}, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 3));
      await writeFile(${JSON.stringify(counter)}, String(value + 1));
    }, ${options}); console.log('done');`;
  await Promise.all(Array.from({ length: 4 }, () => child(script).until('done')));
  expect(await readFile(counter, 'utf8')).toBe('32');
});

it('keeps real CLI writes outside a GUI snapshot across a nested symlink path', async () => {
  const { symlink } = await import('node:fs/promises');
  const source = path.join(root, 'project');
  const nested = path.join(source, 'nested');
  const alias = path.join(root, 'alias');
  await mkdir(nested, { recursive: true });
  await symlink(source, alias, 'junction');
  const target = path.join(nested, 'chapter.md');
  await writeFile(target, 'before');
  const gateUrl = pathToFileURL(path.resolve('apps/pc/src/main/workspace-mutation-gate.ts')).href;
  const cliUrl = pathToFileURL(path.resolve('apps/cli/src/run.ts')).href;
  const owner = child(
    `import gate from ${JSON.stringify(gateUrl)}; const { withWorkspaceSnapshot } = gate;
    process.stdin.resume(); await withWorkspaceSnapshot(async () => {
      console.log('held'); await new Promise(resolve => process.stdin.once('data', resolve));
    }, { resources: [${JSON.stringify(source)}] }); process.stdin.pause(); console.log('released');`,
    true
  );
  await owner.until('held');
  const writer = child(
    `import { runCli } from ${JSON.stringify(cliUrl)};
    console.log('waiting'); const result = await runCli(['file', 'write', ${JSON.stringify(path.join(alias, 'nested/chapter.md'))}, '--stdin'], {
      cwd: ${JSON.stringify(root)}, io: { stdout: () => {}, stderr: console.error, readStdin: async () => { console.log('stdin-read'); return 'after'; } }
    }); if (result.exitCode) throw new Error(JSON.stringify(result)); console.log('written');`,
    true
  );
  await writer.until('waiting');
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(await readFile(target, 'utf8')).toBe('before');
  expect(writer.output()).not.toContain('written');
  expect(writer.output()).not.toContain('stdin-read');
  owner.process.stdin!.write('release');
  await Promise.all([owner.until('released'), writer.until('written')]);
  expect(await readFile(target, 'utf8')).toBe('after');
});

it('waits for real GUI mutations before copying a project in another process', async () => {
  const source = path.join(root, 'project');
  const output = path.join(root, 'output');
  await mkdir(source);
  await mkdir(output);
  await writeFile(path.join(source, 'chapter.md'), 'before');
  const gateUrl = pathToFileURL(path.resolve('apps/pc/src/main/workspace-mutation-gate.ts')).href;
  const copyUrl = pathToFileURL(path.resolve('packages/core/src/project-copy.ts')).href;
  const owner = child(
    `import gate from ${JSON.stringify(gateUrl)}; const { withWorkspaceMutation } = gate;
    import { writeFile } from 'node:fs/promises';
    process.stdin.resume(); await withWorkspaceMutation(async () => {
      console.log('held'); await new Promise(resolve => process.stdin.once('data', resolve));
      await writeFile(${JSON.stringify(path.join(source, 'chapter.md'))}, 'after');
    }, { resources: [${JSON.stringify(source)}] }); process.stdin.pause(); console.log('released');`,
    true
  );
  await owner.until('held');
  const copier = child(
    `import { copyProjectTo } from ${JSON.stringify(copyUrl)};
    console.log('waiting'); await copyProjectTo(${JSON.stringify(source)}, ${JSON.stringify(output)}); console.log('copied');`,
    true
  );
  await copier.until('waiting');
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(await readdir(output)).toEqual([]);
  owner.process.stdin!.write('release');
  await Promise.all([owner.until('released'), copier.until('copied')]);
  expect(await readFile(path.join(output, 'project/chapter.md'), 'utf8')).toBe('after');
});

it('rejects publication after an uncooperative SQLite WAL change', async () => {
  const source = path.join(root, 'project');
  const output = path.join(root, 'output');
  await mkdir(path.join(source, '.novel-editor'), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(source, '.novel-editor/a.db'), 'db');
  await writeFile(path.join(source, '.novel-editor/a.db-wal'), 'first');
  await expect(
    copyProjectTo(source, output, {
      backupDatabase: async (_, destination) => {
        await writeFile(destination, 'snapshot');
        await writeFile(path.join(source, '.novel-editor/a.db-wal'), 'later');
      },
    })
  ).rejects.toThrow('变化');
  expect(await readdir(output)).toEqual([]);
});

it('serializes direct core append callers in separate processes without lost updates', async () => {
  const target = path.join(root, 'chapter.md');
  await writeFile(target, '');
  const fsUrl = pathToFileURL(path.resolve('packages/core/src/fs-ops.ts')).href;
  const script = `import { writeTextFile } from ${JSON.stringify(fsUrl)};
    for (let i = 0; i < 6; i++) await writeTextFile(${JSON.stringify(target)}, 'x', { append: true });
    console.log('done');`;
  await Promise.all([child(script, true).until('done'), child(script, true).until('done')]);
  expect(await readFile(target, 'utf8')).toBe('x'.repeat(12));
});

it('allows disjoint project leases while another process remains inside its lease', async () => {
  const locks = path.join(root, 'locks');
  const ownerOptions = JSON.stringify({ lockDirectory: locks, resources: [path.join(root, 'a')] });
  const contenderOptions = JSON.stringify({
    lockDirectory: locks,
    resources: [path.join(root, 'b')],
    timeoutMs: 300,
  });
  const owner = child(
    `process.stdin.resume(); await withWorkspaceLease(async () => { console.log('held'); await new Promise(() => {}); }, ${ownerOptions});`
  );
  await owner.until('held');
  const contender = child(
    `await withWorkspaceLease(() => console.log('entered'), ${contenderOptions}).catch(error => console.log('blocked: ' + error.message));`
  );
  await expect.poll(() => contender.output(), { timeout: 1500 }).toMatch(/entered|blocked:/);
  expect(contender.output()).toContain('entered');
});

it.each(['nested', 'symlink', 'shared-database', 'reversed-resources'])(
  'excludes conflicting %s resource sets in separate processes',
  async (kind) => {
    const { symlink } = await import('node:fs/promises');
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    const shared = path.join(root, 'shared.db');
    await mkdir(a);
    await symlink(a, b, 'junction');
    const first =
      kind === 'shared-database' ? [a, shared] : kind === 'reversed-resources' ? [a, shared] : [a];
    const second =
      kind === 'shared-database'
        ? [path.join(root, 'c'), shared]
        : kind === 'reversed-resources'
          ? [shared, a]
          : [
              kind === 'nested'
                ? path.join(a, 'not-created/chapter.md')
                : path.join(b, 'chapter.md'),
            ];
    const opts = (resources: string[]) =>
      JSON.stringify({ lockDirectory: path.join(root, 'locks'), resources, timeoutMs: 10000 });
    const owner = child(
      `process.stdin.resume(); await withWorkspaceLease(async () => { console.log('held'); await new Promise(resolve => process.stdin.once('data', resolve)); }, ${opts(first)}); process.stdin.pause(); console.log('released');`
    );
    await owner.until('held');
    const waiter = child(
      `console.log('waiting'); await withWorkspaceLease(() => console.log('entered'), ${opts(second)});`
    );
    await waiter.until('waiting');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(waiter.output()).not.toContain('entered');
    owner.process.stdin!.write('release');
    await waiter.until('entered');
  }
);

it('does not globally block a direct core write to an unrelated file', async () => {
  const owner = child(
    `process.stdin.resume(); await withWorkspaceLease(async () => { console.log('held'); await new Promise(() => {}); }, { resources: [${JSON.stringify(path.join(root, 'a'))}] });`
  );
  await owner.until('held');
  const fsUrl = pathToFileURL(path.resolve('packages/core/src/fs-ops.ts')).href;
  const writer = child(
    `import { writeTextFile } from ${JSON.stringify(fsUrl)}; await writeTextFile(${JSON.stringify(path.join(root, 'b/chapter.md'))}, 'done'); console.log('written');`,
    true
  );
  await writer.until('written');
});

it('does not hold a CLI continuation lease while waiting for the provider network response', async () => {
  const target = path.join(root, 'chapter.md');
  await writeFile(target, 'before');
  const cliUrl = pathToFileURL(path.resolve('apps/cli/src/run.ts')).href;
  const continuation = child(
    `import { createServer } from 'node:http'; import { runCli } from ${JSON.stringify(cliUrl)};
    process.stdin.resume();
    const server = createServer((request, response) => { request.resume(); console.log('network-wait'); process.stdin.once('data', () => { response.writeHead(200, {'content-type': 'text/event-stream'}); response.end('data: {"choices":[{"delta":{"content":"suggestion"}}]}\\n\\ndata: [DONE]\\n\\n'); }); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const result = await runCli(['ai', 'continue', ${JSON.stringify(target)}, '--no-memory', '--json'], { cwd: ${JSON.stringify(root)}, env: {NOVEL_EDITOR_GROK_API_KEY:'test', NOVEL_EDITOR_GROK_BASE_URL:'http://127.0.0.1:' + server.address().port}, io:{stdout:()=>{}, stderr:console.error, readStdin:async()=>''} });
    server.close(); process.stdin.pause(); if(result.exitCode) throw new Error(JSON.stringify(result)); console.log('completed');`,
    true
  );
  await continuation.until('network-wait');
  const writer = child(
    `import { runCli } from ${JSON.stringify(cliUrl)}; const result = await runCli(['file','write',${JSON.stringify(target)},'after'], { cwd: ${JSON.stringify(root)}, io:{stdout:()=>{},stderr:console.error,readStdin:async()=>''} }); if(result.exitCode) throw new Error(JSON.stringify(result)); console.log('written');`,
    true
  );
  try {
    await writer.until('written');
  } finally {
    continuation.process.stdin!.write('release');
    await continuation.until('completed');
  }
  expect(await readFile(target, 'utf8')).toBe('after');
});

it('takes a CLI continuation input snapshot before releasing the lease for generation', async () => {
  const target = path.join(root, 'chapter.md');
  await writeFile(target, 'before');
  const owner = child(
    `process.stdin.resume(); await withWorkspaceLease(async () => { console.log('held'); await new Promise(resolve => process.stdin.once('data',resolve)); }, { resources: [${JSON.stringify(root)}] }); process.stdin.pause();`
  );
  await owner.until('held');
  const cliUrl = pathToFileURL(path.resolve('apps/cli/src/run.ts')).href;
  const reader = child(
    `import { runCli } from ${JSON.stringify(cliUrl)}; console.log('waiting'); const result = await runCli(['ai','continue',${JSON.stringify(target)},'--prompt-only','--no-memory'], { cwd: ${JSON.stringify(root)}, io:{stdout:()=>{},stderr:console.error,readStdin:async()=>''} }); if(result.exitCode) throw new Error(JSON.stringify(result)); console.log('prepared');`,
    true
  );
  await reader.until('waiting');
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    expect(reader.output()).not.toContain('prepared');
  } finally {
    owner.process.stdin!.write('release');
    await reader.until('prepared');
  }
});

it.each(['configured', 'symlink'])(
  'leases actual novel storage outside the project root (%s)',
  async (kind) => {
    const { symlink } = await import('node:fs/promises');
    const projectRoot = path.join(root, 'project');
    const outside = path.join(root, 'outside');
    await mkdir(path.join(projectRoot, '.novel-editor'), { recursive: true });
    await mkdir(outside);
    if (kind === 'symlink') await symlink(outside, path.join(projectRoot, 'novels'), 'junction');
    const config = {
      schemaVersion: 1,
      name: 'fixture',
      novelsDir: kind === 'symlink' ? 'novels' : '../outside',
      chapterExtension: '.md',
      createdAt: new Date().toISOString(),
    };
    await writeFile(path.join(projectRoot, '.novel-editor/config.json'), JSON.stringify(config));
    const owner = child(
      `process.stdin.resume(); await withWorkspaceLease(async () => { console.log('held'); await new Promise(resolve => process.stdin.once('data',resolve)); }, {resources:[${JSON.stringify(outside)}]}); process.stdin.pause();`
    );
    await owner.until('held');
    const projectUrl = pathToFileURL(path.resolve('packages/core/src/project.ts')).href;
    const writer = child(
      `import {loadProjectFromConfig,createNovel} from ${JSON.stringify(projectUrl)}; const project = await loadProjectFromConfig(${JSON.stringify(path.join(projectRoot, '.novel-editor/config.json'))}); console.log('waiting'); await createNovel(project,'new'); console.log('created');`,
      true
    );
    await writer.until('waiting');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = await readdir(outside);
    owner.process.stdin!.write('release');
    await writer.until('created');
    expect(before).toEqual([]);
    expect(await readdir(outside)).toEqual(['new']);
  }
);

it('admits opposite multi-resource orders without deadlock or lost updates', async () => {
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  await writeFile(a, '0');
  await writeFile(b, '0');
  const script = (resources: string[]) => `import { readFile, writeFile } from 'node:fs/promises';
    for (let i=0;i<6;i++) await withWorkspaceLease(async () => {
      const x = Number(await readFile(${JSON.stringify(a)},'utf8'));
      const y = Number(await readFile(${JSON.stringify(b)},'utf8'));
      await new Promise(resolve=>setTimeout(resolve,3));
      await writeFile(${JSON.stringify(a)}, String(x+1));
      await writeFile(${JSON.stringify(b)}, String(y+1));
    }, ${JSON.stringify({ resources, lockDirectory: path.join(root, 'locks') })}); console.log('done');`;
  await Promise.all([child(script([a, b])).until('done'), child(script([b, a])).until('done')]);
  expect(await readFile(a, 'utf8')).toBe('12');
  expect(await readFile(b, 'utf8')).toBe('12');
});

it('rejects a nested resource expansion promptly instead of acquiring partial sets and deadlocking', async () => {
  const options = { lockDirectory: path.join(root, 'locks'), resources: [path.join(root, 'a')] };
  const nested = child(
    `await withWorkspaceLease(() => withWorkspaceLease(() => console.log('unsafe'), ${JSON.stringify({ ...options, resources: [path.join(root, 'b')] })}), ${JSON.stringify(options)}).catch(error=>console.log(error.message));`
  );
  await nested.until('undeclared resources');
  expect(nested.output()).not.toContain('unsafe');
});

it('fails closed when a symlink resource changes while its contender waits', async () => {
  const { symlink, unlink } = await import('node:fs/promises');
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  const alias = path.join(root, 'alias');
  const locks = path.join(root, 'locks');
  await mkdir(a);
  await mkdir(b);
  await symlink(a, alias, 'junction');
  const owner = child(
    `process.stdin.resume(); await withWorkspaceLease(async()=>{console.log('held');await new Promise(resolve=>process.stdin.once('data',resolve));},${JSON.stringify({ lockDirectory: locks })}); process.stdin.pause();`
  );
  await owner.until('held');
  const contender = child(
    `await withWorkspaceLease(()=>console.log('entered'),${JSON.stringify({ lockDirectory: locks, resources: [alias] })}).catch(error=>console.log('changed: '+error.message));`
  );
  // Observe its fully published declaration rather than assume subprocess startup timing.
  await expect
    .poll(async () => {
      const names = await readdir(locks);
      for (const name of names) {
        if (!name.startsWith(`${contender.process.pid}-`) || !name.endsWith('.ticket')) continue;
        const text = await readFile(path.join(locks, name), 'utf8');
        if (text) return true;
      }
      return false;
    })
    .toBe(true);
  await unlink(alias);
  await symlink(b, alias, 'junction');
  owner.process.stdin!.write('release');
  await expect.poll(() => contender.output()).toMatch(/entered|changed:/);
  expect(contender.output()).toContain('changed:');
  expect(contender.output()).not.toContain('entered');
});

it('includes an explicit CLI lint target outside its cwd in the snapshot resource set', async () => {
  const cwd = path.join(root, 'cwd');
  const target = path.join(root, 'outside/chapter.md');
  await mkdir(cwd);
  await mkdir(path.dirname(target));
  await writeFile(target, '正文');
  const owner = child(
    `process.stdin.resume(); await withWorkspaceLease(async()=>{console.log('held');await new Promise(resolve=>process.stdin.once('data',resolve));},{resources:[${JSON.stringify(target)}]}); process.stdin.pause();`
  );
  await owner.until('held');
  const cliUrl = pathToFileURL(path.resolve('apps/cli/src/run.ts')).href;
  const reader = child(
    `import {runCli} from ${JSON.stringify(cliUrl)}; console.log('waiting'); const result=await runCli(['lint',${JSON.stringify(target)}],{cwd:${JSON.stringify(cwd)},io:{stdout:()=>{},stderr:console.error,readStdin:async()=>''}}); if(result.exitCode) throw new Error(JSON.stringify(result)); console.log('prepared');`,
    true
  );
  await reader.until('waiting');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const before = reader.output();
  owner.process.stdin!.write('release');
  await reader.until('prepared');
  expect(before).not.toContain('prepared');
});

it('canonicalizes a deeply nested not-yet-created resource without treating parents as symlink hops', async () => {
  const target = path.join(
    root,
    ...Array.from({ length: 50 }, (_, i) => `level-${i}`),
    'chapter.md'
  );
  const contender = child(
    `await withWorkspaceLease(()=>console.log('entered'),${JSON.stringify({ resources: [target], lockDirectory: path.join(root, 'locks') })}).catch(error=>console.log('failed: '+error.message));`
  );
  await expect.poll(() => contender.output()).toMatch(/entered|failed:/);
  expect(contender.output()).toContain('entered');
});
