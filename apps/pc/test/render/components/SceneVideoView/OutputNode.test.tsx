// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OutputNode } from '@/render/components/SceneVideoView/nodes';

afterEach(cleanup);

const props = { aspectRatio: '16:9', doneCount: 7, totalCount: 7, stitchProgress: null };

describe('样片节点', () => {
  it('还没有样片：提示全部镜头生成后自动合成', () => {
    render(<OutputNode {...props} animatic={null} readFile={vi.fn()} />);
    expect(screen.getByText('全部镜头生成后自动合成样片')).toBeTruthy();
  });

  // 回归：样片已经合成（十几 MB），读取期间曾显示「全部镜头生成后自动合成样片」，看起来像没有合成
  it('有样片但还在读取：显示正在载入，而不是「全部镜头生成后…」', () => {
    render(
      <OutputNode
        {...props}
        animatic="样片-1.mp4"
        readFile={() => new Promise<Uint8Array>(() => undefined)}
      />
    );
    expect(screen.getByTestId('scene-video-animatic-loading').textContent).toBe('正在载入样片…');
    expect(screen.queryByText('全部镜头生成后自动合成样片')).toBeNull();
  });

  it('读取失败时说明原因；读取成功后显示播放器', async () => {
    const { unmount } = render(
      <OutputNode
        {...props}
        animatic="样片-1.mp4"
        readFile={() => Promise.reject(new Error('文件不存在'))}
      />
    );
    expect((await screen.findByText('样片无法预览：文件不存在')).textContent).toContain(
      '文件不存在'
    );
    unmount();
    URL.createObjectURL = vi.fn(() => 'blob:animatic');
    URL.revokeObjectURL = vi.fn();
    render(
      <OutputNode {...props} animatic="样片-1.mp4" readFile={async () => new Uint8Array([1])} />
    );
    expect((await screen.findByTestId('scene-video-animatic')).getAttribute('src')).toBe(
      'blob:animatic'
    );
  });
});
