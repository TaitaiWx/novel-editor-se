import UiButton from '@novel-editor/ui/Button';
import React, { useState } from 'react';
import {
  developmentStatusLabel,
  type DevelopmentEvent,
} from '@novel-editor/core/character-development';
import type { EnrichmentChapter } from '@novel-editor/core/character-enrichment';
import styles from './styles.module.scss';

export default function DevelopmentHistory({
  events,
  disabled,
  chapters,
  onOpenChapter,
  onUseDescription,
}: {
  events: DevelopmentEvent[];
  disabled: boolean;
  chapters: EnrichmentChapter[];
  onOpenChapter?: (path: string) => void;
  onUseDescription: (description: string) => void;
}) {
  const [feedback, setFeedback] = useState('');
  return (
    <details className={styles.history}>
      <summary>变化记录（{events.length}）</summary>
      {events
        .slice()
        .reverse()
        .map((event) => {
          const chapter = chapters.find(
            (item) => item.path === event.chapter || item.label === event.chapter
          );
          const status = developmentStatusLabel(event.status);
          return (
            <details key={event.id} className={styles.historyRecord}>
              <summary>
                {status} · {event.source === 'ai' ? 'AI 同步' : '手动记录'}
                {Number.isFinite(Date.parse(event.at)) && (
                  <time dateTime={event.at}> · {new Date(event.at).toLocaleString()}</time>
                )}
                <span className={styles.historyExcerpt}>{event.note || '暂无描述'}</span>
              </summary>
              <p className={styles.copy}>{event.note}</p>
              {event.chapter && <p className={styles.meta}>{event.chapter}</p>}
              {event.quote && <blockquote className={styles.copy}>{event.quote}</blockquote>}
              <div className={styles.actions}>
                <UiButton
                  unstyled
                  type="button"
                  className={styles.button}
                  disabled={!event.note}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(event.note);
                      setFeedback('已复制记录内容');
                    } catch {
                      setFeedback('复制失败，请选中文字复制');
                    }
                  }}
                >
                  复制内容
                </UiButton>
                <UiButton
                  unstyled
                  type="button"
                  className={styles.button}
                  disabled={disabled || !event.note}
                  onClick={() => {
                    onUseDescription(event.note);
                    setFeedback('已填入详细描述，保存条目后生效');
                  }}
                >
                  填入描述
                </UiButton>
                {chapter && onOpenChapter && (
                  <UiButton
                    unstyled
                    type="button"
                    className={styles.button}
                    onClick={() => onOpenChapter(chapter.path)}
                  >
                    打开关联章节
                  </UiButton>
                )}
              </div>
            </details>
          );
        })}
      {feedback && (
        <p role="status" className={styles.historyFeedback}>
          {feedback}
        </p>
      )}
    </details>
  );
}
