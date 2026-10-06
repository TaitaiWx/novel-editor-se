import { describe, expect, it } from 'vitest';
import {
  getStoryDirectoryLabel,
  getStoryDirectoryMeta,
  getStoryFileLabel,
  getStoryFileMeta,
} from '@/render/components/FilePanel/StoryTreeNode/storyMeta';

describe('storyMeta', () => {
  it('目录类型：稿夹 / 卷 / 正文夹', () => {
    expect(getStoryDirectoryLabel('草稿箱')).toBe('稿夹');
    expect(getStoryDirectoryLabel('第一卷')).toBe('卷');
    expect(getStoryDirectoryLabel('Volume 2')).toBe('卷');
    expect(getStoryDirectoryLabel('未分卷')).toBe('卷');
    expect(getStoryDirectoryLabel('番外')).toBe('正文夹');
  });

  it('文件类型：章 / 稿（章节名优先于草稿关键词）', () => {
    expect(getStoryFileLabel('第一章.md')).toBe('章');
    expect(getStoryFileLabel('草稿.md')).toBe('稿');
    expect(getStoryFileLabel('第三章 草稿.md')).toBe('章');
    expect(getStoryFileLabel('随笔.md')).toBe('章');
  });

  it('meta 同时返回 label 与图标', () => {
    const dir = getStoryDirectoryMeta('第一卷');
    expect(dir.label).toBe('卷');
    expect(dir.icon).toBeTruthy();
    const file = getStoryFileMeta('草稿.md');
    expect(file.label).toBe('稿');
    expect(file.icon).toBeTruthy();
    expect(getStoryFileMeta('第一章.md').icon).not.toBe(file.icon);
  });
});

describe('storyMeta · 项目结构给出的类型', () => {
  it('作品 / 卷 / 章 / 文档优先于名称推断', () => {
    expect(getStoryDirectoryMeta('星河旅人', 'work').label).toBe('作品');
    expect(getStoryDirectoryMeta('番外', 'volume').label).toBe('卷');
    expect(getStoryDirectoryMeta('番外').label).toBe('正文夹');
    expect(getStoryFileMeta('草稿.md', 'chapter').label).toBe('章');
    expect(getStoryFileMeta('欢迎使用.md', 'document').label).toBe('文档');
    expect(getStoryFileMeta('欢迎使用.md', 'document').icon).not.toBe(
      getStoryFileMeta('第一章.md').icon
    );
  });
});
