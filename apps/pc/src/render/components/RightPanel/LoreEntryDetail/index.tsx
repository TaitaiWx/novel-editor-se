import React, { useEffect, useId, useMemo, useState } from 'react';
import { VscClose } from 'react-icons/vsc';
import {
  LORE_MEDIA_KINDS,
  buildLoreImagePrompt,
  normalizeLoreFolder,
  normalizeTags,
  resolveCover,
} from '@novel-editor/core/entity-media';
import EntityGallery from '../../EntityGallery';
import { MediaImage } from '../../EntityGallery/MediaTile';
import { LORE_CATEGORY_LABELS } from '../constants';
import type { LoreDraft } from '../lore-data';
import type { LoreCategory, LoreEntry } from '../types';
import styles from './styles.module.scss';

export type LoreDetailTab = 'content' | 'gallery' | 'related';

interface LoreEntryDetailProps {
  entry: LoreEntry;
  entries: readonly LoreEntry[];
  workPath: string | null;
  onUpdate: (patch: Partial<LoreDraft>) => Promise<void>;
  onDelete: () => void;
  onOpenEntry: (entry: LoreEntry) => void;
}

/** 已有的分类目录（含各级父目录），给目录输入框做候选 */
export function collectLoreFolders(entries: readonly Pick<LoreEntry, 'folder'>[]): string[] {
  const folders = new Set<string>();
  for (const entry of entries) {
    const parts = normalizeLoreFolder(entry.folder).split('/').filter(Boolean);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join('/')));
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 相关设定：同目录优先，其次共享标签，再次同分类 */
export function relatedLoreEntries(entry: LoreEntry, entries: readonly LoreEntry[], limit = 8) {
  const score = (other: LoreEntry) =>
    (other.folder && other.folder === entry.folder ? 4 : 0) +
    other.tags.filter((tag) => entry.tags.includes(tag)).length * 2 +
    (other.category === entry.category ? 1 : 0);
  return entries
    .filter((other) => other.id !== entry.id)
    .map((other) => ({ other, value: score(other) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.other.title.localeCompare(b.other.title, 'zh-Hans-CN'))
    .slice(0, limit)
    .map((item) => item.other);
}

/**
 * 设定详情（参照人物详情 / 成长档案的布局）：左侧封面，右侧标题、分类、目录、标签；
 * 下方分页 内容 / 图集（AI 生成或本地上传，选一张作封面）/ 相关设定
 */
export const LoreEntryDetail: React.FC<LoreEntryDetailProps> = ({
  entry,
  entries,
  workPath,
  onUpdate,
  onDelete,
  onOpenEntry,
}) => {
  const idPrefix = `lore-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [tab, setTab] = useState<LoreDetailTab>('content');
  const [title, setTitle] = useState(entry.title);
  const [summary, setSummary] = useState(entry.summary);
  const [folder, setFolder] = useState(entry.folder);
  const [tagInput, setTagInput] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    setTitle(entry.title);
    setSummary(entry.summary);
    setFolder(entry.folder);
  }, [entry.id, entry.title, entry.summary, entry.folder]);

  const folders = useMemo(() => collectLoreFolders(entries), [entries]);
  const related = useMemo(() => relatedLoreEntries(entry, entries), [entry, entries]);
  const cover = resolveCover(entry.media, entry.cover);
  const dirty = title.trim() !== entry.title || summary.trim() !== entry.summary;

  const save = async (patch: Partial<LoreDraft>, message = '已保存') => {
    await onUpdate(patch);
    setSaved(`${message} ${new Date().toLocaleTimeString()}`);
  };

  const addTags = (raw: string) => {
    const next = normalizeTags([...(entry.tags ?? []), ...normalizeTags(raw)]);
    setTagInput('');
    if (next.length !== entry.tags.length) void save({ tags: next });
  };

  return (
    <div className={styles.detail} data-testid="lore-detail">
      <section className={styles.hero}>
        <button
          type="button"
          className={styles.cover}
          aria-label={cover ? `更换 ${entry.title} 的封面` : `为 ${entry.title} 添加图片`}
          title="打开图集：上传、AI 生成或选一张作封面"
          onClick={() => setTab('gallery')}
        >
          {cover ? (
            <MediaImage path={cover} workPath={workPath} alt={`${entry.title} 的封面`} />
          ) : (
            <span className={styles.coverEmpty}>
              <span className={styles.coverInitial}>{Array.from(entry.title)[0] ?? '?'}</span>
              添加图片
            </span>
          )}
        </button>
        <div className={styles.heroMain}>
          <div className={styles.eyebrow}>设定资料</div>
          <input
            className={styles.titleInput}
            aria-label="设定标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              const next = title.trim();
              if (next && next !== entry.title) void save({ title: next });
              else setTitle(entry.title);
            }}
          />
          <div className={styles.metaRow}>
            <label className={styles.metaField}>
              <span>分类</span>
              <select
                className={styles.select}
                aria-label="设定分类"
                value={entry.category}
                onChange={(event) => void save({ category: event.target.value as LoreCategory })}
              >
                {(Object.keys(LORE_CATEGORY_LABELS) as LoreCategory[]).map((item) => (
                  <option key={item} value={item}>
                    {LORE_CATEGORY_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.metaField}>
              <span>目录</span>
              <input
                className={styles.input}
                aria-label="设定目录"
                list={`${idPrefix}-folders`}
                value={folder}
                placeholder="例如 地理/北境（可留空）"
                onChange={(event) => setFolder(event.target.value)}
                onBlur={() => {
                  const next = normalizeLoreFolder(folder);
                  setFolder(next);
                  if (next !== entry.folder) void save({ folder: next });
                }}
              />
              <datalist id={`${idPrefix}-folders`}>
                {folders.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
          </div>
          <div className={styles.tags} aria-label="标签">
            {entry.tags.map((tag) => (
              <span key={tag} className={styles.tag}>
                #{tag}
                <button
                  type="button"
                  className={styles.tagRemove}
                  aria-label={`移除标签 ${tag}`}
                  onClick={() => void save({ tags: entry.tags.filter((item) => item !== tag) })}
                >
                  <VscClose />
                </button>
              </span>
            ))}
            <input
              className={styles.tagInput}
              aria-label="添加标签"
              value={tagInput}
              placeholder={entry.tags.length ? '+ 标签' : '+ 加标签（回车）'}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && tagInput.trim()) {
                  event.preventDefault();
                  addTags(tagInput);
                }
              }}
              onBlur={() => tagInput.trim() && addTags(tagInput)}
            />
          </div>
          {saved && <span className={styles.saved}>{saved}</span>}
        </div>
      </section>

      <div className={styles.tabs} role="tablist" aria-label="设定详情">
        {(
          [
            ['content', '内容'],
            ['gallery', '图集'],
            ['related', '相关设定'],
          ] as Array<[LoreDetailTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'gallery' && (entry.media?.length ?? 0) > 0 && (
              <span className={styles.tabCount}>{entry.media?.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'content' && (
        <div className={styles.panel} role="tabpanel" aria-label="内容">
          <textarea
            className={styles.textarea}
            aria-label="设定内容"
            value={summary}
            rows={12}
            placeholder="记录规则、背景、约束、历史脉络、关键词等"
            onChange={(event) => setSummary(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={!dirty || !title.trim()}
              onClick={() => void save({ title: title.trim(), summary: summary.trim() })}
            >
              保存
            </button>
            <button type="button" className={styles.danger} onClick={onDelete}>
              删除条目
            </button>
          </div>
        </div>
      )}

      {tab === 'gallery' && (
        <div className={styles.panel} role="tabpanel" aria-label="图集">
          <EntityGallery
            entity="lore"
            name={entry.title}
            workPath={workPath}
            items={entry.media ?? []}
            cover={entry.cover}
            kinds={LORE_MEDIA_KINDS}
            referenceKinds={['concept', 'background']}
            buildPrompt={({ kind, style, extra }) =>
              buildLoreImagePrompt({
                title: entry.title,
                summary: entry.summary,
                kind,
                style,
                extra,
              })
            }
            onChange={({ media, cover: nextCover }) =>
              save({ media, cover: nextCover ?? '' }, '图集已更新')
            }
          />
        </div>
      )}

      {tab === 'related' && (
        <div className={styles.panel} role="tabpanel" aria-label="相关设定">
          {related.length === 0 ? (
            <p className={styles.muted}>还没有同目录、同标签或同分类的设定。</p>
          ) : (
            <ul className={styles.related}>
              {related.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onOpenEntry(item)}>
                    <strong>{item.title}</strong>
                    <span>
                      {[item.folder, ...item.tags.map((tag) => `#${tag}`)]
                        .filter(Boolean)
                        .join(' · ') || LORE_CATEGORY_LABELS[item.category]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default LoreEntryDetail;
