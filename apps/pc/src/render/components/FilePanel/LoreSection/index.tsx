import React, { useMemo, useState } from 'react';
import {
  AiOutlineAppstore,
  AiOutlineDown,
  AiOutlineFolder,
  AiOutlinePlus,
  AiOutlineRight,
} from 'react-icons/ai';
import {
  buildLoreFolderTree,
  resolveCover,
  type LoreFolderNode,
} from '@novel-editor/core/entity-media';
import type { LoreCategory, LoreEntry } from '../../RightPanel/types';
import { LORE_CATEGORY_LABELS } from '../../RightPanel/constants';
import CharacterAvatar from '../../CharacterAvatar';
import Tooltip from '../../Tooltip';
import SectionHeader from '../SectionHeader';
import ObjectItemRow from '../ObjectItemRow';
import GroupLabel from '../GroupLabel';
import { WORKSPACE_TAB_LORE, createLoreWorkspaceTab } from '../../../utils/workspace';
import type { ObjectContextMenuTarget } from '../types';
import styles from './styles.module.scss';

export const LORE_SECTION_HINT = '世界观、势力、体系、地点和物品；可以分目录、打标签、配图';

/** 行内说明：标签优先（#北境 #禁地），没有标签时用摘要（分类已经是分组标题，不再重复） */
export function loreRowMeta(entry: Pick<LoreEntry, 'tags' | 'category' | 'summary'>): string {
  if (entry.tags.length > 0)
    return entry.tags
      .slice(0, 3)
      .map((tag) => `#${tag}`)
      .join(' ');
  return entry.summary || '';
}

/** 分组顺序：世界观 / 势力 / 体系 / 术语 */
const LORE_GROUP_ORDER: readonly LoreCategory[] = ['world', 'faction', 'system', 'term'];

interface LoreSectionProps {
  entries: LoreEntry[];
  workPath: string | null;
  filtering: boolean;
  collapsed: boolean;
  activeWorkspaceTab?: string | null;
  onToggle: () => void;
  onOpenAll: () => void;
  onOpen: (id: number) => void;
  onRename: (id: number, name: string) => void;
  /** 重命名分组（这一组的设定都改成新的分组名）；未提供时分组名不可改 */
  onRenameGroup?: (entryIds: readonly number[], name: string) => void;
  onDelete: (id: number) => void;
  onCreate: () => void;
  onContextMenu: (event: React.MouseEvent, target: ObjectContextMenuTarget) => void;
}

/**
 * 文件面板「设定」分区：按分类目录（例如「地理/北境」）组织成树，目录可折叠；
 * 每行显示封面缩略图（没有图时为首字）与标签。
 */
const LoreSection: React.FC<LoreSectionProps> = ({
  entries,
  workPath,
  filtering,
  collapsed,
  activeWorkspaceTab,
  onToggle,
  onOpenAll,
  onOpen,
  onRename,
  onRenameGroup,
  onDelete,
  onCreate,
  onContextMenu,
}) => {
  // 先按分组（作者自定义的分组名，没有时按世界观 / 势力 / 体系 / 术语），组内再按目录组织成树；
  // 默认分组在前，自定义分组按出现顺序排在后面，与默认分组同名时合并
  const groups = useMemo(() => {
    const buckets = new Map<string, LoreEntry[]>();
    for (const category of LORE_GROUP_ORDER) buckets.set(LORE_CATEGORY_LABELS[category], []);
    for (const entry of entries) {
      const category = LORE_GROUP_ORDER.includes(entry.category) ? entry.category : 'world';
      const label = entry.group?.trim() || LORE_CATEGORY_LABELS[category];
      const bucket = buckets.get(label) ?? [];
      bucket.push(entry);
      buckets.set(label, bucket);
    }
    return Array.from(buckets.entries())
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) => ({
        label,
        items,
        tree: buildLoreFolderTree(items, (entry) => entry.title),
      }));
  }, [entries]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const renderEntry = (entry: LoreEntry, depth: number) => (
    <div key={entry.id} style={{ marginLeft: depth * 12 }}>
      <ObjectItemRow
        kindLabel="设定"
        title={entry.title}
        meta={loreRowMeta(entry)}
        icon={
          <CharacterAvatar
            name={entry.title}
            avatar={resolveCover(entry.media, entry.cover)}
            workPath={workPath}
            color="#c9b38a"
            size={18}
            className={styles.cover}
          />
        }
        active={activeWorkspaceTab === createLoreWorkspaceTab(entry)}
        onOpen={() => onOpen(entry.id)}
        onRename={(name) => onRename(entry.id, name)}
        onDelete={() => onDelete(entry.id)}
        onContextMenu={(event) => onContextMenu(event, { kind: 'lore-item', entryId: entry.id })}
      />
    </div>
  );

  const renderFolder = (
    node: LoreFolderNode<LoreEntry>,
    depth: number,
    scope: string
  ): React.ReactNode => {
    // 不同分类下可能有同名目录：折叠状态按「分类/目录」记录；搜索时目录全部展开
    const key = `${scope}/${node.path}`;
    const open = filtering || !closed.has(key);
    return (
      <div key={key} role="group" aria-label={`设定目录 ${node.path}`}>
        <button
          type="button"
          className={styles.folder}
          style={{ paddingLeft: 30 + depth * 12 }}
          aria-expanded={open}
          onClick={() =>
            setClosed((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          {open ? <AiOutlineDown aria-hidden="true" /> : <AiOutlineRight aria-hidden="true" />}
          <AiOutlineFolder aria-hidden="true" />
          <span className={styles.folderName}>{node.name}</span>
          <span className={styles.folderCount}>{node.total}</span>
        </button>
        {open && (
          <>
            {node.folders.map((child) => renderFolder(child, depth + 1, scope))}
            {node.items.map((entry) => renderEntry(entry, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <section className={styles.section} aria-label="设定">
      <SectionHeader
        title="设定"
        icon={<AiOutlineFolder />}
        count={entries.length}
        active={activeWorkspaceTab === WORKSPACE_TAB_LORE}
        singleClickOnly
        tooltip={LORE_SECTION_HINT}
        onToggle={onToggle}
        onContextMenu={(event) => onContextMenu(event, { kind: 'lore-root' })}
        actions={
          <>
            <Tooltip content="设定总览：分类、标签与配图" position="top">
              <button
                type="button"
                className={styles.headerAction}
                onClick={onOpenAll}
                aria-label="打开设定总览"
              >
                <AiOutlineAppstore />
              </button>
            </Tooltip>
            <Tooltip content="新建设定" position="top">
              <button
                type="button"
                className={styles.headerAction}
                onClick={onCreate}
                aria-label="新建设定"
              >
                <AiOutlinePlus />
              </button>
            </Tooltip>
          </>
        }
      />
      {!collapsed && (
        <div className={styles.children}>
          {groups.map((group) => (
            <div
              key={group.label}
              className={styles.subgroup}
              role="group"
              aria-label={`设定分组 ${group.label}`}
            >
              <GroupLabel
                label={group.label}
                count={group.items.length}
                onRename={
                  onRenameGroup
                    ? (name) =>
                        onRenameGroup(
                          group.items.map((entry) => entry.id),
                          name
                        )
                    : undefined
                }
              />
              {group.tree.folders.map((folder) => renderFolder(folder, 0, group.label))}
              {group.tree.items.map((entry) => renderEntry(entry, 0))}
            </div>
          ))}
          {entries.length === 0 && (
            <div className={styles.empty}>
              {filtering ? '当前筛选条件下没有设定' : '还没有设定，点 + 新建'}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default LoreSection;
