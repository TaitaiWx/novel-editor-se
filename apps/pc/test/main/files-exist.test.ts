/**
 * get-files-exist：参数校验、只回答工作区内的绝对路径、目录不算文件
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FILES_EXIST_MAX,
  checkFilesExist,
  isInsideRoot,
  validateFilesExistRequest,
} from '../../src/main/handlers/files-exist';

let root: string;

beforeEach(async () => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ne-files-exist-')));
  await mkdir(path.join(root, 'novels', 'a', 'img'), { recursive: true });
  await writeFile(path.join(root, 'novels', 'a', 'img', 'x.png'), 'x');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('validateFilesExistRequest', () => {
  it('只接受字符串数组且不超过上限', () => {
    expect(validateFilesExistRequest(['/a', '/b'])).toEqual(['/a', '/b']);
    expect(() => validateFilesExistRequest('/a')).toThrow();
    expect(() => validateFilesExistRequest([1])).toThrow();
    expect(() => validateFilesExistRequest([''])).toThrow();
    expect(() => validateFilesExistRequest(Array(FILES_EXIST_MAX + 1).fill('/a'))).toThrow();
    expect(validateFilesExistRequest(Array(FILES_EXIST_MAX).fill('/a'))).toHaveLength(
      FILES_EXIST_MAX
    );
  });
});

describe('isInsideRoot', () => {
  it('拒绝相对路径、工作区外与 .. 逃逸', () => {
    expect(isInsideRoot(path.join(root, 'novels'), root)).toBe(true);
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot('novels/a', root)).toBe(false);
    expect(isInsideRoot(path.join(root, '..', 'other'), root)).toBe(false);
    expect(isInsideRoot(`${root}-sibling/x.png`, root)).toBe(false);
  });
});

describe('checkFilesExist', () => {
  it('工作区内：文件 true、不存在或目录 false；工作区外 / 相对路径 null', async () => {
    const file = path.join(root, 'novels', 'a', 'img', 'x.png');
    const result = await checkFilesExist(
      [
        file,
        path.join(root, 'novels', 'a', 'img', 'y.png'),
        path.join(root, 'novels'),
        '/etc/hosts',
        'x.png',
      ],
      root
    );
    expect(result).toEqual([true, false, false, null, null]);
  });

  it('窗口还没有工作区时全部 null', async () => {
    expect(await checkFilesExist([path.join(root, 'novels')], null)).toEqual([null]);
  });

  it('非法参数拒绝', async () => {
    await expect(checkFilesExist({ length: 1 }, root)).rejects.toThrow();
  });
});
