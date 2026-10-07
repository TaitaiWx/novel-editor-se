/**
 * 人物线：统计每个人物在各章的出场次数（名字 + 别名），按总出场排序
 */
import type { CharacterLane, VolumeChapterSource, VolumeCharacterRef } from './types';

function countWord(text: string, word: string): number {
  if (!word) return 0;
  let count = 0;
  let index = text.indexOf(word);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(word, index + word.length);
  }
  return count;
}

/** 名字与别名（去重；被名字包含的别名不重复计数） */
function namesOf(character: VolumeCharacterRef): string[] {
  const name = character.name.trim();
  const aliases = (character.aliases || [])
    .map((alias) => alias.trim())
    .filter((alias) => alias && alias !== name && !name.includes(alias));
  return [name, ...new Set(aliases)].filter(Boolean);
}

/**
 * 计算人物泳道：没出场的人物不返回；limit 限制最多显示的泳道数
 */
export function computeCharacterLanes(
  chapters: VolumeChapterSource[],
  characters: VolumeCharacterRef[],
  limit = 12
): CharacterLane[] {
  const seen = new Set<string>();
  const lanes: CharacterLane[] = [];
  characters.forEach((character) => {
    const key = character.name.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const names = namesOf(character);
    const counts = chapters.map((chapter) =>
      names.reduce((sum, name) => sum + countWord(chapter.content, name), 0)
    );
    const total = counts.reduce((sum, value) => sum + value, 0);
    if (total === 0) return;
    lanes.push({
      name: key,
      counts,
      total,
      first: counts.findIndex((value) => value > 0),
      last: counts.length - 1 - [...counts].reverse().findIndex((value) => value > 0),
    });
  });
  return lanes.sort((a, b) => b.total - a.total || a.first - b.first).slice(0, limit);
}

/** 某章出场的人物名（按出场次数降序） */
export function charactersInChapter(lanes: CharacterLane[], chapterIndex: number): string[] {
  return lanes
    .filter((lane) => (lane.counts[chapterIndex] || 0) > 0)
    .sort((a, b) => b.counts[chapterIndex] - a.counts[chapterIndex])
    .map((lane) => lane.name);
}
