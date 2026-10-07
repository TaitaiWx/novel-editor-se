import React from 'react';
import type { VolumeOutline } from '@novel-editor/basic-algorithm';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

/** 字数显示：1234 → 1.2k，12345 → 1.2 万 */
export function formatWordCount(count: number): string {
  if (count >= 10_000) return `${(count / 10_000).toFixed(1).replace(/\.0$/, '')} 万`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(count);
}

/** 正文字数（与状态栏同一口径：不计空白） */
export function countWords(content: string): number {
  return content.replace(/\s+/g, '').length;
}

export interface ActSegment {
  key: string;
  title: string;
  chapters: number;
  words: number;
  tone: number;
}

/**
 * 每一幕的章数与字数：章数与幕标题旁的「N 章」一致（被幕标记切开的章在两幕都算）；
 * 字数只计入该章首次出现的那一幕，避免重复
 */
export function buildActSegments(
  outline: VolumeOutline,
  wordsByChapter: ReadonlyMap<string, number>
): ActSegment[] {
  return outline.acts.map((act, index) => ({
    key: act.key,
    title: act.title,
    chapters: act.chapters.length,
    words: act.chapters.reduce(
      (sum, chapter) => sum + (chapter.continued ? 0 : (wordsByChapter.get(chapter.path) ?? 0)),
      0
    ),
    tone: index % 4,
  }));
}

/**
 * 卷纲总览条：每一幕一段，宽度按章数（没有章节的段按 1 计，保证可见），
 * 一眼看出结构比例；点击某段滚动到那一幕
 */
export const VolumeOverview: React.FC<{
  segments: ActSegment[];
  onJump: (actKey: string) => void;
}> = ({ segments, onJump }) => {
  if (segments.length === 0) return null;
  return (
    <div className={styles.overview} role="list" aria-label="卷纲结构总览">
      {segments.map((segment) => (
        <Tooltip
          key={segment.key}
          content={`${segment.title} · ${segment.chapters} 章${
            segment.words > 0 ? ` · ${formatWordCount(segment.words)} 字` : ''
          }（点击跳到这一幕）`}
          className={styles.overviewSlot}
          style={{ flexGrow: Math.max(1, segment.chapters) }}
        >
          <button
            type="button"
            role="listitem"
            className={styles.overviewSegment}
            data-tone={segment.tone}
            data-empty={segment.chapters === 0 ? 'true' : undefined}
            aria-label={`${segment.title}，${segment.chapters} 章`}
            onClick={() => onJump(segment.key)}
          >
            <span className={styles.overviewLabel}>{segment.title}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
};
