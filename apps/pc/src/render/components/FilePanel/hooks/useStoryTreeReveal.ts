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
}: UseStoryTreeRevealOptions) {
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<CollapsedSections>({
    story: false,
    characters: false,
    lore: false,
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

  useEffect(() => {
    if (!characterGenerationStatus) return;
    const signature = [
      characterGenerationStatus.scopePath,
      characterGenerationStatus.state,
      characterGenerationStatus.startedAt,
      characterGenerationStatus.finishedAt || '',
    ].join(':');
    const previousSignature = lastCharacterStatusSignatureRef.current;
    lastCharacterStatusSignatureRef.current = signature;

    const shouldReveal =
      characterGenerationStatus.state === 'running' ||
      (previousSignature !== null && previousSignature !== signature);
    if (!shouldReveal) return;

    setCollapsedSections((prev) => (prev.characters ? { ...prev, characters: false } : prev));
  }, [
    characterGenerationStatus?.scopePath,
    characterGenerationStatus?.startedAt,
    characterGenerationStatus?.finishedAt,
    characterGenerationStatus?.state,
  ]);

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
    setCollapsedSections((prev) => (prev.story ? { ...prev, story: false } : prev));
    setExpandedStoryDirs((prev) => {
      const next = new Set(prev);
      findAncestorPaths(storyDisplayNodes, revealFileRequest.path).forEach((path) =>
        next.add(path)
      );
      return next;
    });
    triggerRevealPath(revealFileRequest.path);
    // closeSearch 为稳定回调（useCallback 空依赖），无需加入依赖
  }, [revealFileRequest?.id, revealFileRequest?.path, storyDisplayNodes, triggerRevealPath]);

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
