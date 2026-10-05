// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { getFileTypeMeta } from '@/render/components/VersionTimeline/fileTypeMeta';

describe('getFileTypeMeta', () => {
  it.each([
    ['application/pdf', 'pdf', 'PDF'],
    ['image/png', 'image', '图片'],
    ['image/svg+xml', 'image', '图片'],
    ['audio/mpeg', 'audio', '音频'],
    ['video/mp4', 'video', '视频'],
    ['application/json', 'text', 'JSON'],
    ['text/markdown', 'text', 'Markdown'],
    ['text/plain', 'text', '文本'],
    ['application/octet-stream', 'binary', '二进制'],
    ['application/zip', 'binary', '二进制'],
  ])('%s → %s / %s', (mimeType, kind, label) => {
    const meta = getFileTypeMeta(mimeType);
    expect(meta.kind).toBe(kind);
    expect(meta.label).toBe(label);
  });

  it('返回可渲染的图标节点', () => {
    const { container } = render(<>{getFileTypeMeta('application/pdf').icon}</>);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
