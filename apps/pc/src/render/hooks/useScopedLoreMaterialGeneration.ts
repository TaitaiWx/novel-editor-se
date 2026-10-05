import { useCallback } from 'react';
import type {
  AssistantScopeTarget,
  AssistantScopedCharacter,
  AssistantScopedLore,
  AssistantScopedMaterial,
} from '@/render/app/types';
import type { FileNode } from '@/render/types';
import { WORKSPACE_TAB_LORE } from '@/render/utils/workspace';
import {
  buildLoreDedupKey,
  loadLoreEntriesByFolder,
} from '@/render/components/RightPanel/lore-data';
import {
  buildUniqueMarkdownName,
  findNodeInTree,
  isMaterialLikeName,
} from '@/render/app/fileTreeUtils';
import {
  parseLoreGenerationResult,
  parseMaterialGenerationResult,
} from '@/render/app/aiGeneration';
import type { UseScopedAssistantGenerationContext } from './useScopedAssistantGeneration';

export type UseScopedLoreMaterialGenerationContext = Pick<
  UseScopedAssistantGenerationContext,
  | 'bumpWorkspaceLoreVersion'
  | 'ensurePersistedAiReady'
  | 'filesRef'
  | 'folderPathRef'
  | 'openFileInTab'
  | 'refreshCurrentFolder'
  | 'resolveScopeTargetContext'
  | 'setAssistantScopedLoreEntries'
  | 'setAssistantScopedMaterials'
  | 'setWorkspaceLoreEntries'
  | 'toast'
> & {
  /** 判断作用域是否为用户当前正在查看的面板 */
  isViewingScope: (scope: AssistantScopeTarget) => boolean;
  /** 持久化作用域助手产物（人物 / 设定 / 资料） */
  persistScopedAssistantArtifacts: (
    scope: AssistantScopeTarget,
    payload: {
      characters?: AssistantScopedCharacter[];
      lore?: AssistantScopedLore[];
      materials?: AssistantScopedMaterial[];
    }
  ) => Promise<void>;
};

/**
 * 按作用域生成设定上下文与资料上下文，并同步到设定库 / 资料目录
 * 从 useScopedAssistantGeneration 拆出，回调实现与依赖保持不变
 */
export function useScopedLoreMaterialGeneration(ctx: UseScopedLoreMaterialGenerationContext) {
  const {
    bumpWorkspaceLoreVersion,
    ensurePersistedAiReady,
    filesRef,
    folderPathRef,
    isViewingScope,
    openFileInTab,
    persistScopedAssistantArtifacts,
    refreshCurrentFolder,
    resolveScopeTargetContext,
    setAssistantScopedLoreEntries,
    setAssistantScopedMaterials,
    setWorkspaceLoreEntries,
    toast,
  } = ctx;

  const handleGenerateScopedLore = useCallback(
    async (scope: AssistantScopeTarget) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      const persistedSettings = await ensurePersistedAiReady();
      if (!persistedSettings) return;

      try {
        toast.info(`正在为${scope.label}生成设定上下文...`, 1800);
        const { content, label } = await resolveScopeTargetContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请从给定内容中提炼当前作用域可直接用于写作的设定上下文。必须严格返回 JSON 对象，格式为 {"entries":[{"category":"world|faction|system|term","title":"","summary":"","tags":[""]}]}。只保留对当前作用域真正有帮助的设定，不要输出 Markdown。',
          systemPrompt:
            '你是创作助手的设定编辑。你只输出当前作用域最关键的世界观、规则、势力和术语。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成设定上下文失败');
        const nextLore = parseLoreGenerationResult(response.text || '').map((item) => ({
          category: item.category,
          title: item.title,
          summary: item.summary,
        }));
        await persistScopedAssistantArtifacts(scope, { lore: nextLore });

        const existingEntries = await loadLoreEntriesByFolder(folder);
        const existingByKey = new Map(
          existingEntries.map((item) => [buildLoreDedupKey(item), item])
        );
        let createdCount = 0;
        let updatedCount = 0;

        for (const item of nextLore) {
          const matched = existingByKey.get(buildLoreDedupKey(item));
          if (matched) {
            if (!matched.summary.trim() && item.summary.trim()) {
              await ipc.invoke('db-world-setting-update', matched.id, {
                content: item.summary,
                tags: JSON.stringify([]),
              });
              updatedCount += 1;
            }
            continue;
          }
          await ipc.invoke(
            'db-world-setting-create-by-folder',
            folder,
            item.category,
            item.title,
            item.summary,
            JSON.stringify([])
          );
          createdCount += 1;
        }

        const syncedEntries = await loadLoreEntriesByFolder(folder);
        setWorkspaceLoreEntries(syncedEntries);
        bumpWorkspaceLoreVersion();
        // 设定已写入 SQLite 后，自动切到设定页，避免“生成成功但入口不明确”。
        openFileInTab(WORKSPACE_TAB_LORE);
        if (isViewingScope(scope)) {
          setAssistantScopedLoreEntries(nextLore);
        }
        toast.success(
          `已为${scope.label}生成设定上下文 ${nextLore.length} 项，并同步设定库（新增 ${createdCount}，补全 ${updatedCount}）`
        );
      } catch (error) {
        toast.error(
          `AI 生成设定上下文失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      bumpWorkspaceLoreVersion,
      ensurePersistedAiReady,
      folderPathRef,
      isViewingScope,
      openFileInTab,
      persistScopedAssistantArtifacts,
      resolveScopeTargetContext,
      setAssistantScopedLoreEntries,
      setWorkspaceLoreEntries,
      toast,
    ]
  );

  const handleGenerateScopedMaterials = useCallback(
    async (scope: AssistantScopeTarget) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      const persistedSettings = await ensurePersistedAiReady();
      if (!persistedSettings) return;

      try {
        toast.info(`正在为${scope.label}生成资料上下文...`, 1800);
        const { content, label } = await resolveScopeTargetContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请根据给定作品内容，生成当前作用域可直接使用的资料上下文。必须严格返回 JSON 对象，格式为 {"materials":[{"title":"","summary":"","kind":"reference|scene|character|setting|research","relatedChapter":"","keywords":[""]}]}。不要输出 Markdown。',
          systemPrompt:
            '你是创作助手的资料编辑。你只保留当前作用域最值得引用的参考资料、场景资料、人物资料和设定资料。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成资料上下文失败');
        const nextMaterials = parseMaterialGenerationResult(response.text || '').map((item) => ({
          title: item.title,
          summary: item.summary,
          kind: item.kind,
          relatedChapter: item.relatedChapter || '',
        }));
        await persistScopedAssistantArtifacts(scope, { materials: nextMaterials });

        // 资料上下文不仅保存在 SQLite settings，也同步落盘到资料目录，保证在文件树可见。
        if (nextMaterials.length > 0) {
          let createdMaterialRoot = false;
          const existingMaterialRoot = filesRef.current.find(
            (node) => node.type === 'directory' && isMaterialLikeName(node.name)
          );
          const defaultMaterialRoot =
            existingMaterialRoot?.path ??
            ((createdMaterialRoot = true),
            (
              (await ipc.invoke('create-directory', folder, '资料')) as {
                success: boolean;
                dirPath: string;
              }
            ).dirPath);
          const scopeDirName =
            scope.kind === 'project'
              ? '项目上下文'
              : scope.kind === 'volume'
                ? '卷上下文'
                : '章上下文';
          const scopeRootPath = `${defaultMaterialRoot.replace(/[\\/]+$/, '')}/${scopeDirName}`;
          const existingScopeRoot = findNodeInTree(filesRef.current, scopeRootPath);
          let createdScopeRoot = false;
          const scopedMaterialRoot =
            existingScopeRoot?.type === 'directory'
              ? existingScopeRoot.path
              : ((createdScopeRoot = true),
                (
                  (await ipc.invoke('create-directory', defaultMaterialRoot, scopeDirName)) as {
                    success: boolean;
                    dirPath: string;
                  }
                ).dirPath);

          const existingNames = new Set(
            ((findNodeInTree(filesRef.current, scopedMaterialRoot)?.children || []) as FileNode[])
              .filter((node): node is FileNode & { type: 'file' } => node.type === 'file')
              .map((node) => node.name)
          );

          let writtenCount = 0;
          for (const draft of nextMaterials) {
            const fileName = buildUniqueMarkdownName(draft.title, existingNames);
            const created = (await ipc.invoke('create-file', scopedMaterialRoot, fileName)) as {
              success: boolean;
              filePath: string;
            };
            if (!created.success || !created.filePath) continue;
            const body = [
              `# ${draft.title}`,
              '',
              `类型：${draft.kind}`,
              draft.relatedChapter ? `关联章节：${draft.relatedChapter}` : '',
              '',
              draft.summary,
            ]
              .filter(Boolean)
              .join('\n');
            await ipc.invoke('write-file', created.filePath, body);
            writtenCount += 1;
          }

          if (writtenCount === 0) {
            if (createdScopeRoot) {
              await ipc.invoke('delete-directory', scopedMaterialRoot);
            }
            if (createdMaterialRoot) {
              await ipc.invoke('delete-directory', defaultMaterialRoot);
            }
            toast.warning('资料上下文未成功落盘，已取消创建空目录');
            return;
          }

          await refreshCurrentFolder();
        }

        if (isViewingScope(scope)) {
          setAssistantScopedMaterials(nextMaterials);
        }
        toast.success(
          `已为${scope.label}生成资料上下文 ${nextMaterials.length} 项，并同步到资料目录`
        );
      } catch (error) {
        toast.error(
          `AI 生成资料上下文失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      ensurePersistedAiReady,
      filesRef,
      folderPathRef,
      isViewingScope,
      persistScopedAssistantArtifacts,
      refreshCurrentFolder,
      resolveScopeTargetContext,
      setAssistantScopedMaterials,
      toast,
    ]
  );

  return { handleGenerateScopedLore, handleGenerateScopedMaterials };
}
