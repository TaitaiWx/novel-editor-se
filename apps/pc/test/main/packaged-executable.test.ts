import { afterEach, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolvePackagedExecutable } from '../../e2e/support/packaged-executable';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it.skipIf(process.platform === 'win32')(
  'selects the Linux application instead of Electron resources or auxiliary executables',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ne-package-'));
    roots.push(root);
    const dir = path.join(root, 'linux-unpacked');
    await mkdir(dir);
    for (const name of [
      'chrome-sandbox',
      'chrome_crashpad_handler',
      'resources.pak',
      'novel-editor',
    ]) {
      await writeFile(
        path.join(dir, name),
        name === 'resources.pak' ? 'resource' : Buffer.from([0x7f, 0x45, 0x4c, 0x46])
      );
      await chmod(path.join(dir, name), 0o755);
    }
    expect(resolvePackagedExecutable(root, 'linux')).toBe(path.join(dir, 'novel-editor'));
  }
);
it('returns no executable for an empty output directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ne-package-'));
  roots.push(root);
  expect(resolvePackagedExecutable(root, 'win32')).toBeNull();
});
it('selects the Windows application rather than packaged DLLs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ne-package-'));
  roots.push(root);
  const dir = path.join(root, 'win-arm64-unpacked');
  await mkdir(dir);
  await writeFile(path.join(dir, 'a-library.dll'), 'library');
  await writeFile(path.join(dir, 'Novel Editor.exe'), 'application');
  expect(resolvePackagedExecutable(root, 'win32')).toBe(path.join(dir, 'Novel Editor.exe'));
});
