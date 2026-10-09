/**
 * 人物 / 设定列表浅比较工具，用于避免无意义的 state 更新
 */
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';

/** 设计 / 图集等嵌套字段：按序列化结果比较（数量小，开销可忽略） */
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function areCharactersEqual(left: Character[], right: Character[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const next = right[index];
    return (
      item.id === next.id &&
      item.name === next.name &&
      item.role === next.role &&
      item.category === next.category &&
      (item.group ?? '') === (next.group ?? '') &&
      item.description === next.description &&
      item.avatar === next.avatar &&
      item.highlightColor === next.highlightColor &&
      item.highlightFirstMentionOnly === next.highlightFirstMentionOnly &&
      (item.aliases || []).join('\u0000') === (next.aliases || []).join('\u0000') &&
      sameJson(item.design, next.design) &&
      sameJson(item.media, next.media)
    );
  });
}

export function areLoreEntriesEqual(left: LoreEntry[], right: LoreEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const next = right[index];
    return (
      item.id === next.id &&
      item.title === next.title &&
      item.summary === next.summary &&
      item.category === next.category &&
      item.createdAt === next.createdAt &&
      item.updatedAt === next.updatedAt &&
      item.tags.length === next.tags.length &&
      item.tags.every((tag, tagIndex) => tag === next.tags[tagIndex]) &&
      item.folder === next.folder &&
      (item.group ?? '') === (next.group ?? '') &&
      item.cover === next.cover &&
      sameJson(item.media, next.media)
    );
  });
}
