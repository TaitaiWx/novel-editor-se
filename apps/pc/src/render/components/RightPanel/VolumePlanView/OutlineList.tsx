import React, { useCallback, useRef, useState } from 'react';
import { VscDeviceCameraVideo, VscGripper, VscInsert } from 'react-icons/vsc';
import type {
  VolumeActPlan,
  VolumeBeat,
  VolumeChapterPlan,
  VolumeOutline,
} from '@novel-editor/basic-algorithm';
import InlineRenameInput from '../../InlineRenameInput';
import Tooltip from '../../Tooltip';
import { formatWordCount } from './VolumeOverview';
import styles from './styles.module.scss';

const BEAT_SOURCE_LABELS: Record<VolumeBeat['source'], string> = {
  scene: '场景',
  outline: '章纲',
  heading: '小标题',
  opening: '开篇',
  suggestion: '建议',
};

/** 节拍行图标按钮的悬停说明（所有图标都必须有 tooltip） */
export const BEAT_ACTION_TIPS = {
  insert: '加入本章章纲：把这一条写进章纲，作为本章要写的内容',
  video: '场景视频：把这一场做成分镜与视频',
} as const;

export interface OutlineListHandlers {
  onEditBeat: (key: string, text: string) => void;
  onEditActNote: (actKey: string, text: string) => void;
  onReorderBeat: (chapterPath: string, segmentKeys: string[], from: string, to: string) => void;
  onInsertBeat?: (chapter: VolumeChapterPlan, beat: VolumeBeat) => void;
  /** 场景条目「生成场景视频」：打开场景视频工作区 */
  onSceneVideo?: (chapter: VolumeChapterPlan, beat: VolumeBeat) => void;
  onOpenChapter: (path: string, line?: number, anchor?: string) => void;
}

interface EditableTextProps {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  onCommit: (value: string) => void;
}

/** 点击文字就地编辑（Enter / 失焦提交，Esc 取消） */
const EditableText: React.FC<EditableTextProps> = ({
  value,
  placeholder,
  ariaLabel,
  className,
  onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (editing) {
    return (
      <InlineRenameInput
        initialValue={value}
        ariaLabel={ariaLabel}
        className={styles.inlineInput}
        restoreFocusRef={buttonRef}
        onCommit={(next) => {
          setEditing(false);
          onCommit(next);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`${styles.editableText} ${value ? '' : styles.placeholder} ${className ?? ''}`}
      title="点击编辑"
      aria-label={ariaLabel}
      onClick={() => setEditing(true)}
    >
      {value || placeholder}
    </button>
  );
};

const BeatRow: React.FC<{
  chapter: VolumeChapterPlan;
  beat: VolumeBeat;
  segmentKeys: string[];
  dragKey: string | null;
  setDragKey: (key: string | null) => void;
  handlers: OutlineListHandlers;
}> = ({ chapter, beat, segmentKeys, dragKey, setDragKey, handlers }) => {
  const [dropTarget, setDropTarget] = useState(false);
  const draggable = segmentKeys.length > 1;
  return (
    <li
      className={`${styles.beat} ${dropTarget ? styles.beatDropTarget : ''} ${
        beat.source === 'suggestion' ? styles.beatSuggestion : ''
      }`}
      data-beat-key={beat.key}
      onDragOver={(event) => {
        if (!dragKey || dragKey === beat.key || !segmentKeys.includes(dragKey)) return;
        event.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropTarget(false);
        if (dragKey && dragKey !== beat.key) {
          handlers.onReorderBeat(chapter.path, segmentKeys, dragKey, beat.key);
        }
        setDragKey(null);
      }}
    >
      {draggable && (
        <Tooltip content="拖动调整顺序" className={styles.gripSlot}>
          <span
            className={styles.grip}
            draggable
            aria-hidden="true"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', beat.key);
              setDragKey(beat.key);
            }}
            onDragEnd={() => setDragKey(null)}
          >
            <VscGripper />
          </span>
        </Tooltip>
      )}
      <div className={styles.beatBody}>
        {beat.title && (
          <button
            type="button"
            className={styles.beatTitle}
            title="跳到正文"
            onClick={() => handlers.onOpenChapter(chapter.path, beat.line, beat.title)}
          >
            {beat.title}
          </button>
        )}
        <EditableText
          value={beat.text}
          placeholder="写一句这里发生了什么"
          ariaLabel={`编辑节拍 ${beat.title || beat.text}`}
          className={styles.beatText}
          onCommit={(text) => handlers.onEditBeat(beat.key, text)}
        />
      </div>
      {beat.source !== 'scene' && (
        <span className={styles.beatSource}>{BEAT_SOURCE_LABELS[beat.source]}</span>
      )}
      {handlers.onInsertBeat && beat.source !== 'outline' && (
        <Tooltip content={BEAT_ACTION_TIPS.insert}>
          <button
            type="button"
            className={styles.beatAction}
            aria-label={`插入到章纲 ${beat.title || beat.text}`}
            onClick={() => handlers.onInsertBeat?.(chapter, beat)}
          >
            <VscInsert />
          </button>
        </Tooltip>
      )}
      {handlers.onSceneVideo && beat.source === 'scene' && (
        <Tooltip content={BEAT_ACTION_TIPS.video}>
          <button
            type="button"
            className={styles.beatAction}
            aria-label={`生成场景视频 ${beat.title || beat.text}`}
            onClick={() => handlers.onSceneVideo?.(chapter, beat)}
          >
            <VscDeviceCameraVideo />
          </button>
        </Tooltip>
      )}
    </li>
  );
};

const ChapterBlock: React.FC<{
  chapter: VolumeChapterPlan;
  characters: string[];
  words: number;
  dragKey: string | null;
  setDragKey: (key: string | null) => void;
  handlers: OutlineListHandlers;
}> = ({ chapter, characters, words, dragKey, setDragKey, handlers }) => {
  const segmentKeys = chapter.beats.map((beat) => beat.key);
  return (
    <div className={styles.chapter} data-chapter-path={chapter.path}>
      <div className={styles.chapterHeader}>
        <span className={styles.chapterIndex}>{chapter.index + 1}</span>
        <button
          type="button"
          className={styles.chapterTitle}
          title="打开本章"
          onClick={() => handlers.onOpenChapter(chapter.path)}
        >
          {chapter.title}
          {chapter.continued && <span className={styles.continued}>（续）</span>}
        </button>
        {characters.length > 0 && (
          <span className={styles.chapterPeople} title={`出场：${characters.join('、')}`}>
            {characters.slice(0, 3).join(' · ')}
          </span>
        )}
        {words > 0 && !chapter.continued && (
          <span className={styles.chapterWords} title={`本章 ${words} 字`}>
            {formatWordCount(words)}
          </span>
        )}
      </div>
      {chapter.beats.length > 0 ? (
        <ul className={styles.beats}>
          {chapter.beats.map((beat) => (
            <BeatRow
              key={beat.key}
              chapter={chapter}
              beat={beat}
              segmentKeys={segmentKeys}
              dragKey={dragKey}
              setDragKey={setDragKey}
              handlers={handlers}
            />
          ))}
        </ul>
      ) : (
        <div className={styles.emptyBeats}>还没有内容，写下第一场后这里会自动出现节拍</div>
      )}
    </div>
  );
};

const ActBlock: React.FC<{
  act: VolumeActPlan;
  index: number;
  charactersByChapter: Map<string, string[]>;
  wordsByChapter: ReadonlyMap<string, number>;
  dragKey: string | null;
  setDragKey: (key: string | null) => void;
  handlers: OutlineListHandlers;
}> = ({ act, index, charactersByChapter, wordsByChapter, dragKey, setDragKey, handlers }) => (
  <section className={styles.act} aria-label={act.title} data-act-key={act.key}>
    <div className={styles.actHeader}>
      <span className={styles.actDot} data-tone={index % 4} />
      {act.line && act.chapters[0] ? (
        <button
          type="button"
          className={styles.actTitle}
          title="跳到正文"
          onClick={() => handlers.onOpenChapter(act.chapters[0].path, act.line, act.title)}
        >
          {act.title}
        </button>
      ) : (
        <span className={styles.actTitle}>{act.title}</span>
      )}
      <span className={styles.actCount}>{act.chapters.length} 章</span>
    </div>
    {/* 没有说明时只在悬停 / 聚焦这一幕时显示「＋ 一句话说明」，避免每一幕都重复占位文字 */}
    <EditableText
      value={act.hint}
      placeholder="＋ 一句话说明这一段要完成什么"
      ariaLabel={`编辑 ${act.title} 的说明`}
      className={`${styles.actNote} ${act.hint ? '' : styles.actNoteEmpty}`}
      onCommit={(text) => handlers.onEditActNote(act.key, text)}
    />
    <div className={styles.chapters}>
      {act.chapters.map((chapter) => (
        <ChapterBlock
          key={`${chapter.path}:${chapter.continued ? 'c' : 'h'}`}
          chapter={chapter}
          characters={charactersByChapter.get(chapter.path) ?? []}
          words={wordsByChapter.get(chapter.path) ?? 0}
          dragKey={dragKey}
          setDragKey={setDragKey}
          handlers={handlers}
        />
      ))}
    </div>
  </section>
);

const EMPTY_WORDS: ReadonlyMap<string, number> = new Map();

/** 列表视图：幕 → 章 → 关键节拍（点击编辑、拖拽排序、插入章纲） */
export const OutlineList: React.FC<{
  outline: VolumeOutline;
  charactersByChapter: Map<string, string[]>;
  /** 章节字数（不计空白）；省略时不显示 */
  wordsByChapter?: ReadonlyMap<string, number>;
  handlers: OutlineListHandlers;
}> = ({ outline, charactersByChapter, wordsByChapter = EMPTY_WORDS, handlers }) => {
  const [dragKey, setDragKeyState] = useState<string | null>(null);
  const setDragKey = useCallback((key: string | null) => setDragKeyState(key), []);
  return (
    <div className={styles.outlineList}>
      {outline.acts.map((act, index) => (
        <ActBlock
          key={act.key}
          act={act}
          index={index}
          charactersByChapter={charactersByChapter}
          wordsByChapter={wordsByChapter}
          dragKey={dragKey}
          setDragKey={setDragKey}
          handlers={handlers}
        />
      ))}
    </div>
  );
};
