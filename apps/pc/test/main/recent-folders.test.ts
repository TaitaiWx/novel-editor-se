import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? state.userData : '') },
}));

import {
  addRecentFolder,
  clearRecentFolders,
  getLastFolder,
  getRecentFolders,
} from '../../src/main/recent-folders';

describe('recent-folders', () => {
  beforeEach(() => {
    state.userData = mkdtempSync(join(tmpdir(), 'ne-recent-'));
  });

  afterEach(() => {
    rmSync(state.userData, { recursive: true, force: true });
  });

  const filePath = () => join(state.userData, 'recent-folders.json');

  it('无记录文件时返回空', () => {
    expect(getLastFolder()).toBeNull();
    expect(getRecentFolders()).toEqual([]);
  });

  it('添加后更新 lastFolder 并持久化', () => {
    addRecentFolder('/a');
    expect(getLastFolder()).toBe('/a');
    expect(getRecentFolders()).toEqual(['/a']);
    expect(existsSync(filePath())).toBe(true);
    expect(JSON.parse(readFileSync(filePath(), 'utf-8'))).toEqual({
      lastFolder: '/a',
      folders: ['/a'],
    });
  });

  it('重复添加时去重并移到最前', () => {
    addRecentFolder('/a');
    addRecentFolder('/b');
    addRecentFolder('/a');
    expect(getRecentFolders()).toEqual(['/a', '/b']);
    expect(getLastFolder()).toBe('/a');
  });

  it('最多保留 10 条', () => {
    for (let i = 0; i < 15; i += 1) addRecentFolder(`/p${i}`);
    const folders = getRecentFolders();
    expect(folders).toHaveLength(10);
    expect(folders[0]).toBe('/p14');
    expect(folders[9]).toBe('/p5');
  });

  it('清空记录', () => {
    addRecentFolder('/a');
    clearRecentFolders();
    expect(getLastFolder()).toBeNull();
    expect(getRecentFolders()).toEqual([]);
  });

  it('损坏的 JSON 回退为空记录', () => {
    writeFileSync(filePath(), '{not json', 'utf-8');
    expect(getRecentFolders()).toEqual([]);
    addRecentFolder('/x');
    expect(getRecentFolders()).toEqual(['/x']);
  });

  // 回归：read() 曾只校验 JSON 能否解析，不校验结构；合法 JSON 但缺少 folders 字段时
  // addRecentFolder 会因 data.folders.filter 抛 TypeError（recent-folders.ts:26/40）。
  it('结构不完整的 JSON（缺少 folders）不应导致 addRecentFolder 崩溃', () => {
    writeFileSync(filePath(), JSON.stringify({ lastFolder: '/old' }), 'utf-8');
    addRecentFolder('/new');
    expect(getRecentFolders()).toEqual(['/new']);
  });
});
