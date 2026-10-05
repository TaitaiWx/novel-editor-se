/**
 * 根据 MIME 类型返回文件类型徽标元信息（类型、文案、图标）
 */
import React from 'react';
import {
  VscFileMedia,
  VscFilePdf,
  VscMusic,
  VscCode,
  VscMarkdown,
  VscJson,
  VscFile,
} from 'react-icons/vsc';
import type { FileTypeMeta } from './types';

export const getFileTypeMeta = (mimeType: string): FileTypeMeta => {
  if (mimeType === 'application/pdf') {
    return { kind: 'pdf', label: 'PDF', icon: <VscFilePdf /> };
  }

  if (mimeType.startsWith('image/')) {
    return { kind: 'image', label: '图片', icon: <VscFileMedia /> };
  }

  if (mimeType.startsWith('audio/')) {
    return { kind: 'audio', label: '音频', icon: <VscMusic /> };
  }

  if (mimeType.startsWith('video/')) {
    return { kind: 'video', label: '视频', icon: <VscFileMedia /> };
  }

  if (mimeType === 'application/json') {
    return { kind: 'text', label: 'JSON', icon: <VscJson /> };
  }

  if (mimeType === 'text/markdown') {
    return { kind: 'text', label: 'Markdown', icon: <VscMarkdown /> };
  }

  if (mimeType.startsWith('text/')) {
    return { kind: 'text', label: '文本', icon: <VscCode /> };
  }

  return { kind: 'binary', label: '二进制', icon: <VscFile /> };
};
