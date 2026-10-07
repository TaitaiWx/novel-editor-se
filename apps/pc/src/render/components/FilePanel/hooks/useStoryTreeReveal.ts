import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileNode } from '../../../types';
import type { AssistantArtifactGenerationStatus } from '../../../utils/assistantGeneration';
import { findAncestorPaths } from '../utils';
import type { CollapsedSections, FilePanelSection } from '../types';

/** 高亮"定位"节点的持续时间（毫秒） */
export const REVEAL_HIGHLIGHT_DURATION = 420;

interface UseStoryTreeRevealOptions {
  storyDisplayNodes: FileNode[];
  selectedFile: string | null;
  activeVolumePath: string | null;
  revealFileRequest: { path: string; id: string } | null;
  characterGenerationStatus: AssistantArtifactGenerationStatus | null;
  /** 收到外部定位请求时关闭搜索 */
  closeSearch: () => void;
  /** 定位目标是否在「资料」分区（按文件树判断，不按目录名匹配） */
  isMaterialPath?: (path: string) => boolean;
}

/**
 * 正文树的展开 / 分区折叠 / 定位高亮状态。
 * - 选中文件或激活卷时自动展开祖先目录
 * - 外部定位请求：关闭搜索、展开正文分区与祖先目录，并短暂高亮 + 滚动到目标节点
 * - 角色生成状态变化时自动展开角色分区
 */
export function useStoryTreeReveal({
  storyDisplayNodes,
  selectedFile,
  activeVolumePath,
  revealFileRequest,
  characterGenerationStatus,
  closeSearch,
  isMaterialPath,
}: UseStoryTreeRevealOptions) {
  const isMaterialPathRef = useRef(isMaterialPath);
  isMaterialPathRef.current = isMaterialPath;
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<CollapsedSections>({
    story: false,
    characters: false,
    lore: false,
    growth: false,
    materials: false,
  });
  const [expandedStoryDirs, setExpandedStoryDirs] = useState<Set<string>>(new Set());
  const revealResetTimerRef = useRef<number | null>(null);
  const storyNodeRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastCharacterStatusSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedFile) return;
    setExpandedStoryDirs((prev) => {
      const next = new Set(prev);
      findAncestorPaths(storyDisplayNodes, selectedFile).forEach((path) => next.add(path));
      return next;
    });
  }, [selectedFile, storyDisplayNodes]);

  useEffect(() => {
    if (!activeVolumePath) return;
    setExpandedStoryDirs((prev) => {
      const next = new Set(prev);
      findAncestorPaths(storyDisplayNodes, activeVolumePath).forEach((path) => next.add(path));
      next.add(activeVolumePath);
      return next;
    });
  }, [activeVolumePath, storyDisplayNodes]);

  // 生成状态签名：仅在 scopePath / state / 起止时间变化时触发 effect，忽略对象引用变化
  const characterStatusSignature = characterGenerationStatus
    ? [
        characterGenerationStatus.scopePath,
        characterGenerationStatus.state,
        characterGenerationStatus.startedAt,
        characterGenerationStatus.finishedAt || '',
      ].join(':')
    : null;
  const characterStatusRunning = characterGenerationStatus?.state === 'running';

  useEffect(() => {
    if (characterStatusSignature === null) return;
    const previousSignature = lastCharacterStatusSignatureRef.current;
    lastCharacterStatusSignatureRef.current = characterStatusSignature;

    const shouldReveal =
      characterStatusRunning ||
      (previousSignature !== null && previousSignature !== characterStatusSignature);
    if (!shouldReveal) return;

    setCollapsedSections((prev) => (prev.characters ? { ...prev, characters: false } : prev));
  }, [characterStatusSignature, characterStatusRunning]);

  const toggleSection = useCallback((section: FilePanelSection) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const toggleStoryDirectory = useCallback((path: string) => {
    setExpandedStoryDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const triggerRevealPath = useCallback((path: string) => {
    if (revealResetTimerRef.current !== null) {
      window.clearTimeout(revealResetTimerRef.current);
    }
    setRevealPath(path);
    revealResetTimerRef.current = window.setTimeout(() => {
      setRevealPath((current) => (current === path ? null : current));
      revealResetTimerRef.current = null;
    }, REVEAL_HIGHLIGHT_DURATION);
  }, []);

  useEffect(() => {
    return () => {
      if (revealResetTimerRef.current !== null) {
        window.clearTimeout(revealResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!revealFileRequest?.path) return;
    closeSearch();
    // 资料里的文件（例如场景视频的成片）展开「资料」分区，其余展开「正文」
    const section = isMaterialPathRef.current?.(revealFileRequest.path) ? 'materials' : 'story';
    setCollapsedSections((prev) => (prev[section] ? { ...prev, [section]: false } : prev));
    setExpandedStoryDirs((prev) => {
      const next = new Set(prev);
      findAncestorPaths(storyDisplayNodes, revealFileRequest.path).forEach((path) =>
        next.add(path)
      );
      return next;
    });
    triggerRevealPath(revealFileRequest.path);
    // closeSearch 为稳定回调（useCallback 空依赖），加入依赖不会导致额外触发
  }, [
    closeSearch,
    revealFileRequest?.id,
    revealFileRequest?.path,
    storyDisplayNodes,
    triggerRevealPath,
  ]);

  useEffect(() => {
    if (!revealPath) return;
    let outerFrame = 0;
    let innerFrame = 0;
    outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        const target = storyNodeRefsRef.current.get(revealPath);
        if (!target) return;
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        target.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [expandedStoryDirs, revealPath]);

  /** 记录 / 移除正文节点 DOM，用于定位时滚动聚焦 */
  const registerStoryNodeRef = useCallback((path: string, element: HTMLDivElement | null) => {
    if (element) {
      storyNodeRefsRef.current.set(path, element);
      return;
    }
    storyNodeRefsRef.current.delete(path);
  }, []);

  return {
    revealPath,
    collapsedSections,
    expandedStoryDirs,
    toggleSection,
    toggleStoryDirectory,
    triggerRevealPath,
    registerStoryNodeRef,
  };
}
