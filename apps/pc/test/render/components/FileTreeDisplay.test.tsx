// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileTree from '@/render/components/FileTree';
import {
  buildFileTooltip,
  describeFileName,
  formatFileSize,
  formatModifiedTime,
  getFileKind,
  isMachineGeneratedName,
  splitFileName,
  splitMiddleEllipsis,
  visualWidth,
} from '@/render/components/FileTree/fileDisplay';
import { getFileIcon } from '@/render/components/FileTree/fileIcons';
import type { FileInfo, FileNode } from '@/render/types';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

afterEach(() => {
  uninstallElectronMock();
});

describe('splitFileName', () => {
  it('拆分主名与扩展名', () => {
    expect(splitFileName('a.tar.gz')).toEqual({ stem: 'a.tar', ext: '.gz' });
    expect(splitFileName('{2813-AB}.PNG')).toEqual({ stem: '{2813-AB}', ext: '.PNG' });
    expect(splitFileName('世界观.md')).toEqual({ stem: '世界观', ext: '.md' });
  });

  it('点文件、无扩展名、以点结尾、超长或含空格的「扩展名」不拆分', () => {
    expect(splitFileName('.gitignore')).toEqual({ stem: '.gitignore', ext: '' });
    expect(splitFileName('README')).toEqual({ stem: 'README', ext: '' });
    expect(splitFileName('草稿.')).toEqual({ stem: '草稿.', ext: '' });
    expect(splitFileName('v1.thisisnotanextension')).toEqual({
      stem: 'v1.thisisnotanextension',
      ext: '',
    });
    expect(splitFileName('第1.5 章')).toEqual({ stem: '第1.5 章', ext: '' });
  });
});

describe('splitMiddleEllipsis', () => {
  it('长哈希名：尾部保留主名末 6 位 + 扩展名，头尾拼回原名', () => {
    const name = '08980f831c19c0f68b5fb259a97d2060.mp4';
    const { head, tail } = splitMiddleEllipsis(name);
    expect(tail).toBe('7d2060.mp4');
    expect(head + tail).toBe(name);
  });

  it('GUID 带花括号', () => {
    const name = '{28131756-171F-87A0-1A39-2FABD995C1E2}.png';
    expect(splitMiddleEllipsis(name).tail).toBe('5C1E2}.png');
  });

  it('短名字不拆分；主名很短时尾部只有扩展名；无扩展名的普通名字不拆分', () => {
    expect(visualWidth('ab世界')).toBe(6);
    expect(splitMiddleEllipsis('图.png')).toEqual({ head: '图.png', tail: '' });
    expect(splitMiddleEllipsis('deep.json')).toEqual({ head: 'deep.json', tail: '' });
    expect(splitMiddleEllipsis('星河大陆设定.markdown')).toEqual({
      head: '星河大陆设定',
      tail: '.markdown',
    });
    expect(splitMiddleEllipsis('一个很长很长很长的目录说明')).toEqual({
      head: '一个很长很长很长的目录说明',
      tail: '',
    });
  });

  it('无扩展名的机器名也做中间省略', () => {
    const name = '00b6e200587d4be9ec966ff4422c8ac1';
    expect(splitMiddleEllipsis(name)).toEqual({ head: name.slice(0, -6), tail: '2c8ac1' });
  });

  it('按码点切分，不拆开 emoji', () => {
    const { head, tail } = splitMiddleEllipsis('旅途笔记😀😀😀😀😀😀.md');
    expect(tail).toBe('😀😀😀😀😀😀.md');
    expect(head).toBe('旅途笔记');
  });
});

describe('isMachineGeneratedName', () => {
  it.each([
    '00b6e200587d4be9ec966ff4422c8ac1.jpg',
    '08980f831c19c0f68b5fb259a97d2060.mp4',
    '{28131756-171F-87A0-1A39-2FABD995C1E2}.png',
    '28131756-171f-87a0-1a39-2fabd995c1e2.pdf',
    '28131756171f87a01a392fabd995c1e2',
    'a1b2c3d4e5f60718 (1).png',
    '1696512345678.webp',
  ])('%s 是机器名', (name) => {
    expect(isMachineGeneratedName(name)).toBe(true);
  });

  it.each(['世界观.md', 'deadbeef.png', 'IMG_20240101.jpg', 'cafe-babe.txt', '2024年设定.docx'])(
    '%s 不是机器名',
    (name) => {
      expect(isMachineGeneratedName(name)).toBe(false);
    }
  );
});

describe('getFileKind / getFileIcon', () => {
  it.each([
    ['a.PNG', 'image'],
    ['a.mp4', 'video'],
    ['a.m4a', 'audio'],
    ['a.pdf', 'pdf'],
    ['a.docx', 'word'],
    ['a.xlsx', 'excel'],
    ['a.csv', 'excel'],
    ['a.pptx', 'ppt'],
    ['a.7z', 'archive'],
    ['a.md', 'markdown'],
    ['a.txt', 'text'],
    ['a.json', 'code'],
    ['a.tsx', 'code'],
    ['a.bin', 'unknown'],
    ['README', 'unknown'],
  ])('%s → %s', (name, kind) => {
    expect(getFileKind(name)).toBe(kind);
    expect(getFileIcon(name, 'file').className).toBe(kind);
  });

  it('场景视频目录用视频图标（和普通文件夹区分）', () => {
    const scene = getFileIcon('全章', 'directory', undefined, { sceneVideo: true });
    expect(scene.className).toBe('video');
    expect(scene.icon).not.toBe(getFileIcon('全章', 'directory').icon);
  });

  it('目录始终使用文件夹图标；同类图标元素复用', () => {
    expect(getFileIcon('archive.zip', 'directory').className).toBe('folder');
    expect(getFileIcon('a.png', 'file').icon).toBe(getFileIcon('b.jpg', 'file').icon);
    expect(getFileIcon('a.json', 'file').icon).not.toBe(getFileIcon('a.ts', 'file').icon);
  });
});

describe('describeFileName / 提示文本', () => {
  it('类型标签：已知类型用中文，未知类型用扩展名', () => {
    expect(describeFileName('0123456789abcdef0123.mov')).toMatchObject({
      kind: 'video',
      kindLabel: '视频',
      machineGenerated: true,
    });
    expect(describeFileName('abc.bin').kindLabel).toBe('BIN');
    expect(describeFileName('README').kindLabel).toBe('文件');
  });

  it('文件大小与修改时间格式', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(-1)).toBe('0 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatModifiedTime(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04');
    expect(formatModifiedTime('not a date')).toBe('');
  });

  it('提示包含完整名、类型、大小与修改时间；无信息时只有名字', () => {
    const modified = new Date(2026, 9, 6, 12, 30);
    expect(buildFileTooltip('x.png', '图片', { size: 2048, modified })).toBe(
      'x.png\n图片 · 2 KB\n修改于 2026-10-06 12:30'
    );
    expect(buildFileTooltip('目录', null)).toBe('目录');
    expect(buildFileTooltip('x.png', '图片')).toBe('x.png\n图片');
  });
});

describe('FileTree 长文件名展示', () => {
  const HASH = '08980f831c19c0f68b5fb259a97d2060.mp4';
  const GUID = '{28131756-171F-87A0-1A39-2FABD995C1E2}.png';
  const files: FileNode[] = [
    { name: HASH, path: `/p/${HASH}`, type: 'file' },
    { name: GUID, path: `/p/${GUID}`, type: 'file' },
    { name: '世界观.md', path: '/p/世界观.md', type: 'file' },
  ];
  const info: FileInfo = {
    size: 3 * 1024 * 1024,
    created: new Date(0),
    modified: new Date(2026, 9, 6, 9, 5),
    isDirectory: false,
    isFile: true,
  };

  it('哈希名保留扩展名、悬停显示完整信息、行内显示类型标签', async () => {
    installElectronMock((channel, paths) =>
      channel === 'get-file-info-batch'
        ? (paths as string[]).map((path) => ({ path, info }))
        : undefined
    );
    const { container } = render(<FileTree files={files} onFileSelect={vi.fn()} />);

    // 扩展名所在的尾部是独立的不收缩片段
    const tail = screen.getByText('7d2060.mp4');
    expect(tail.className).toContain('itemNameTail');
    expect(tail.previousElementSibling?.className).toContain('itemNameHead');
    expect(tail.parentElement?.textContent).toBe(HASH);
    expect(screen.getByText('5C1E2}.png')).toBeTruthy();

    // 图标按类型区分
    expect(container.querySelector('.fileIcon.video')).toBeTruthy();
    expect(container.querySelector('.fileIcon.image')).toBeTruthy();
    expect(container.querySelector('.fileIcon.markdown')).toBeTruthy();

    // 机器名显示类型标签，普通名字不显示
    expect(screen.getByText('视频')).toBeTruthy();
    expect(screen.getByText('图片')).toBeTruthy();
    expect(screen.queryByText('Markdown')).toBeNull();

    const row = tail.closest('.itemHeader') as HTMLElement;
    expect(row.title).toBe(HASH + '\n视频');
    // 文件信息到达后提示补全大小与修改时间
    await screen.findAllByText('3 MB');
    expect(row.title).toBe(`${HASH}\n视频 · 3 MB\n修改于 2026-10-06 09:05`);
  });
});
