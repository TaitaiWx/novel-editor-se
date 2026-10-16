import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { build } from 'vite';
import { CdpClient } from '../../../apps/pc/e2e/support/cdp';
import { Page } from '../../../apps/pc/e2e/support/page';

const repo = resolve(import.meta.dirname, '../../..');
const artifacts = join(repo, 'packages/ui/e2e/.artifacts');

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolvePort, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

export async function launchUiHost() {
  const directory = await mkdtemp(join(tmpdir(), 'novel-ui-e2e-'));
  const output = join(directory, 'dist');
  let child: ChildProcess | undefined;
  let cdp: CdpClient | undefined;
  let log = '';
  const stop = async () => {
    cdp?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((done) => child!.once('exit', () => done()));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  };
  const saveLog = async () => {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, 'electron.log'), log);
  };
  try {
    await build({
      configFile: false,
      root: join(repo, 'packages/ui/e2e/fixture'),
      base: './',
      logLevel: 'error',
      build: { outDir: output, emptyOutDir: true },
    });
    const port = await freePort();
    const electron = createRequire(join(repo, 'apps/pc/package.json'))('electron') as string;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UI_TEST_USER_DATA: join(directory, 'profile'),
      UI_TEST_INDEX: join(output, 'index.html'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(
      electron,
      [
        join(repo, 'packages/ui/e2e/fixture/electron.cjs'),
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
        ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
        ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout?.on('data', (chunk) => {
      log += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      log += String(chunk);
    });
    let spawnError: Error | undefined;
    child.on('error', (error) => {
      spawnError = error;
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`UI host exited: ${log}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1000),
        });
        const targets = (await response.json()) as {
          type: string;
          url: string;
          webSocketDebuggerUrl: string;
        }[];
        const target = targets.find((item) => item.type === 'page' && item.url.startsWith('file:'));
        if (target) {
          cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
          const page = new Page(cdp, artifacts);
          await page.init(target.url);
          await page.waitForTarget('h1');
          return { page, stop, saveLog };
        }
      } catch (error) {
        // The debug HTTP endpoint is not ready until Electron has started.
        if (cdp) throw error;
      }
      await sleep(100);
    }
    throw new Error(`UI host startup timed out: ${log}`);
  } catch (error) {
    await saveLog();
    await stop();
    throw error;
  }
}
