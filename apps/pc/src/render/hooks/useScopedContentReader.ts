import { useCallback } from 'react';
import type { AIGenerationScope, AssistantScopeTarget } from '@/render/app/types';
import type { FileNode } from '@/render/types';
import { findNodeInTree, getNodeDisplayName } from '@/render/app/fileTreeUtils';
import { flattenFileNodes, isStoryFilePath } from '@/render/utils/workspace';
import { getAIGenerationScopeLabel } from '@/render/app/aiGeneration';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { EditorState } from './state/useEditorState';

export type UseScopedContentReaderContext = Pick<
  WorkspaceDerivedState,
  'activeDocumentTab' | 'rootVolumeNode' | 'storyFileNodes'
> &
  Pick<WorkspaceState, 'filesRef'> &
  Pick<EditorState, 'editorContentRef'>;

/**
 * 按作用域（章 / 卷 / 作品）读取正文内容，供 AI 生成使用
 */
export function useScopedContentReader(ctx: UseScopedContentReaderContext) {
  const { activeDocumentTab, editorContentRef, filesRef, rootVolumeNode, storyFileNodes } = ctx;

  const getStoryFilesForScope = useCallback(
    (scope: AssistantScopeTarget): Array<FileNode & { type: 'file' }> => {
      if (scope.kind === 'chapter') {
        const targetNode = findNodeInTree(filesRef.current, scope.path);
        return targetNode?.type === 'file' && isStoryFilePath(targetNode.path)
          ? [targetNode as FileNode & { type: 'file' }]
          : [];
      }

      if (scope.kind === 'volume') {
        const targetNode =
          (findNodeInTree(filesRef.current, scope.path) as FileNode | null) ||
          (rootVolumeNode && scope.path === rootVolumeNode.path ? rootVolumeNode : null);
        if (!targetNode || targetNode.type !== 'directory') return [];
        return flattenFileNodes(targetNode.children || []).filter(
          (node): node is FileNode & { type: 'file' } =>
            node.type === 'file' && isStoryFilePath(node.path)
        );
      }

      return storyFileNodes;
    },
    [rootVolumeNode, storyFileNodes]
  );

  const readStoryDocumentText = useCallback(
    async (filePath: string): Promise<string> => {
      const ipc = window.electron?.ipcRenderer;
      if (activeDocumentTab === filePath) {
        return editorContentRef.current || '';
      }
      if (!ipc) {
        throw new Error('Electron IPC 不可用');
      }
      return (await ipc.invoke('read-file', filePath)) as string;
    },
    [activeDocumentTab]
  );

  const resolveAIGenerationContext = useCallback(
    async (scope: AIGenerationScope): Promise<{ content: string; label: string }> => {
      if (scope === 'current-content') {
        const currentContent = editorContentRef.current.trim();
        if (!currentContent) {
          throw new Error('当前没有可用于生成的打开内容');
        }
        return { content: currentContent, label: getAIGenerationScopeLabel(scope) };
      }

      if (scope === 'current-chapter') {
        if (!activeDocumentTab || !isStoryFilePath(activeDocumentTab)) {
          throw new Error('请先打开一个正文章节或样稿');
        }
        const chapterContent = (await readStoryDocumentText(activeDocumentTab)).trim();
        if (!chapterContent) {
          throw new Error('当前章节内容为空，无法生成');
        }
        return {
          content: chapterContent,
          label: `${getAIGenerationScopeLabel(scope)} · ${getNodeDisplayName(activeDocumentTab)}`,
        };
      }

      if (storyFileNodes.length === 0) {
        throw new Error('当前作品没有可用的正文内容');
      }

      const sections: string[] = [];
      let totalLength = 0;
      for (const node of storyFileNodes) {
        const raw = (await readStoryDocumentText(node.path)).trim();
        if (!raw) continue;
        const section = `# ${getNodeDisplayName(node.path)}\n\n${raw}`;
        if (totalLength + section.length > 120000 && sections.length > 0) break;
        sections.push(section);
        totalLength += section.length;
      }

      const merged = sections.join('\n\n');
      if (!merged.trim()) {
        throw new Error('整部作品当前没有可用于生成的正文内容');
      }
      return { content: merged, label: getAIGenerationScopeLabel(scope) };
    },
    [activeDocumentTab, readStoryDocumentText, storyFileNodes]
  );

  const resolveScopeTargetContext = useCallback(
    async (scope: AssistantScopeTarget): Promise<{ content: string; label: string }> => {
      if (scope.kind === 'chapter') {
        const content = (await readStoryDocumentText(scope.path)).trim();
        if (!content) {
          throw new Error('当前章节内容为空，无法生成');
        }
        return {
          content,
          label: `当前章节 · ${scope.label}`,
        };
      }

      const scopedFiles = getStoryFilesForScope(scope);
      if (scopedFiles.length === 0) {
        throw new Error(
          scope.kind === 'volume' ? '当前卷没有可用的正文内容' : '当前作品没有可用的正文内容'
        );
      }

      const sections: string[] = [];
      let totalLength = 0;
      for (const node of scopedFiles) {
        const raw = (await readStoryDocumentText(node.path)).trim();
        if (!raw) continue;
        const section = `# ${getNodeDisplayName(node.path)}\n\n${raw}`;
        if (totalLength + section.length > 120000 && sections.length > 0) break;
        sections.push(section);
        totalLength += section.length;
      }

      const content = sections.join('\n\n').trim();
      if (!content) {
        throw new Error(
          scope.kind === 'volume' ? '当前卷没有可用于生成的内容' : '当前作品没有可用于生成的内容'
        );
      }
      return {
        content,
        label: `${scope.kind === 'volume' ? '当前卷' : '当前作品'} · ${scope.label}`,
      };
    },
    [getStoryFilesForScope, readStoryDocumentText]
  );

  return {
    getStoryFilesForScope,
    readStoryDocumentText,
    resolveAIGenerationContext,
    resolveScopeTargetContext,
  };
}

export type ScopedContentReader = ReturnType<typeof useScopedContentReader>;
