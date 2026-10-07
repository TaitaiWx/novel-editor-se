import React from 'react';
import type { ChapterTension, CharacterLane, ForeshadowItem } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';

const TENSION_LABELS = ['', '平缓', '铺垫', '紧张', '激烈', '高潮'];

type OpenChapter = (path: string, line?: number, anchor?: string) => void;

/** 节奏：张力折线 + 每章一行（张力条与主要信号） */
export const TensionView: React.FC<{
  tension: ChapterTension[];
  notes: string[];
  onOpenChapter: OpenChapter;
}> = ({ tension, notes, onOpenChapter }) => {
  if (tension.length === 0) return <div className={styles.viewEmpty}>本卷还没有章节</div>;
  const width = 100;
  const height = 36;
  const step = tension.length > 1 ? width / (tension.length - 1) : 0;
  const points = tension
    .map((item, index) => {
      const x = tension.length > 1 ? index * step : width / 2;
      const y = height - 4 - ((item.level - 1) / 4) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className={styles.derivedView} aria-label="节奏">
      <svg
        className={styles.tensionCurve}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="张力曲线"
      >
        <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      {notes.length > 0 && (
        <ul className={styles.notes}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <ul className={styles.tensionList}>
        {tension.map((item, index) => (
          <li key={item.path}>
            <button
              type="button"
              className={styles.tensionRow}
              title={item.signals.join(' · ') || '没有明显的冲突信号'}
              onClick={() => onOpenChapter(item.path)}
            >
              <span className={styles.chapterIndex}>{index + 1}</span>
              <span className={styles.tensionTitle}>{item.title}</span>
              <span className={styles.tensionBar} aria-hidden="true">
                <span style={{ width: `${item.level * 20}%` }} data-level={item.level} />
              </span>
              <span className={styles.tensionLabel}>{TENSION_LABELS[item.level]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** 人物线：人物 × 章节的出场泳道，圆点大小表示出场次数 */
export const CharacterLanesView: React.FC<{
  lanes: CharacterLane[];
  chapters: Array<{ path: string; title: string }>;
  onOpenChapter: OpenChapter;
}> = ({ lanes, chapters, onOpenChapter }) => {
  if (chapters.length === 0) return <div className={styles.viewEmpty}>本卷还没有章节</div>;
  if (lanes.length === 0) {
    return (
      <div className={styles.viewEmpty}>
        本卷正文里还没有人物库中的人物出场
        <br />
        <span>在人物库添加人物（含别名）后自动生成人物线</span>
      </div>
    );
  }
  const max = Math.max(...lanes.flatMap((lane) => lane.counts), 1);
  const columns = `64px repeat(${chapters.length}, minmax(18px, 1fr))`;
  return (
    <div className={styles.derivedView} aria-label="人物线">
      <div
        className={styles.lanes}
        style={{ gridTemplateColumns: columns }}
        role="table"
        aria-label="人物出场泳道"
      >
        <div className={styles.laneRow} role="row">
          <span role="columnheader" aria-label="人物" />
          {chapters.map((chapter, index) => (
            <span key={chapter.path} role="columnheader" className={styles.laneHeaderCell}>
              <button
                type="button"
                className={styles.laneHeader}
                title={chapter.title}
                onClick={() => onOpenChapter(chapter.path)}
              >
                {index + 1}
              </button>
            </span>
          ))}
        </div>
        {lanes.map((lane) => (
          <div
            key={lane.name}
            className={styles.laneRow}
            role="row"
            aria-label={`人物线 ${lane.name}`}
          >
            <span
              className={styles.laneName}
              role="rowheader"
              title={`共出场 ${lane.total} 次 · 第 ${lane.first + 1}–${lane.last + 1} 章`}
            >
              {lane.name}
            </span>
            {lane.counts.map((count, index) => (
              <span
                key={chapters[index]?.path ?? index}
                className={styles.laneCell}
                role="cell"
                data-active={index >= lane.first && index <= lane.last ? 'true' : undefined}
                title={count > 0 ? `${chapters[index]?.title}：${count} 次` : undefined}
              >
                {count > 0 && (
                  <span
                    className={styles.laneDot}
                    style={{ transform: `scale(${0.45 + (count / max) * 0.55})` }}
                  />
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

/** 伏笔：可能埋下的线索，未呼应的排在前面 */
export const ForeshadowView: React.FC<{
  items: ForeshadowItem[];
  onOpenChapter: OpenChapter;
}> = ({ items, onOpenChapter }) => {
  if (items.length === 0) {
    return (
      <div className={styles.viewEmpty}>
        没有发现明显的伏笔
        <br />
        <span>正文或章纲里写到「约定 / 秘密 / 碎片 / 伏笔」等时会出现在这里</span>
      </div>
    );
  }
  const open = items.filter((item) => !item.echoed).length;
  return (
    <div className={styles.derivedView} aria-label="伏笔">
      <div className={styles.viewSummary}>
        {open > 0 ? `${open} 条可能还没有回收` : '都已在后文出现过'}
      </div>
      <ul className={styles.foreshadowList}>
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={styles.foreshadowRow}
              onClick={() => onOpenChapter(item.chapterPath, item.line || undefined)}
            >
              <span className={styles.foreshadowKeyword}>{item.keyword}</span>
              <span className={styles.foreshadowText}>{item.text}</span>
              <span className={styles.foreshadowMeta} data-echoed={item.echoed || undefined}>
                {item.chapterTitle}
                {item.echoed ? ` → ${item.echoedIn}` : ' · 未回收'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
