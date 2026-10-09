/** Real Electron regression: the target URL can precede the document commit. */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PC_ROOT, stopProcess } from './support/app';
import { CdpClient } from './support/cdp';
import { Page, sleep } from './support/page';

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing debug port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

// Both variants must preserve errors emitted before Runtime.enable, rather than
// making a clean startup pass by silently discarding early application errors.
describe('CDP document startup', () => {
  it.each(['pending', 'already-loaded'] as const)(
    '%s document retains startup console and exception',
    async (mode) => {
      const root = await mkdtemp(path.join(tmpdir(), 'novel-editor-e2e-cdp-startup-'));
      const readyFile = path.join(root, 'loaded');
      const releaseFile = path.join(root, 'release-response');
      const entry = path.join(root, 'main.cjs');
      const preload = path.join(root, 'preload.cjs');
      const port = await freePort();
      let child: ChildProcess | undefined;
      let cdp: CdpClient | undefined;
      let logs = '';
      try {
        await writeFile(
          preload,
          `require('electron').contextBridge.exposeInMainWorld('preloadReady', true);`
        );
        await writeFile(
          entry,
          `
        const { app, BrowserWindow } = require('electron');
        const fs = require('node:fs');
        app.setPath('userData', ${JSON.stringify(path.join(root, 'user-data'))});
        app.whenReady().then(() => {
          const server = require('node:http').createServer((_req, res) => {
            const respond = () => {
              if (!fs.existsSync(${JSON.stringify(releaseFile)})) return setTimeout(respond, 10);
            res.setHeader('content-type', 'text/html');
            res.end('<html><body>Committed<script>console.error("fixture startup console");throw new Error("fixture startup exception")</script></body></html>');
            };
            respond();
          });
          server.listen(0, '127.0.0.1', () => {
            const window = new BrowserWindow({ show: false, webPreferences: {
              sandbox: true, contextIsolation: true, preload: ${JSON.stringify(preload)}
            }});
            window.webContents.once('did-finish-load', () => fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready'));
            window.loadURL('http://127.0.0.1:' + server.address().port + '/index.html');
          });
        });
      `
        );
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const executable = createRequire(path.join(PC_ROOT, 'package.json'))('electron') as string;
        child = spawn(
          executable,
          [
            entry,
            `--remote-debugging-port=${port}`,
            ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
            ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
          ],
          { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }
        );
        child.stdout?.on('data', (chunk: Buffer) => {
          logs += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          logs += chunk.toString();
        });
        let target: Target | undefined;
        const deadline = Date.now() + 10_000;
        while (!target && Date.now() < deadline) {
          try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`);
            const targets = (await response.json()) as Target[];
            target = targets.find(
              (candidate) => candidate.type === 'page' && candidate.url.endsWith('/index.html')
            );
          } catch {
            /* Debug port is still starting. */
          }
          if (!target) await sleep(20);
        }
        if (!target) throw new Error(`Missing pending page target: ${logs}`);
        if (mode === 'already-loaded') {
          await writeFile(releaseFile, 'release');
          while (!existsSync(readyFile) && Date.now() < deadline) await sleep(20);
          expect(existsSync(readyFile)).toBe(true);
        }
        cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
        const frame = await cdp.send<{ frameTree: { frame: { url: string } } }>(
          'Page.getFrameTree'
        );
        if (mode === 'pending') expect(frame.frameTree.frame.url).not.toBe(target.url);
        else expect(frame.frameTree.frame.url).toBe(target.url);
        const page = new Page(cdp, root);
        const initialized = page.init(target.url);
        // This command is ordered after init's first CDP command. The server stays
        // gated until observation has started, avoiding timing-dependent sleeps.
        await cdp.send('Page.getFrameTree');
        await writeFile(releaseFile, 'release');
        await initialized;
        expect(
          await page.evaluate(() => (window as Window & { preloadReady?: boolean }).preloadReady)
        ).toBe(true);
        const issues = page.takeIssues();
        expect(issues).toHaveLength(2);
        expect(issues[0]).toEqual({ kind: 'console', text: 'fixture startup console' });
        expect(issues[1].kind).toBe('exception');
        expect(issues[1].text).toContain('fixture startup exception');
      } finally {
        cdp?.close();
        if (child) await stopProcess(child);
        await rm(root, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  );
});
