import React from 'react';
import {
  isChapterLikeStoryName,
  isDraftLikeStoryName,
  isVolumeLikeStoryName,
} from '../../../utils/workspace';
import type { StoryNodeKind } from '../../../utils/storyStructure';

export type StoryDirectoryLabel = '作品' | '稿夹' | '正文夹' | '卷';
export type StoryFileLabel = '稿' | '章' | '文档';

export interface StoryNodeMeta<TLabel extends string> {
  label: TLabel;
  icon: React.ReactNode;
}

/** 按名称推断的目录类型：稿夹 / 正文夹 / 卷 */
export function getStoryDirectoryLabel(name: string): StoryDirectoryLabel {
  if (isDraftLikeStoryName(name)) return '稿夹';
  if (!isVolumeLikeStoryName(name) && name !== '未分卷') return '正文夹';
  return '卷';
}

/** 文件类型：稿 / 章 */
export function getStoryFileLabel(name: string): StoryFileLabel {
  return !isChapterLikeStoryName(name) && isDraftLikeStoryName(name) ? '稿' : '章';
}

const DRAFT_FOLDER_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2.5 5.1h3.6l1.2-1.6h2.6l1 1.2H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.1a1 1 0 0 1 .5-1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M8.6 8.8 11.8 5.6m-2.4 4 .8 1.2 1.2-.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const GROUP_FOLDER_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2.7 4.1h3.2l1.1-1.4h2.3l1 1.2H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.1a1 1 0 0 1 .7-1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M5.3 7.2h5.4M5.3 9.7h4.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
    />
  </svg>
);

const VOLUME_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 2.6h6.7a1.3 1.3 0 0 1 1.3 1.3v8.8H5.2A1.2 1.2 0 0 0 4 13.9V2.6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M6 4.7h3.8M6 7.2h3.8M6 9.7h2.6M4 13.1c.3-.4.7-.6 1.2-.6h6.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const DRAFT_FILE_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 2.5h5.5L13 6v7.5H4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M9.5 2.5V6H13M5.7 11.2l3.6-3.6 1.3 1.3L7 12.5H5.7z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

const CHAPTER_FILE_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 2.5h5.5L13 6v7.5H4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M9.5 2.5V6H13M5.5 8h5M5.5 10.5h4.5M5.5 13h3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const WORK_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 3.2c1.6-.6 3.3-.5 5 .6 1.7-1.1 3.4-1.2 5-.6v9.4c-1.6-.6-3.3-.5-5 .6-1.7-1.1-3.4-1.2-5-.6z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M8 3.8v9.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const DOCUMENT_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 2.5h5.5L13 6v7.5H4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <path
      d="M9.5 2.5V6H13M6.4 9.6h.01M8.5 8.6v3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

const DIRECTORY_ICONS: Record<StoryDirectoryLabel, React.ReactNode> = {
  作品: WORK_ICON,
  稿夹: DRAFT_FOLDER_ICON,
  正文夹: GROUP_FOLDER_ICON,
  卷: VOLUME_ICON,
};

const FILE_ICONS: Record<StoryFileLabel, React.ReactNode> = {
  稿: DRAFT_FILE_ICON,
  章: CHAPTER_FILE_ICON,
  文档: DOCUMENT_ICON,
};

const KIND_DIRECTORY_LABELS: Partial<Record<StoryNodeKind, StoryDirectoryLabel>> = {
  work: '作品',
  volume: '卷',
};

const KIND_FILE_LABELS: Partial<Record<StoryNodeKind, StoryFileLabel>> = {
  chapter: '章',
  document: '文档',
};

/** 目录元信息：项目模式下由结构给出的 kind 决定（作品 / 卷），否则按名称推断 */
export function getStoryDirectoryMeta(
  name: string,
  kind?: StoryNodeKind
): StoryNodeMeta<StoryDirectoryLabel> {
  const label = (kind && KIND_DIRECTORY_LABELS[kind]) || getStoryDirectoryLabel(name);
  return { label, icon: DIRECTORY_ICONS[label] };
}

/** 文件元信息：项目模式下作品内的文件一律是章，项目文档是文档，否则按名称推断 */
export function getStoryFileMeta(
  name: string,
  kind?: StoryNodeKind
): StoryNodeMeta<StoryFileLabel> {
  const label = (kind && KIND_FILE_LABELS[kind]) || getStoryFileLabel(name);
  return { label, icon: FILE_ICONS[label] };
}
