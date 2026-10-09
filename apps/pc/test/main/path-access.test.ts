import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertDirectoryAccess,
  assertPathAccess,
  assertWritablePath,
  childPath,
  grantDroppedPathAccess,
  grantPathAccess,
  resetPathAccessForTest,
} from '../../src/main/path-access';

let base: string;
let root: string;
let outside: string;
beforeEach(async () => {
  resetPathAccessForTest();
  base = await mkdtemp(path.join(os.tmpdir(), 'ne-path-access-'));
  root = path.join(base, 'workspace');
  outside = path.join(base, 'private');
  await mkdir(root);
  await mkdir(outside);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('main-process file capabilities', () => {
  it('limits grants to the selected directory and sender, including new descendants', async () => {
    await grantPathAccess({ id: 1 }, root, true);
    await expect(assertPathAccess(1, path.join(root, 'new', 'file.md'), true)).resolves.toBe(
      path.join(root, 'new', 'file.md')
    );
    await expect(assertPathAccess(1, outside)).rejects.toThrow('未授权');
    await expect(assertPathAccess(2, root)).rejects.toThrow('未授权');
    await expect(assertPathAccess(undefined, root)).rejects.toThrow('未授权');
    await expect(assertPathAccess(1, `${root}-sibling/file`)).rejects.toThrow('未授权');
  });

  it('rejects relative, null-byte and non-string paths and path-like filenames', async () => {
    await grantPathAccess({ id: 1 }, root, true);
    for (const value of [
      null,
      {},
      42,
      '',
      'relative.md',
      `${root}/link/../escape`,
      `${root}/a\0b`,
    ]) {
      await expect(assertPathAccess(1, value)).rejects.toThrow();
    }
    for (const name of ['..', '.', '../x', 'a/b', 'a\\b', '/tmp/x', '', null])
      expect(() => childPath(root, name)).toThrow();
  });

  it('resolves existing symlinks and the nearest existing parent of new paths', async () => {
    await grantPathAccess({ id: 1 }, root, true);
    await symlink(outside, path.join(root, 'link'));
    await expect(assertPathAccess(1, path.join(root, 'link', 'new', 'a.md'), true)).rejects.toThrow(
      '范围之外'
    );
    await symlink(path.join(outside, 'missing'), path.join(root, 'dangling'));
    await expect(assertPathAccess(1, path.join(root, 'dangling'), true)).rejects.toThrow();
  });

  it('does not let a user-visible symlink edit managed data', async () => {
    await grantPathAccess({ id: 1 }, root, true);
    const internal = path.join(root, '.novel-editor');
    await mkdir(internal);
    const secret = path.join(internal, 'config.json');
    await writeFile(secret, '{}');
    await symlink(secret, path.join(root, 'innocent.json'));
    await expect(assertWritablePath(1, path.join(root, 'innocent.json'), root)).rejects.toThrow(
      '内部数据'
    );
    expect(await readFile(secret, 'utf8')).toBe('{}');
  });

  it('save-dialog grants authorize only the selected single file', async () => {
    const chosen = path.join(outside, 'chosen.md');
    await grantPathAccess({ id: 1 }, chosen, false);
    await expect(assertWritablePath(1, chosen, null)).resolves.toBe(chosen);
    await expect(assertPathAccess(1, path.join(outside, 'other.md'))).rejects.toThrow();
    await expect(assertDirectoryAccess(1, outside)).rejects.toThrow();
  });

  it('dropped directories are readable import sources without write or workspace authority', async () => {
    const item = path.join(outside, 'import.md');
    await writeFile(item, 'import');
    grantDroppedPathAccess({ id: 1 }, outside);
    await expect(assertPathAccess(1, item)).resolves.toBe(item);
    await expect(assertPathAccess(1, item, true)).rejects.toThrow();
    await expect(assertDirectoryAccess(1, outside)).rejects.toThrow();
  });

  it('revokes grants when the owning webContents is destroyed', async () => {
    let destroy = () => {};
    await grantPathAccess(
      {
        id: 1,
        once: (_event, fn) => {
          destroy = fn;
        },
      },
      root,
      true
    );
    destroy();
    await expect(assertPathAccess(1, root)).rejects.toThrow();
  });
});
