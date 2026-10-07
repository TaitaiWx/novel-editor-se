import React, { useCallback, useMemo, useState } from 'react';
import {
  applyVolumePlanOverlay,
  charactersInChapter,
  computeChapterTension,
  computeCharacterLanes,
  deriveVolumeOutline,
  describeTensionCurve,
  findForeshadowing,
  hasActMarkers,
  type VolumeBeat,
  type VolumeStructureId,
  type VolumeChapterPlan,
} from '@novel-editor/basic-algorithm';
import type { PersistedOutlineScopeInput } from '@/render/types/electron-api';
import { useAiConfig } from '../useAiConfig';
import { OutlineList, type OutlineListHandlers } from './OutlineList';
import { CharacterLanesView, ForeshadowView, TensionView } from './DerivedViews';
import { PlanToolbar } from './PlanToolbar';
import { VolumeOverview, buildActSegments, countWords, formatWordCount } from './VolumeOverview';
import { CURRENT_DOCUMENT_PATH, useVolumeSources } from './useVolumeSources';
import { useVolumePlanState } from './useVolumePlanState';
import { describeVariant, useVolumePlanGenerate } from './useVolumePlanGenerate';
import PlanVariantPicker from '../PlanVariants';
import { insertBeatIntoChapterOutline } from './volumeSources';
import { requestOpenSceneVideo } from '../../SceneVideoView/events';
import { EMPTY_VOLUME_PLAN, mergeBeatOrder, resolveVolumeTarget } from './volumePlanState';
import styles from './styles.module.scss';

export type VolumePlanMode = 'list' | 'tension' | 'lanes' | 'foreshadow';

export const VOLUME_PLAN_MODES: ReadonlyArray<{ mode: VolumePlanMode; label: string }> = [
  { mode: 'list', label: '列表' },
  { mode: 'tension', label: '节奏' },
  { mode: 'lanes', label: '人物线' },
  { mode: 'foreshadow', label: '伏笔' },
];

export interface VolumePlanViewProps {
  content: string;
  /** 当前作品目录（作品级数据与章纲按它读写） */
  folderPath: string | null;
  dbReady: boolean;
  scope?: PersistedOutlineScopeInput | null;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  /** 打开其他章节并定位到行 */
  onOpenSourceLocation?: (filePath: string, line: number, contentKey?: string) => void;
}

/**
 * 卷纲：零输入——从本卷章节自动推导 幕 → 章 → 关键节拍；
 * 可选一句「这一卷想写什么」+「生成卷纲」；列表 / 节奏 / 人物线 / 伏笔 都由同一份数据派生
 */
export const VolumePlanView: React.FC<VolumePlanViewProps> = React.memo(
  ({ content, folderPath, dbReady, scope = null, onScrollToLine, onOpenSourceLocation }) => {
    const aiConfig = useAiConfig();
    const [mode, setMode] = useState<VolumePlanMode>('list');
    const [status, setStatus] = useState('');
    const target = useMemo(() => resolveVolumeTarget(scope, folderPath), [folderPath, scope]);
    const { chapters, characters, loading, reload } = useVolumeSources({
      target,
      workPath: folderPath,
      dbReady,
      content,
    });

    const markerOutline = useMemo(
      () =>
        chapters.length > 0 && hasActMarkers(chapters)
          ? deriveVolumeOutline(chapters, { structure: 'markers' })
          : null,
      [chapters]
    );
    const { state, update } = useVolumePlanState({
      volumePath: target?.volumePath ?? null,
      workPath: folderPath,
      markerOutline,
    });
    const baseOutline = useMemo(
      () => deriveVolumeOutline(chapters, { structure: state.structure }),
      [chapters, state.structure]
    );
    const outline = useMemo(() => applyVolumePlanOverlay(baseOutline, state), [baseOutline, state]);
    const lanes = useMemo(
      () => computeCharacterLanes(chapters, characters),
      [chapters, characters]
    );
    const charactersByChapter = useMemo(
      () =>
        new Map(
          chapters.map((chapter, index) => [chapter.path, charactersInChapter(lanes, index)])
        ),
      [chapters, lanes]
    );
    const tension = useMemo(
      () => (mode === 'tension' ? computeChapterTension(chapters) : []),
      [chapters, mode]
    );
    const foreshadow = useMemo(
      () => (mode === 'foreshadow' ? findForeshadowing(chapters) : []),
      [chapters, mode]
    );
    const laneNames = useMemo(() => lanes.map((lane) => lane.name), [lanes]);
    const wordsByChapter = useMemo(
      () => new Map(chapters.map((chapter) => [chapter.path, countWords(chapter.content)])),
      [chapters]
    );
    const totalWords = useMemo(
      () => Array.from(wordsByChapter.values()).reduce((sum, count) => sum + count, 0),
      [wordsByChapter]
    );
    const segments = useMemo(
      () => buildActSegments(outline, wordsByChapter),
      [outline, wordsByChapter]
    );
    const listRef = React.useRef<HTMLDivElement>(null);
    const jumpToAct = useCallback((actKey: string) => {
      const target = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>('[data-act-key]') ?? []
      ).find((element) => element.dataset.actKey === actKey);
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, []);

    const variantsApi = useVolumePlanGenerate({
      chapters,
      currentStructure: baseOutline.structure,
      hasMarkers: baseOutline.hasMarkers,
      intent: state.intent,
      characters: laneNames,
      aiReady: aiConfig.ready,
      update,
    });
    const { generate, generating } = variantsApi;

    const activePath = target?.activePath ?? null;
    const handleOpenChapter = useCallback(
      (path: string, line?: number, anchor?: string) => {
        if (path === activePath || path === CURRENT_DOCUMENT_PATH) {
          if (line) onScrollToLine?.(line, anchor);
          return;
        }
        onOpenSourceLocation?.(path, line ?? 1, anchor);
      },
      [activePath, onOpenSourceLocation, onScrollToLine]
    );

    const canInsert = Boolean(folderPath && dbReady && target);
    const handleInsertBeat = useCallback(
      async (chapter: VolumeChapterPlan, beat: VolumeBeat) => {
        const ipc = window.electron?.ipcRenderer;
        if (!ipc || !folderPath) return;
        try {
          const result = await insertBeatIntoChapterOutline(ipc, folderPath, chapter.path, {
            title: beat.title || beat.text,
            content: beat.title ? beat.text : '',
            anchorText: beat.title || undefined,
            lineHint: beat.line ?? null,
          });
          setStatus(
            result === 'inserted'
              ? `已插入「${chapter.title}」的章纲`
              : `「${chapter.title}」的章纲里已有这一条`
          );
          if (result === 'inserted') reload();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : '插入章纲失败');
        }
      },
      [folderPath, reload]
    );

    const handlers = useMemo<OutlineListHandlers>(
      () => ({
        onEditBeat: (key, text) =>
          update((prev) => ({ ...prev, beatEdits: { ...prev.beatEdits, [key]: text } })),
        onEditActNote: (actKey, text) =>
          update((prev) => ({ ...prev, actNotes: { ...prev.actNotes, [actKey]: text } })),
        onReorderBeat: (chapterPath, segmentKeys, from, to) =>
          update((prev) => {
            const order = mergeBeatOrder(prev.beatOrder[chapterPath], segmentKeys, from, to);
            return order
              ? { ...prev, beatOrder: { ...prev.beatOrder, [chapterPath]: order } }
              : prev;
          }),
        onInsertBeat: canInsert
          ? (chapter, beat) => void handleInsertBeat(chapter, beat)
          : undefined,
        onOpenChapter: handleOpenChapter,
        onSceneVideo: (chapter, beat) => {
          const chapterPath = chapter.path === CURRENT_DOCUMENT_PATH ? undefined : chapter.path;
          requestOpenSceneVideo({ chapterPath, scene: beat.title || undefined, line: beat.line });
        },
      }),
      [canInsert, handleInsertBeat, handleOpenChapter, update]
    );

    const hasOverrides =
      Object.keys(state.beatEdits).length > 0 || Object.keys(state.beatOrder).length > 0;
    const hasGenerated =
      Object.keys(state.actNotes).length > 0 || Object.keys(state.suggestions).length > 0;

    if (!target && !content.trim()) {
      return <div className={styles.viewEmpty}>打开一章后，这里会自动整理出本卷的卷纲</div>;
    }

    return (
      <div className={styles.volumePlan}>
        <div className={styles.head}>
          <span className={styles.volumeName}>{target?.label ?? '当前文档'}</span>
          <span className={styles.volumeMeta}>
            {loading && chapters.length === 0
              ? '读取中…'
              : [
                  `${outline.acts.length} 段`,
                  `${outline.chapterCount} 章`,
                  totalWords > 0 ? `${formatWordCount(totalWords)} 字` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
        </div>

        <form
          className={styles.intentRow}
          onSubmit={(event) => {
            event.preventDefault();
            void generate().then(setStatus);
          }}
        >
          <input
            className={styles.intentInput}
            value={state.intent}
            placeholder="这一卷想写什么？（可不填）"
            aria-label="这一卷想写什么"
            onChange={(event) => {
              const intent = event.target.value;
              update((prev) => ({ ...prev, intent }));
            }}
          />
          <button type="submit" className={styles.primaryButton} disabled={generating}>
            {generating ? '生成中…' : '生成卷纲'}
          </button>
        </form>

        {variantsApi.variants.length > 0 && (
          <PlanVariantPicker
            heading="选一个卷纲方案"
            variants={variantsApi.variants.map((variant) => ({
              id: variant.structure,
              title: variant.label,
              subtitle: `${variant.by === 'ai' ? 'AI' : '模板'} · ${variant.outline.acts.length} 段`,
              lines: describeVariant(variant),
            }))}
            onApply={(id) => {
              setMode('list');
              setStatus(variantsApi.apply(id as VolumeStructureId));
            }}
            onDismiss={variantsApi.dismiss}
          />
        )}

        <div className={styles.modeSwitch} role="tablist" aria-label="卷纲视图">
          {VOLUME_PLAN_MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              role="tab"
              aria-selected={mode === item.mode}
              className={mode === item.mode ? styles.modeActive : undefined}
              onClick={() => setMode(item.mode)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {status && (
          <div className={styles.status} role="status">
            {status}
          </div>
        )}

        {mode === 'list' && (
          <>
            <PlanToolbar
              structure={outline.structure}
              hasMarkers={baseOutline.hasMarkers}
              onSelectStructure={(structure) => update((prev) => ({ ...prev, structure }))}
              moreContent={
                <>
                  {!aiConfig.ready && (
                    <p>未开启 AI：「生成卷纲」按结构模板给出每段说明与空白章节的建议。</p>
                  )}
                  {state.generatedBy && (
                    <p>
                      上次由{state.generatedBy === 'ai' ? ' AI ' : '结构模板'}生成
                      {state.generatedAt
                        ? `（${new Date(state.generatedAt).toLocaleString()}）`
                        : ''}
                    </p>
                  )}
                  <div className={styles.moreActions}>
                    <button
                      type="button"
                      disabled={!hasGenerated}
                      onClick={() =>
                        update((prev) => ({
                          ...prev,
                          actNotes: {},
                          suggestions: {},
                          generatedBy: null,
                          generatedAt: null,
                        }))
                      }
                    >
                      清除生成的说明与建议
                    </button>
                    <button
                      type="button"
                      disabled={!hasOverrides}
                      onClick={() => update((prev) => ({ ...prev, beatEdits: {}, beatOrder: {} }))}
                    >
                      撤销所有改写与排序
                    </button>
                    <button
                      type="button"
                      disabled={state.structure === null}
                      onClick={() =>
                        update((prev) => ({ ...prev, structure: EMPTY_VOLUME_PLAN.structure }))
                      }
                    >
                      恢复自动结构
                    </button>
                  </div>
                </>
              }
            />
            <VolumeOverview segments={segments} onJump={jumpToAct} />
            {outline.chapterCount === 0 && !loading && (
              <div className={styles.viewSummary}>本卷还没有章节，可以先按下面的结构动笔</div>
            )}
            <div ref={listRef}>
              <OutlineList
                outline={outline}
                charactersByChapter={charactersByChapter}
                wordsByChapter={wordsByChapter}
                handlers={handlers}
              />
            </div>
          </>
        )}
        {mode === 'tension' && (
          <TensionView
            tension={tension}
            notes={describeTensionCurve(tension)}
            onOpenChapter={handleOpenChapter}
          />
        )}
        {mode === 'lanes' && (
          <CharacterLanesView lanes={lanes} chapters={chapters} onOpenChapter={handleOpenChapter} />
        )}
        {mode === 'foreshadow' && (
          <ForeshadowView items={foreshadow} onOpenChapter={handleOpenChapter} />
        )}
      </div>
    );
  }
);
