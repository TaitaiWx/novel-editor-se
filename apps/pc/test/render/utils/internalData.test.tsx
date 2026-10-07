// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  INTERNAL_PROJECT_META_DIR,
  INTERNAL_VIDEO_DIR,
  PROJECT_META_DIR,
  SCENE_STATE_FILE,
  SCENE_STORYBOARD_MD_FILE,
  filterInternalDataTree,
} from '@novel-editor/core';
import {
  SCENE_STORYBOARD_JSON,
  SCENE_STORYBOARD_MARKDOWN,
  VIDEO_MATERIAL_SEGMENTS,
  videoOutputLayout,
} from '@novel-editor/video';
import InternalDataNotice from '@/render/components/InternalDataNotice';
import { buildSearchGroups } from '@/render/components/FilePanel/search';
import {
  internalDataMessage,
  isInternalDataFile,
  isReadOnlyDataFile,
  resolveInternalOpenTarget,
} from '@/render/utils/internalData';
import { hideRawData, looksLikeRawData } from '@/render/utils/debugMode';
import type { FileNode } from '@/render/types';
import type { ElectronAPI } from '@/render/types/electron-api';

const ROOT = '/w';
const SCENE_DIR = '/w/novels/星河旅人/资料/视频/001-启程/第一场';

afterEach(() => {
  delete (window as unknown as { electron?: ElectronAPI }).electron;
});

describe('core 常量与 @novel-editor/video / project.ts 保持一致', () => {
  it('分镜状态 / 分镜表 / 视频目录 / 提示词记录', () => {
    expect(SCENE_STATE_FILE).toBe(SCENE_STORYBOARD_JSON);
    expect(SCENE_STORYBOARD_MD_FILE).toBe(SCENE_STORYBOARD_MARKDOWN);
    expect(INTERNAL_VIDEO_DIR).toBe(VIDEO_MATERIAL_SEGMENTS[1]);
    expect(INTERNAL_PROJECT_META_DIR).toBe(PROJECT_META_DIR);
    const layout = videoOutputLayout({
      chapter: '001-启程',
      scene: '第一场',
      shotIndex: 1,
      version: 1,
    });
    expect(isInternalDataFile(`${ROOT}/${layout.promptFile}`, ROOT)).toBe(true);
    expect(isInternalDataFile(`${ROOT}/${layout.file}`, ROOT)).toBe(false);
    expect(isInternalDataFile(`${ROOT}/${layout.dir}/${SCENE_STORYBOARD_JSON}`, ROOT)).toBe(true);
  });
});

describe('resolveInternalOpenTarget', () => {
  it('普通文件照常打开', () => {
    expect(resolveInternalOpenTarget('/w/资料/设定.json', ROOT)).toBeNull();
    expect(resolveInternalOpenTarget('/w/novels/星河旅人/001-启程.md', ROOT)).toBeNull();
  });

  it('场景目录 / 分镜状态 → 场景视频画布', () => {
    expect(resolveInternalOpenTarget(SCENE_DIR, ROOT, true)).toEqual({
      kind: 'scene-video',
      stateFile: `${SCENE_DIR}/分镜.json`,
    });
    // 没有标记的同名目录照常展开（不当作场景）
    expect(resolveInternalOpenTarget(SCENE_DIR, ROOT, false)).toBeNull();
    expect(resolveInternalOpenTarget(`${SCENE_DIR}/分镜.json`, ROOT)).toEqual({
      kind: 'scene-video',
      stateFile: `${SCENE_DIR}/分镜.json`,
    });
  });

  it('成长档案 JSON → 成长档案界面；其他内部数据只提示', () => {
    expect(resolveInternalOpenTarget('/w/资料/记忆/角色/林舟.json', ROOT)).toEqual({
      kind: 'growth',
      character: '林舟',
    });
    expect(resolveInternalOpenTarget('/w/资料/记忆/规则.json', ROOT)).toEqual({
      kind: 'growth',
      character: null,
    });
    expect(resolveInternalOpenTarget(`${SCENE_DIR}/镜头1-v1.prompt.json`, ROOT)).toEqual({
      kind: 'blocked',
      owner: 'scene-video',
    });
    expect(internalDataMessage('growth')).toBe('这是软件内部数据，请在「成长档案」中查看');
  });

  it('派生摘要只读；工作区标签不参与判定', () => {
    expect(isReadOnlyDataFile('/w/资料/记忆/README.md', ROOT)).toBe(true);
    expect(isReadOnlyDataFile(`${SCENE_DIR}/分镜.md`, ROOT)).toBe(true);
    expect(isReadOnlyDataFile('/w/资料/笔记.md', ROOT)).toBe(false);
    expect(isInternalDataFile('__workspace__:growth', ROOT)).toBe(false);
    expect(isReadOnlyDataFile(null, ROOT)).toBe(false);
  });
});

describe('文件面板搜索不返回内部数据', () => {
  it('资料与全文结果都跳过分镜状态 / 成长档案 JSON', () => {
    const tree: FileNode[] = [
      {
        name: '第一场',
        path: SCENE_DIR,
        type: 'directory',
        children: [
          { name: '分镜.json', path: `${SCENE_DIR}/分镜.json`, type: 'file' },
          { name: '分镜.md', path: `${SCENE_DIR}/分镜.md`, type: 'file' },
        ],
      },
      { name: '分镜.json', path: '/w/资料/记忆/分镜.json', type: 'file' },
    ];
    const run = (nodes: FileNode[]) =>
      buildSearchGroups({
        query: '分镜',
        rootPath: ROOT,
        projectDocs: [],
        storyNodes: [],
        materialNodes: nodes,
        characters: [],
        loreEntries: [],
        growthSheets: [],
        contentFiles: [
          {
            file: `${SCENE_DIR}/分镜.json`,
            matchCount: 1,
            matches: [{ line: 1, preview: '分镜', matchStart: 0, matchLength: 2 }],
          },
        ],
      });
    for (const nodes of [tree, filterInternalDataTree(tree, ROOT)]) {
      const paths = run(nodes).flatMap((group) =>
        group.items.map((item) => ('path' in item ? item.path : ''))
      );
      expect(paths).toEqual([`${SCENE_DIR}/分镜.md`]);
    }
  });
});

describe('InternalDataNotice', () => {
  it('显示「请在 XX 中查看」与跳转按钮，不显示原始 JSON', () => {
    let opened = 0;
    render(<InternalDataNotice owner="scene-video" onOpen={() => (opened += 1)} />);
    expect(screen.getByText('这是软件内部数据，请在「场景视频」中查看')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开场景视频' }));
    expect(opened).toBe(1);
  });

  it('没有对应界面时不显示按钮', () => {
    render(<InternalDataNotice owner="entity-media" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('调试模式与原始数据', () => {
  it('原始 JSON 只在 NOVEL_EDITOR_DEBUG=1 时显示', () => {
    expect(looksLikeRawData('{"error":{"code":1}}')).toBe(true);
    expect(looksLikeRawData('```json\n[]\n```')).toBe(true);
    expect(looksLikeRawData('网络断开了')).toBe(false);
    expect(hideRawData('{"a":1}', '出错了')).toBe('出错了');
    expect(hideRawData('网络断开了', '出错了')).toBe('网络断开了');
    (window as unknown as { electron: Partial<ElectronAPI> }).electron = { debug: true };
    expect(hideRawData('{"a":1}', '出错了')).toBe('{"a":1}');
  });
});
