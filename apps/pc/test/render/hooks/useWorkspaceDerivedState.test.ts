// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FileNode, WorkspaceProjectLayout } from '@/render/types';
import { useWorkspaceDerivedState } from '@/render/hooks/useWorkspaceDerivedState';

const files: FileNode[] = [
  { name: '欢迎使用.md', path: '/s/欢迎使用.md', type: 'file' },
  {
    name: 'novels',
    path: '/s/novels',
    type: 'directory',
    children: [
      {
        name: '书',
        path: '/s/novels/书',
        type: 'directory',
        children: [{ name: '001-开端.md', path: '/s/novels/书/001-开端.md', type: 'file' }],
      },
    ],
  },
];
const projectLayout: WorkspaceProjectLayout = {
  name: '项目',
  novelsDir: 'novels',
  novelsPath: '/s/novels',
  novels: ['书'],
};

function derive(activeTab: string | null, layout: WorkspaceProjectLayout | null = projectLayout) {
  return renderHook(() =>
    useWorkspaceDerivedState({
      activeTab,
      chapterMaterialPaths: [],
      files,
      folderPath: '/s',
      projectLayout: layout,
      untitledTabContents: {},
      workspaceProjectName: null,
    })
  ).result.current;
}

describe('useWorkspaceDerivedState · 项目文档', () => {
  it('项目文档不启用章节助手，助手范围回退到项目', () => {
    const state = derive('/s/欢迎使用.md');
    expect(state.chapterAssistantEnabled).toBe(false);
    expect(state.currentAssistantScope).toMatchObject({ kind: 'project', path: '/s' });
    expect(state.projectDocPaths.has('/s/欢迎使用.md')).toBe(true);
  });

  it('作品中的章节启用章节助手，正文文件列表不含项目文档', () => {
    const state = derive('/s/novels/书/001-开端.md');
    expect(state.chapterAssistantEnabled).toBe(true);
    expect(state.currentAssistantScope).toMatchObject({ kind: 'chapter' });
    expect(state.storyFileNodes.map((node) => node.path)).toEqual(['/s/novels/书/001-开端.md']);
    expect(state.rootVolumeNode).toBeNull();
    expect(state.storyStructure.mode).toBe('project');
  });

  it('普通文件夹：未分卷不包含项目文档', () => {
    const state = derive('/s/欢迎使用.md', null);
    expect(state.chapterAssistantEnabled).toBe(false);
    expect(state.rootVolumeNode?.name).toBe('未分卷');
    expect(JSON.stringify(state.rootVolumeNode)).not.toContain('欢迎使用');
  });
});
