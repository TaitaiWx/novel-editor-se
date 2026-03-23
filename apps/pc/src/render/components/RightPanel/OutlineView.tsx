import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { computeLineDiff } from '@novel-editor/basic-algorithm';
import type {
  PersistedOutlineNodeInput,
  PersistedOutlineVersionRow,
} from '@/render/types/electron-api';
import styles from './styles.module.scss';
import { InlineDiffView } from '../InlineDiffView';
import type { OutlineEntry, OutlinePopoverAnchor, StorylineViewMode } from './types';
import { OUTLINE_POPOVER_HIDE_DELAY } from './constants';
import { useAiTitles } from './useAiTitles';
import { useAiSummaries } from './useAiSummaries';
import { OutlinePopover } from './OutlinePopover';
import { OutlineEntryItem } from './OutlineEntryItem';
import {
  DEFAULT_OUTLINE_AI_OPTIONS,
  OUTLINE_AI_GRANULARITY_LABELS,
  OUTLINE_AI_STYLE_LABELS,
  type OutlineAiGenerationOptions,
  type OutlineAiGranularity,
  type OutlineAiStyle,
} from './outline-import';
import { useAiConfig } from './useAiConfig';
import { useOutlineEntries } from './useOutlineEntries';
import { useDialog } from '../Dialog';
import { parseStoryIdeaSnapshot } from './story-idea';

function buildDiffLine(title: string, content: string | undefined, level: number): string {
  const indent = '  '.repeat(Math.max(0, level - 1));
  const summary = (content || '').replace(/\s+/g, ' ').trim();
  return summary ? `${indent}- ${title} :: ${summary}` : `${indent}- ${title}`;
}

function serializeVersionTree(nodes: PersistedOutlineNodeInput[], level = 1): string[] {
  return nodes.flatMap((node) => [
    buildDiffLine(node.title, node.content, level),
    ...serializeVersionTree(node.children || [], level + 1),
  ]);
}

function parseVersionTree(version: PersistedOutlineVersionRow): PersistedOutlineNodeInput[] {
  try {
    const parsed = JSON.parse(version.tree_json) as PersistedOutlineNodeInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeCurrentEntries(entries: OutlineEntry[]): string {
  return entries.map((entry) => buildDiffLine(entry.text, entry.summary, entry.level)).join('\n');
}

function buildCompareLabel(name: string | null): string {
  return name ? `版本 ${name}` : '当前入库大纲';
}

function buildStoryIdeaTermsPreview(version: PersistedOutlineVersionRow): string[] {
  const snapshot = parseStoryIdeaSnapshot(version.story_idea_snapshot_json);
  if (!snapshot) return [];
  return [...snapshot.themeTerms, ...snapshot.conflictTerms, ...snapshot.twistTerms].slice(0, 9);
}

function buildStoryIdeaCardTitle(version: PersistedOutlineVersionRow): string {
  const snapshot = parseStoryIdeaSnapshot(version.story_idea_snapshot_json);
  const title = snapshot?.title.trim();
  if (title) return title;
  if (version.story_idea_card_id !== null) return `三签卡 #${version.story_idea_card_id}`;
  return '三签创意卡';
}

function jumpToStoryIdeaCard(cardId: number | null) {
  if (cardId === null) return;
  window.dispatchEvent(new CustomEvent('open-storyline-mode', { detail: { mode: 'ideas' } }));
  window.dispatchEvent(
    new CustomEvent('open-story-idea-card', {
      detail: { cardId, expandOptionalInputs: true },
    })
  );
}

export const OutlineView: React.FC<{
  mode: Extract<StorylineViewMode, 'catalog' | 'outline'>;
  content: string;
  folderPath: string | null;
  dbReady: boolean;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  onReplaceLineText?: (line: number, text: string) => void;
}> = React.memo(({ mode, content, folderPath, dbReady, onScrollToLine, onReplaceLineText }) => {
  const aiConfig = useAiConfig();
  const dialog = useDialog();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<OutlinePopoverAnchor | null>(null);
  const [visibleVersion, setVisibleVersion] = useState(0);
  const [appliedLines, setAppliedLines] = useState<Set<number>>(new Set());
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [compareBaseVersionId, setCompareBaseVersionId] = useState<number | null>(null);
  const [compareTargetVersionId, setCompareTargetVersionId] = useState<number | null>(null);
  const [highlightedStoryIdeaVersionId, setHighlightedStoryIdeaVersionId] = useState<number | null>(
    null
  );
  const [aiOutlineOptions, setAiOutlineOptions] = useState<OutlineAiGenerationOptions>(
    DEFAULT_OUTLINE_AI_OPTIONS
  );
  const [showAiPresetPanel, setShowAiPresetPanel] = useState(false);

  const entryNodeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const visibleLinesRef = useRef<Set<number>>(new Set());
  const hoverTimeoutRef = useRef<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const {
    liveEntries,
    persistedEntries,
    versions,
    hasPersistedOutline,
    loading,
    importing,
    statusMessage,
    importOutline,
    rebuildFromContent,
    clearPersisted,
    saveOutlineVersion,
    applyOutlineVersion,
    updateOutlineVersion,
    deleteOutlineVersion,
    generateAiOutline,
    reorderEntries,
  } = useOutlineEntries(folderPath, content, dbReady, aiConfig.ready);

  const isOutlineMode = mode === 'outline';
  const outlineEntries = isOutlineMode ? persistedEntries : liveEntries;

  const activeLine = useMemo(
    () => (activeIndex !== null ? (outlineEntries[activeIndex]?.line ?? null) : null),
    [activeIndex, outlineEntries]
  );
  const visibleLines = useMemo(() => new Set(visibleLinesRef.current), [visibleVersion]);

  // --- Extracted hooks (hooks 内部从 AiConfigContext 读取 aiReady，无需外部传参) ---
  const { aiTitles, aiStates, aiErrors, failedAiEntries, retryAiEntry, retryFailedEntries } =
    useAiTitles(content, outlineEntries, activeLine, visibleLines);

  const { aiSummaryTexts, aiSummaryStates, aiSummaryErrors, requestAiSummary, refreshSummary } =
    useAiSummaries(content, outlineEntries, visibleLines);

  const summaryHoverModeByLine = useMemo(() => {
    const modeMap: Record<number, 'card' | 'tooltip-only'> = {};
    outlineEntries.forEach((entry) => {
      const summaryState = aiSummaryStates[entry.line] || 'idle';
      modeMap[entry.line] = summaryState === 'error' ? 'tooltip-only' : 'card';
    });
    return modeMap;
  }, [outlineEntries, aiSummaryStates]);

  const hoveredEntry = useMemo(
    () => outlineEntries.find((item) => item.line === hoverAnchor?.line) || null,
    [outlineEntries, hoverAnchor]
  );

  // --- Hover delay management ---
  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const startHoverTimeout = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverAnchor(null);
    }, OUTLINE_POPOVER_HIDE_DELAY);
  }, [clearHoverTimeout]);

  const handleSelect = useCallback(
    (index: number, line: number, text: string) => {
      setActiveIndex(index);
      const targetEntry = outlineEntries[index];
      if (!targetEntry) {
        return;
      }
      const targetLine = targetEntry.source === 'database' ? (targetEntry.lineHint ?? 0) : line;
      if (targetLine > 0) {
        onScrollToLine?.(targetLine, targetEntry.anchorText || text);
      }
    },
    [onScrollToLine, outlineEntries]
  );

  const handleApplyTitle = useCallback(
    (line: number, title: string) => {
      onReplaceLineText?.(line, title);
      setAppliedLines((prev) => new Set(prev).add(line));
    },
    [onReplaceLineText]
  );

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    const from = dragIndexRef.current;
    const to = dragOverIndex;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (from !== null && to !== null && from !== to) {
      void reorderEntries(from, to);
    }
  }, [dragOverIndex, reorderEntries]);

  const handleEntryMouseEnter = useCallback(
    (entry: OutlineEntry, rect: DOMRect) => {
      clearHoverTimeout();
      if (entry.source !== 'database') {
        requestAiSummary(entry);
      }
      if (summaryHoverModeByLine[entry.line] !== 'card') {
        setHoverAnchor(null);
        return;
      }
      setHoverAnchor({ line: entry.line, rect });
    },
    [clearHoverTimeout, requestAiSummary, summaryHoverModeByLine]
  );

  useEffect(() => {
    if (!hoverAnchor) return;
    if (summaryHoverModeByLine[hoverAnchor.line] !== 'card') {
      setHoverAnchor(null);
    }
  }, [hoverAnchor, summaryHoverModeByLine]);

  // Reset hover anchor on content change
  useEffect(() => {
    setHoverAnchor(null);
    visibleLinesRef.current.clear();
    setVisibleVersion((v) => v + 1);
  }, [content]);

  // Visibility tracking via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        entries.forEach((ioEntry) => {
          const line = Number(ioEntry.target.getAttribute('data-line') || 0);
          if (!line) return;
          if (ioEntry.isIntersecting) {
            if (!visibleLinesRef.current.has(line)) {
              visibleLinesRef.current.add(line);
              changed = true;
            }
          } else if (visibleLinesRef.current.delete(line)) {
            changed = true;
          }
        });
        if (changed) setVisibleVersion((v) => v + 1);
      },
      { threshold: 0.15 }
    );

    outlineEntries.forEach((entry) => {
      const node = entryNodeRefs.current[entry.line];
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [outlineEntries]);

  const handleOpenAiSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }));
  }, []);

  const handleSaveVersion = useCallback(async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultName = `手工保存 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const name = await dialog.prompt('保存为大纲版本', '请输入版本名称', defaultName);
    if (!name?.trim()) return;
    const note = await dialog.prompt('版本备注', '可选：记录这次保存的原因或阶段', '');
    await saveOutlineVersion({
      name: name.trim(),
      note: note?.trim() || '',
      source: 'manual',
    });
  }, [dialog, saveOutlineVersion]);

  const handleApplyVersion = useCallback(
    async (versionId: number, name: string) => {
      const confirmed = await dialog.confirm('应用大纲版本', `确定将「${name}」应用为当前大纲吗？`);
      if (!confirmed) return;
      await applyOutlineVersion(versionId);
      const appliedVersion = versions.find((version) => version.id === versionId) || null;
      setHighlightedStoryIdeaVersionId(appliedVersion?.story_idea_card_id ? versionId : null);
    },
    [applyOutlineVersion, dialog, versions]
  );

  const handleEditVersion = useCallback(
    async (versionId: number, currentName: string, currentNote: string) => {
      const nextName = await dialog.prompt('重命名大纲版本', '请输入版本名称', currentName);
      if (nextName === null) return;

      const trimmedName = nextName.trim();
      if (!trimmedName) return;

      const nextNote = await dialog.prompt(
        '编辑版本备注',
        '可选：记录这个版本的上下文',
        currentNote
      );
      if (nextNote === null) return;

      await updateOutlineVersion(versionId, {
        name: trimmedName,
        note: nextNote.trim(),
      });
    },
    [dialog, updateOutlineVersion]
  );

  const handleDeleteVersion = useCallback(
    async (versionId: number, name: string) => {
      const confirmed = await dialog.confirm(
        '删除大纲版本',
        `确定删除「${name}」吗？此操作不可撤销。`
      );
      if (!confirmed) return;
      await deleteOutlineVersion(versionId);
    },
    [deleteOutlineVersion, dialog]
  );

  const handleGenerateAiOutline = useCallback(async () => {
    await generateAiOutline(aiOutlineOptions);
  }, [aiOutlineOptions, generateAiOutline]);

  const handleSetCompareBase = useCallback((versionId: number | null) => {
    setCompareBaseVersionId((current) => (current === versionId ? null : versionId));
  }, []);

  const handleSetCompareTarget = useCallback((versionId: number) => {
    setCompareTargetVersionId((current) => (current === versionId ? null : versionId));
  }, []);

  const sourceLabels = useMemo(
    () => ({ import: '导入', rebuild: '重建', ai: 'AI', manual: '手工' }),
    []
  );

  const aiOptionsLabel = useMemo(
    () =>
      `${OUTLINE_AI_STYLE_LABELS[aiOutlineOptions.style]} / ${OUTLINE_AI_GRANULARITY_LABELS[aiOutlineOptions.granularity]} / ${aiOutlineOptions.maxDepth} 层`,
    [aiOutlineOptions]
  );

  const aiPresets = useMemo(
    () => [
      {
        key: 'balanced',
        label: '均衡成章',
        description: '稳定章节骨架，适合先拿到可写主线。',
        value: {
          style: 'balanced',
          granularity: 'medium',
          maxDepth: 3,
        } as OutlineAiGenerationOptions,
      },
      {
        key: 'cinematic',
        label: '影视拆场',
        description: '突出节拍和场景推进，适合镜头化思考。',
        value: {
          style: 'cinematic',
          granularity: 'fine',
          maxDepth: 4,
        } as OutlineAiGenerationOptions,
      },
      {
        key: 'detailed',
        label: '细纲推进',
        description: '优先拿到可直接展开写作的细颗粒度节点。',
        value: {
          style: 'detailed',
          granularity: 'fine',
          maxDepth: 4,
        } as OutlineAiGenerationOptions,
      },
      {
        key: 'suspense',
        label: '悬疑钩子',
        description: '强化钩子、揭示和反转节奏。',
        value: {
          style: 'suspense',
          granularity: 'medium',
          maxDepth: 3,
        } as OutlineAiGenerationOptions,
      },
    ],
    []
  );

  const compareBaseVersion = useMemo(
    () => versions.find((version) => version.id === compareBaseVersionId) || null,
    [compareBaseVersionId, versions]
  );

  const compareTargetVersion = useMemo(
    () => versions.find((version) => version.id === compareTargetVersionId) || null,
    [compareTargetVersionId, versions]
  );

  const previewData = useMemo(() => {
    if (!compareTargetVersion) return null;
    const baseText = compareBaseVersion
      ? serializeVersionTree(parseVersionTree(compareBaseVersion)).join('\n')
      : serializeCurrentEntries(persistedEntries);
    const targetText = serializeVersionTree(parseVersionTree(compareTargetVersion)).join('\n');
    const diffLines = computeLineDiff(baseText.split('\n'), targetText.split('\n'));
    let adds = 0;
    let dels = 0;
    diffLines.forEach((line) => {
      if (line.type === 'add') adds += 1;
      if (line.type === 'del') dels += 1;
    });
    return {
      baseLabel: buildCompareLabel(compareBaseVersion?.name || null),
      targetLabel: buildCompareLabel(compareTargetVersion.name),
      baseText,
      targetText,
      adds,
      dels,
      targetVersion: compareTargetVersion,
      identical: baseText === targetText,
    };
  }, [compareBaseVersion, compareTargetVersion, persistedEntries]);

  useEffect(() => {
    if (
      compareBaseVersionId !== null &&
      !versions.some((version) => version.id === compareBaseVersionId)
    ) {
      setCompareBaseVersionId(null);
    }
    if (
      compareTargetVersionId !== null &&
      !versions.some((version) => version.id === compareTargetVersionId)
    ) {
      setCompareTargetVersionId(null);
    }
  }, [compareBaseVersionId, compareTargetVersionId, versions]);

  const renderVersions = useCallback(
    () => (
      <div className={styles.outlineVersionsPanel}>
        <div className={styles.outlineVersionsHeader}>
          <span className={styles.outlineVersionsTitle}>大纲版本中心</span>
          <span className={styles.outlineVersionsCount}>{versions.length} 个版本</span>
        </div>
        {versions.length === 0 ? (
          <div className={styles.outlineVersionsEmpty}>暂未保存任何大纲版本</div>
        ) : (
          <div className={styles.outlineVersionsList}>
            {versions.map((version) => (
              <div
                key={version.id}
                className={`${styles.outlineVersionCard} ${highlightedStoryIdeaVersionId === version.id ? styles.outlineVersionCardHighlighted : ''}`}
              >
                <div className={styles.outlineVersionMain}>
                  <div className={styles.outlineVersionName}>{version.name}</div>
                  <div className={styles.outlineVersionMeta}>
                    <span className={styles.outlineVersionBadge}>
                      {sourceLabels[version.source]}
                    </span>
                    {version.story_idea_card_id !== null && (
                      <span className={styles.outlineVersionTraceBadge}>来自三签法</span>
                    )}
                    <span>{version.total_nodes} 节点</span>
                    <span>{new Date(version.created_at).toLocaleString()}</span>
                  </div>
                  {version.story_idea_card_id !== null && (
                    <div className={styles.outlineVersionTraceTitleRow}>
                      <span className={styles.outlineVersionTraceTitleLabel}>三签卡</span>
                      <span className={styles.outlineVersionTraceTitle}>
                        {buildStoryIdeaCardTitle(version)}
                      </span>
                    </div>
                  )}
                  {buildStoryIdeaTermsPreview(version).length > 0 && (
                    <div className={styles.outlineVersionTraceTerms}>
                      {buildStoryIdeaTermsPreview(version).map((term) => (
                        <span
                          key={`${version.id}-${term}`}
                          className={`${styles.outlineVersionTraceChip} ${highlightedStoryIdeaVersionId === version.id ? styles.outlineVersionTraceChipHighlighted : ''}`}
                        >
                          {term}
                        </span>
                      ))}
                    </div>
                  )}
                  {version.note?.trim() && (
                    <div className={styles.outlineVersionNote}>{version.note}</div>
                  )}
                </div>
                <div className={styles.outlineVersionActions}>
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => handleSetCompareBase(version.id)}
                    disabled={importing}
                  >
                    {compareBaseVersionId === version.id ? '取消 A' : '设为 A'}
                  </button>
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => handleSetCompareTarget(version.id)}
                    disabled={importing}
                  >
                    {compareTargetVersionId === version.id ? '取消 B' : '设为 B'}
                  </button>
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() =>
                      void handleEditVersion(version.id, version.name, version.note || '')
                    }
                    disabled={importing}
                  >
                    编辑
                  </button>
                  {version.story_idea_card_id !== null && (
                    <button
                      className={styles.outlineSecondaryButton}
                      onClick={() => jumpToStoryIdeaCard(version.story_idea_card_id)}
                      disabled={importing}
                    >
                      跳回三签
                    </button>
                  )}
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => void handleApplyVersion(version.id, version.name)}
                    disabled={importing}
                  >
                    应用
                  </button>
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => void handleDeleteVersion(version.id, version.name)}
                    disabled={importing}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {previewData && (
          <div className={styles.outlineVersionPreviewPanel}>
            <div className={styles.outlineVersionPreviewHeader}>
              <div>
                <div className={styles.outlineVersionPreviewTitle}>
                  {previewData.baseLabel} vs {previewData.targetLabel}
                </div>
                <div className={styles.outlineVersionPreviewMeta}>
                  <span>+{previewData.adds}</span>
                  <span>-{previewData.dels}</span>
                  <span>{previewData.targetVersion.total_nodes} 节点</span>
                </div>
              </div>
              <button
                className={styles.outlineSecondaryButton}
                onClick={() => handleSetCompareBase(null)}
                disabled={importing}
              >
                与当前对比
              </button>
            </div>
            {previewData.identical ? (
              <div className={styles.outlineVersionPreviewEmpty}>所选版本与当前入库大纲一致</div>
            ) : (
              <InlineDiffView
                original={previewData.baseText}
                modified={previewData.targetText}
                title="版本预览差异"
                explanation="支持当前入库大纲与版本对比，也支持版本 A 与版本 B 直接比较"
                contextLines={1}
              />
            )}
          </div>
        )}
      </div>
    ),
    [
      handleApplyVersion,
      handleDeleteVersion,
      handleEditVersion,
      handleSetCompareBase,
      handleSetCompareTarget,
      importing,
      compareBaseVersionId,
      compareTargetVersionId,
      previewData,
      sourceLabels,
      versions,
    ]
  );

  const renderAiPresetPanel = useCallback(
    () => (
      <div className={styles.outlineAiPresetPanel}>
        <div className={styles.outlineAiPresetHeader}>
          <span className={styles.outlineAiPresetTitle}>AI 生成预设</span>
          <span className={styles.outlineAiPresetMeta}>{aiOptionsLabel}</span>
        </div>
        <div className={styles.outlineAiPresetGrid}>
          {aiPresets.map((preset) => {
            const active =
              aiOutlineOptions.style === preset.value.style &&
              aiOutlineOptions.granularity === preset.value.granularity &&
              aiOutlineOptions.maxDepth === preset.value.maxDepth;
            return (
              <button
                key={preset.key}
                className={`${styles.outlineAiPresetCard} ${active ? styles.outlineAiPresetCardActive : ''}`}
                onClick={() => setAiOutlineOptions(preset.value)}
                disabled={importing}
              >
                <span className={styles.outlineAiPresetCardTitle}>{preset.label}</span>
                <span className={styles.outlineAiPresetCardDesc}>{preset.description}</span>
                <span className={styles.outlineAiPresetCardMeta}>
                  {OUTLINE_AI_STYLE_LABELS[preset.value.style]} /{' '}
                  {OUTLINE_AI_GRANULARITY_LABELS[preset.value.granularity]} /{' '}
                  {preset.value.maxDepth} 层
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.outlineAiPresetControls}>
          <div className={styles.outlineAiPresetGroup}>
            <span className={styles.outlineAiPresetGroupLabel}>风格</span>
            {(['balanced', 'cinematic', 'detailed', 'suspense'] as OutlineAiStyle[]).map(
              (style) => (
                <button
                  key={style}
                  className={`${styles.outlineAiPresetOption} ${aiOutlineOptions.style === style ? styles.outlineAiPresetOptionActive : ''}`}
                  onClick={() => setAiOutlineOptions((prev) => ({ ...prev, style }))}
                  disabled={importing}
                >
                  {OUTLINE_AI_STYLE_LABELS[style]}
                </button>
              )
            )}
          </div>
          <div className={styles.outlineAiPresetGroup}>
            <span className={styles.outlineAiPresetGroupLabel}>粒度</span>
            {(['coarse', 'medium', 'fine'] as OutlineAiGranularity[]).map((granularity) => (
              <button
                key={granularity}
                className={`${styles.outlineAiPresetOption} ${aiOutlineOptions.granularity === granularity ? styles.outlineAiPresetOptionActive : ''}`}
                onClick={() => setAiOutlineOptions((prev) => ({ ...prev, granularity }))}
                disabled={importing}
              >
                {OUTLINE_AI_GRANULARITY_LABELS[granularity]}
              </button>
            ))}
          </div>
          <div className={styles.outlineAiPresetGroup}>
            <span className={styles.outlineAiPresetGroupLabel}>层级深度</span>
            {[1, 2, 3, 4].map((depth) => (
              <button
                key={depth}
                className={`${styles.outlineAiPresetOption} ${aiOutlineOptions.maxDepth === depth ? styles.outlineAiPresetOptionActive : ''}`}
                onClick={() => setAiOutlineOptions((prev) => ({ ...prev, maxDepth: depth }))}
                disabled={importing}
              >
                {depth} 层
              </button>
            ))}
          </div>
        </div>
      </div>
    ),
    [aiOptionsLabel, aiOutlineOptions, aiPresets, importing]
  );

  if (!content) {
    return <div className={styles.emptyHint}>打开文件后查看{isOutlineMode ? '大纲' : '目录'}</div>;
  }

  if (outlineEntries.length === 0) {
    if (isOutlineMode) {
      return (
        <div className={styles.emptyHint}>
          暂无入库大纲
          <br />
          <span className={styles.hintSub}>
            可使用「导入大纲」「AI 生成大纲」或「从正文重建」生成大纲库
          </span>
          <div className={styles.outlineToolbar} style={{ marginTop: 10 }}>
            <button
              className={styles.outlineActionButton}
              onClick={importOutline}
              disabled={!folderPath || !dbReady || importing}
            >
              导入大纲
            </button>
            <button
              className={styles.outlineActionButton}
              onClick={() => void handleGenerateAiOutline()}
              disabled={!folderPath || !dbReady || importing || !content.trim() || !aiConfig.ready}
            >
              AI 生成大纲
            </button>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => setShowAiPresetPanel((current) => !current)}
              disabled={importing || !aiConfig.ready}
            >
              {showAiPresetPanel ? '收起预设' : 'AI 预设'}
            </button>
            <button
              className={styles.outlineSecondaryButton}
              onClick={handleSaveVersion}
              disabled={!hasPersistedOutline || importing}
            >
              保存为大纲版本
            </button>
            <button
              className={styles.outlineActionButton}
              onClick={rebuildFromContent}
              disabled={!folderPath || !dbReady || importing || !content.trim()}
            >
              从正文重建
            </button>
          </div>
          {showAiPresetPanel && aiConfig.ready && renderAiPresetPanel()}
          {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}
          {versions.length > 0 && renderVersions()}
        </div>
      );
    }
    return (
      <div className={styles.emptyHint}>
        未检测到标题结构
        <br />
        <span className={styles.hintSub}>支持 Markdown 标题、中文章节标记、数字编号等格式</span>
      </div>
    );
  }

  const totalWords = outlineEntries.reduce((sum, e) => sum + e.wordCount, 0);
  const completedCount = outlineEntries.filter(
    (e) => e.needsAiTitle && aiTitles[e.line]?.trim()
  ).length;
  const needsAiCount = outlineEntries.filter((e) => e.needsAiTitle).length;

  // 纯数据驱动: 有已完成/加载中/失败的 AI 条目即视为活跃
  const hasAiData =
    completedCount > 0 ||
    failedAiEntries.length > 0 ||
    outlineEntries.some((e) => aiStates[e.line] === 'loading');

  return (
    <div className={styles.outlineTree}>
      <div className={styles.outlineStatsBar}>
        <span className={styles.outlineStatChip}>{outlineEntries.length} 章</span>
        <span className={styles.outlineStatChip}>
          {totalWords >= 10000
            ? `${(totalWords / 10000).toFixed(1)} 万字`
            : `${totalWords.toLocaleString()} 字`}
        </span>
        {needsAiCount > 0 && hasAiData && (
          <span className={styles.outlineStatChip}>
            AI {completedCount}/{needsAiCount}
          </span>
        )}
        {isOutlineMode && aiConfig.ready && (
          <span className={styles.outlineStatChip}>AI 生成：{aiOptionsLabel}</span>
        )}
        {isOutlineMode && hasPersistedOutline && (
          <span className={styles.outlineImportChip}>已入库大纲</span>
        )}
        {!isOutlineMode && hasPersistedOutline && (
          <span className={styles.outlineImportChip}>目录（实时）</span>
        )}
        {loading && <span className={styles.outlineLoadingChip}>加载中...</span>}
        {importing && <span className={styles.outlineLoadingChip}>处理中...</span>}
        {aiConfig.loaded && !aiConfig.ready && (
          <span
            className={styles.outlineAiHintChip}
            onClick={handleOpenAiSettings}
            title="配置 AI 功能"
          >
            开启 AI
          </span>
        )}
      </div>
      {!isOutlineMode && failedAiEntries.length > 0 && (
        <div className={styles.outlineToolbar}>
          <button className={styles.outlineRetryAllButton} onClick={retryFailedEntries}>
            重试失败项 ({failedAiEntries.length})
          </button>
        </div>
      )}
      {isOutlineMode && (
        <div className={styles.outlineToolbar}>
          <button
            className={styles.outlineActionButton}
            onClick={importOutline}
            disabled={!folderPath || !dbReady || importing}
          >
            导入大纲
          </button>
          <button
            className={styles.outlineActionButton}
            onClick={rebuildFromContent}
            disabled={!folderPath || !dbReady || importing || !content.trim()}
          >
            从正文重建
          </button>
          <button
            className={styles.outlineActionButton}
            onClick={() => void handleGenerateAiOutline()}
            disabled={!folderPath || !dbReady || importing || !content.trim() || !aiConfig.ready}
          >
            AI 生成大纲
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => setShowAiPresetPanel((current) => !current)}
            disabled={importing || !aiConfig.ready}
          >
            {showAiPresetPanel ? '收起预设' : 'AI 预设'}
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => void handleSaveVersion()}
            disabled={!hasPersistedOutline || importing}
          >
            保存为大纲版本
          </button>
          {hasPersistedOutline && (
            <button
              className={styles.outlineSecondaryButton}
              onClick={clearPersisted}
              disabled={importing}
            >
              清空入库
            </button>
          )}
        </div>
      )}
      {isOutlineMode && showAiPresetPanel && aiConfig.ready && renderAiPresetPanel()}
      {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}
      {isOutlineMode && renderVersions()}
      {outlineEntries.map((entry, i) => (
        <OutlineEntryItem
          key={entry.cacheKey}
          entry={entry}
          index={i}
          isLast={i === outlineEntries.length - 1}
          isActive={activeIndex === i}
          aiTitle={aiTitles[entry.line]?.trim() || ''}
          aiState={aiStates[entry.line] || 'idle'}
          aiError={aiErrors[entry.line]}
          summaryState={
            entry.source === 'database' ? 'idle' : aiSummaryStates[entry.line] || 'idle'
          }
          summaryText={
            entry.source === 'database'
              ? entry.summary
              : aiSummaryStates[entry.line] === 'error'
                ? aiSummaryErrors[entry.line]?.trim() || ''
                : aiSummaryTexts[entry.line]?.trim() || ''
          }
          summaryError={aiSummaryErrors[entry.line]?.trim() || ''}
          isApplied={appliedLines.has(entry.line)}
          canReplaceText={!!onReplaceLineText}
          draggable={isOutlineMode && hasPersistedOutline}
          isDragOver={dragOverIndex === i}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onSelect={handleSelect}
          onRetryTitle={retryAiEntry}
          onApplyTitle={handleApplyTitle}
          onRefreshSummary={refreshSummary}
          onMouseEnter={handleEntryMouseEnter}
          onMouseLeave={startHoverTimeout}
          entryRef={(node) => {
            entryNodeRefs.current[entry.line] = node;
          }}
        />
      ))}

      {/* Popover for detailed view on hover */}
      <OutlinePopover
        anchor={hoverAnchor}
        entry={hoveredEntry}
        aiTitle={hoveredEntry ? aiTitles[hoveredEntry.line]?.trim() || '' : ''}
        summaryText={
          hoveredEntry
            ? hoveredEntry.source === 'database'
              ? hoveredEntry.summary || ''
              : (aiSummaryTexts[hoveredEntry.line]?.trim()
                  ? aiSummaryTexts[hoveredEntry.line]
                  : hoveredEntry.summary) || ''
            : ''
        }
        summaryState={
          hoveredEntry
            ? hoveredEntry.source === 'database'
              ? 'idle'
              : aiSummaryTexts[hoveredEntry.line]?.trim()
                ? 'success'
                : aiSummaryStates[hoveredEntry.line] || 'idle'
            : 'idle'
        }
        summaryError={hoveredEntry ? aiSummaryErrors[hoveredEntry.line] : undefined}
        onRefreshSummary={refreshSummary}
        onClearTimeout={clearHoverTimeout}
        onStartTimeout={startHoverTimeout}
      />
    </div>
  );
});
