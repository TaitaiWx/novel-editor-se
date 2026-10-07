import { describe, expect, it } from 'vitest';
import {
  VIDEO_MATERIAL_SEGMENTS,
  buildPromptRecord,
  isSafeRelativePath,
  nextShotVersion,
  parseShotFileName,
  sanitizePathSegment,
  transitionVideoTask,
  videoOutputLayout,
  videoPromptFileName,
  videoShotFileName,
} from '../src';
import { makeTask } from './helpers';

describe('sanitizePathSegment', () => {
  it.each([
    ['第一章 离港', '第一章 离港'],
    ['  多个   空白\t换行\n ', '多个 空白换行'],
    ['../../etc/passwd', 'etcpasswd'],
    ['..', 'F'],
    ['.', 'F'],
    ['...', 'F'],
    ['', 'F'],
    ['/', 'F'],
    ['a/b\\c', 'abc'],
    ['问：何*时?"<>|', '问：何时'],
    ['a:b', 'ab'],
    ['.hidden.', 'hidden'],
    ['trailing. . ', 'trailing'],
    ['ctrl\u0000\u001f\u007fchar', 'ctrlchar'],
    ['CON', 'CON_'],
    ['con.txt', 'con_.txt'],
    ['Lpt9', 'Lpt9_'],
    ['COM10', 'COM10'],
    ['console', 'console'],
    ['星河🚀旅人', '星河🚀旅人'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizePathSegment(input, 'F')).toBe(expected);
  });

  it('按码点截断到 60 个字符，不拆开代理对', () => {
    const long = '🚀'.repeat(80);
    const result = sanitizePathSegment(long, 'F');
    expect(Array.from(result)).toHaveLength(60);
    expect(result).toBe('🚀'.repeat(60));
    const cjk = '章'.repeat(61);
    expect(sanitizePathSegment(cjk, 'F')).toBe('章'.repeat(60));
    // 截断后末尾的点 / 空格也去掉
    expect(sanitizePathSegment(`${'a'.repeat(59)} b`, 'F')).toBe('a'.repeat(59));
  });

  it('NFC 规范化', () => {
    expect(sanitizePathSegment('e\u0301', 'F')).toBe('\u00e9');
  });

  it('fallback 本身也被清洗；都无效时为「未命名」', () => {
    expect(sanitizePathSegment('..', '../x')).toBe('x');
    expect(sanitizePathSegment('..', '..')).toBe('未命名');
    expect(sanitizePathSegment(undefined as unknown as string, '兜底')).toBe('兜底');
  });
});

describe('文件名', () => {
  it('videoShotFileName / videoPromptFileName', () => {
    expect(videoShotFileName(1, 2)).toBe('镜头1-v2.mp4');
    expect(videoShotFileName(3, 1, '.WEBM')).toBe('镜头3-v1.webm');
    expect(videoShotFileName(3, 1, '../x/../toolongext')).toBe('镜头3-v1.xtool');
    expect(videoShotFileName(3, 1, '...')).toBe('镜头3-v1.mp4');
    expect(videoPromptFileName(1, 2)).toBe('镜头1-v2.prompt.json');
    expect(() => videoShotFileName(0, 1)).toThrow('镜头序号');
    expect(() => videoShotFileName(1, 1.5)).toThrow('版本号');
    expect(() => videoPromptFileName(-1, 1)).toThrow();
  });

  it('parseShotFileName', () => {
    expect(parseShotFileName('镜头12-v3.mp4')).toEqual({ shotIndex: 12, version: 3, ext: 'mp4' });
    expect(parseShotFileName('镜头1-v1.WEBM')).toEqual({ shotIndex: 1, version: 1, ext: 'webm' });
    expect(parseShotFileName('镜头1-v1.prompt.json')).toBeNull();
    expect(parseShotFileName('镜头0-v1.mp4')).toBeNull();
    expect(parseShotFileName('镜头1-v0.mp4')).toBeNull();
    expect(parseShotFileName('镜头1-v1')).toBeNull();
    expect(parseShotFileName('shot1-v1.mp4')).toBeNull();
    expect(parseShotFileName('镜头1-v1.toolong')).toBeNull();
    expect(parseShotFileName(`镜头${'9'.repeat(30)}-v1.mp4`)).toBeNull();
  });

  it('nextShotVersion 只看同一镜头，并把 prompt.json 视为已占用', () => {
    const files = [
      '镜头1-v1.mp4',
      '镜头1-v3.webm',
      '镜头2-v7.mp4',
      '镜头1-v5.prompt.json',
      '镜头2-v9.prompt.json',
      '镜头1-v99.txt.bak',
      'README.md',
    ];
    expect(nextShotVersion(files, 1)).toBe(6);
    expect(nextShotVersion(files, 2)).toBe(10);
    expect(nextShotVersion(files, 3)).toBe(1);
    expect(nextShotVersion([], 1)).toBe(1);
  });
});

describe('videoOutputLayout', () => {
  it('生成 资料/视频/<章>/<场景> 下的相对路径', () => {
    const layout = videoOutputLayout({
      chapter: '第一章:离港',
      scene: '舰桥',
      shotIndex: 2,
      version: 3,
    });
    expect(layout).toEqual({
      dir: '资料/视频/第一章离港/舰桥',
      file: '资料/视频/第一章离港/舰桥/镜头2-v3.mp4',
      promptFile: '资料/视频/第一章离港/舰桥/镜头2-v3.prompt.json',
      fileName: '镜头2-v3.mp4',
      promptFileName: '镜头2-v3.prompt.json',
      segments: ['资料', '视频', '第一章离港', '舰桥'],
    });
    expect(layout.segments.slice(0, 2)).toEqual([...VIDEO_MATERIAL_SEGMENTS]);
  });

  it('路径穿越被清洗，结果始终安全', () => {
    const layout = videoOutputLayout({
      chapter: '../../..',
      scene: '/etc',
      shotIndex: 1,
      version: 1,
      ext: 'webm',
    });
    expect(layout.dir).toBe('资料/视频/未命名章节/etc');
    expect(layout.file.endsWith('镜头1-v1.webm')).toBe(true);
    for (const path of [layout.dir, layout.file, layout.promptFile]) {
      expect(isSafeRelativePath(path)).toBe(true);
    }
    expect(videoOutputLayout({ chapter: '', scene: '..', shotIndex: 1, version: 1 }).dir).toBe(
      '资料/视频/未命名章节/未命名场景'
    );
  });
});

describe('isSafeRelativePath', () => {
  it.each([
    ['资料/视频/a/镜头1-v1.mp4', true],
    ['a', true],
    ['a/./b', true],
    ['..a/b..', true],
    ['', false],
    ['/abs/path', false],
    ['C:/x', false],
    ['c:x', false],
    ['a\\b', false],
    ['..', false],
    ['a/../b', false],
    ['a/..', false],
    ['a\0b', false],
  ])('%j → %s', (input, expected) => {
    expect(isSafeRelativePath(input)).toBe(expected);
  });

  it('非字符串返回 false', () => {
    expect(isSafeRelativePath(null as unknown as string)).toBe(false);
  });
});

describe('buildPromptRecord', () => {
  it('包含复现所需字段，省略 undefined，extra 覆盖', () => {
    const task = transitionVideoTask(
      makeTask(
        {
          model: 'v2',
          params: { durationSec: 5, aspectRatio: '16:9' },
          costEstimate: { amount: 1.5, currency: 'CNY' },
        },
        Date.UTC(2026, 0, 2, 3, 4, 5)
      ),
      { type: 'submitted', remoteTaskId: 'remote-1' },
      { now: 0 }
    );
    const record = buildPromptRecord(task, { storyboardShotId: 'shot-1', schemaVersion: 1 });
    expect(record).toEqual({
      schemaVersion: 1,
      taskId: 't1',
      providerId: 'kling',
      model: 'v2',
      prompt: '林舟站在舷窗前',
      params: { durationSec: 5, aspectRatio: '16:9' },
      chapter: '第一章',
      scene: '离港',
      shotIndex: 1,
      version: 1,
      costEstimate: { amount: 1.5, currency: 'CNY' },
      remoteTaskId: 'remote-1',
      createdAt: '2026-01-02T03:04:05.000Z',
      storyboardShotId: 'shot-1',
    });
    const minimal = buildPromptRecord(makeTask());
    expect('model' in minimal).toBe(false);
    expect('remoteTaskId' in minimal).toBe(false);
    expect('costEstimate' in minimal).toBe(false);
  });
});
