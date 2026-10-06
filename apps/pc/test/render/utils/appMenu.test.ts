import { describe, expect, it } from 'vitest';
import {
  buildSaveAsDefaultName,
  describeManualUpdateCheck,
  splitFilePath,
  validateSaveAsName,
} from '@/render/utils/appMenu';
import type { UpdateStatus } from '@/render/types/electron-api';
import {
  getActiveEditor,
  registerActiveEditor,
} from '@/render/components/TextEditor/active-editor';

function status(patch: Partial<UpdateStatus>): UpdateStatus {
  return {
    channel: 'stable',
    channelFile: 'latest',
    currentVersion: '1.2.0',
    checking: false,
    updateReady: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    rollbackAvailable: false,
    rollbackVersion: null,
    preCaching: false,
    lastError: null,
    ...patch,
  };
}

describe('describeManualUpdateCheck', () => {
  it('按优先级描述检查结果', () => {
    expect(describeManualUpdateCheck(null).type).toBe('error');
    expect(describeManualUpdateCheck(status({ lastError: '开发模式下不支持检查更新' }))).toEqual({
      type: 'warning',
      message: '检查更新：开发模式下不支持检查更新',
    });
    expect(
      describeManualUpdateCheck(status({ updateReady: true, downloadedVersion: '1.3.0' })).message
    ).toContain('1.3.0 已下载');
    expect(describeManualUpdateCheck(status({ availableVersion: '1.3.0' })).message).toContain(
      '发现新版本 1.3.0'
    );
    expect(describeManualUpdateCheck(status({ checking: true })).message).toBe('正在检查更新…');
    expect(describeManualUpdateCheck(status({}))).toEqual({
      type: 'success',
      message: '当前已是最新版本（1.2.0）',
    });
    expect(describeManualUpdateCheck(status({ currentVersion: '' })).message).toBe(
      '当前已是最新版本'
    );
  });
});

describe('另存为工具函数', () => {
  it('splitFilePath 兼容 / 与 \\', () => {
    expect(splitFilePath('/w/正文/a.md')).toEqual({ dir: '/w/正文', name: 'a.md', sep: '/' });
    expect(splitFilePath('C:\\w\\a.md')).toEqual({ dir: 'C:\\w', name: 'a.md', sep: '\\' });
    expect(splitFilePath('a.md')).toEqual({ dir: '', name: 'a.md', sep: '/' });
  });

  it('buildSaveAsDefaultName 在扩展名前加「副本」', () => {
    expect(buildSaveAsDefaultName('第一章.md')).toBe('第一章 副本.md');
    expect(buildSaveAsDefaultName('README')).toBe('README 副本');
    expect(buildSaveAsDefaultName('.env')).toBe('.env 副本');
  });

  it('validateSaveAsName 拒绝空名、路径分隔符与 . / ..', () => {
    expect(validateSaveAsName('')).toBe('文件名不能为空');
    expect(validateSaveAsName('a/b')).toBe('文件名不能包含路径分隔符');
    expect(validateSaveAsName('a\\b')).toBe('文件名不能包含路径分隔符');
    expect(validateSaveAsName('..')).toBe('文件名不合法');
    expect(validateSaveAsName('第二章.md')).toBeNull();
  });
});

describe('active-editor 登记表', () => {
  const handle = (name: string) => ({
    save: () => undefined,
    openSearch: () => undefined,
    getSnapshot: () => ({ filePath: name, content: '', readOnly: false }),
  });

  it('优先最近获得焦点的编辑器，其次最近挂载的；卸载后移除', () => {
    expect(getActiveEditor()).toBeNull();
    const a = handle('a');
    const b = handle('b');
    const regA = registerActiveEditor(a);
    const regB = registerActiveEditor(b);
    expect(getActiveEditor()).toBe(b);
    regA.activate();
    expect(getActiveEditor()).toBe(a);
    regA.dispose();
    expect(getActiveEditor()).toBe(b);
    regA.activate(); // 已卸载的登记再激活无效
    expect(getActiveEditor()).toBe(b);
    regB.dispose();
    expect(getActiveEditor()).toBeNull();
  });
});
