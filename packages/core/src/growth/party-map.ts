/**
 * 队伍、配角与地图记录（纯函数，返回新对象）
 */
import { CoreError } from '../errors';
import { slugifyId } from './normalize';
import type {
  Atlas,
  CompanionRecord,
  ForgottenCompanion,
  GrowthSheet,
  LocationRecord,
  PartyBook,
  PartyRecord,
} from './types';
import { latestChapterOfSheet } from './engine';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

// ─── 队伍 ───────────────────────────────────────────────────────────────────

export function findParty(book: PartyBook, ref: string): PartyRecord | undefined {
  const key = ref.trim();
  return book.parties.find((party) => party.id === key || party.name === key);
}

export interface AddPartyInput {
  name: string;
  members: string[];
  fromChapter?: number;
  toChapter?: number;
  notes?: string;
}

/** 新增一支队伍，成员自动登记到配角出场记录 */
export function addParty(book: PartyBook, input: AddPartyInput): PartyBook {
  const name = input.name.trim();
  if (!name) throw new CoreError('INVALID_ARGUMENT', '队伍名不能为空');
  if (findParty(book, name)) throw new CoreError('ALREADY_EXISTS', `队伍已存在: ${name}`);
  const members = Array.from(new Set(input.members.map((m) => m.trim()).filter(Boolean)));
  if (members.length === 0) throw new CoreError('INVALID_ARGUMENT', '队伍至少需要一名成员');
  if (
    input.fromChapter !== undefined &&
    input.toChapter !== undefined &&
    input.toChapter < input.fromChapter
  ) {
    throw new CoreError('INVALID_ARGUMENT', '解散章节不能早于组队章节');
  }
  const next = clone(book);
  const party: PartyRecord = {
    id: uniqueId(slugifyId(name, 'party'), new Set(next.parties.map((p) => p.id))),
    name,
    members,
    ...(input.fromChapter !== undefined ? { fromChapter: input.fromChapter } : {}),
    ...(input.toChapter !== undefined ? { toChapter: input.toChapter } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  next.parties.push(party);
  const seenAt = input.toChapter ?? input.fromChapter;
  let result = next;
  for (const member of members) result = markCompanionSeen(result, member, seenAt);
  return result;
}

/** 标记队伍解散 */
export function endParty(book: PartyBook, ref: string, toChapter: number): PartyBook {
  const next = clone(book);
  const party = findParty(next, ref);
  if (!party) throw new CoreError('NOT_FOUND', `队伍不存在: ${ref}`);
  if (party.fromChapter !== undefined && toChapter < party.fromChapter) {
    throw new CoreError('INVALID_ARGUMENT', '解散章节不能早于组队章节');
  }
  party.toChapter = toChapter;
  return next;
}

export function removeParty(book: PartyBook, ref: string): PartyBook {
  const party = findParty(book, ref);
  if (!party) throw new CoreError('NOT_FOUND', `队伍不存在: ${ref}`);
  const next = clone(book);
  next.parties = next.parties.filter((item) => item.id !== party.id);
  return next;
}

/** 记录配角在某章出场（只会向后推进 lastSeenChapter） */
export function markCompanionSeen(
  book: PartyBook,
  name: string,
  chapter?: number,
  patch: Partial<Pick<CompanionRecord, 'important' | 'note'>> = {}
): PartyBook {
  const trimmed = name.trim();
  if (!trimmed) throw new CoreError('INVALID_ARGUMENT', '配角名不能为空');
  const next = clone(book);
  let companion = next.companions.find((item) => item.name === trimmed);
  if (!companion) {
    companion = { name: trimmed };
    next.companions.push(companion);
  }
  if (chapter !== undefined && chapter >= (companion.lastSeenChapter ?? -1)) {
    companion.lastSeenChapter = chapter;
  }
  if (patch.important !== undefined) {
    if (patch.important) companion.important = true;
    else delete companion.important;
  }
  if (patch.note !== undefined) {
    if (patch.note) companion.note = patch.note;
    else delete companion.note;
  }
  return next;
}

/** 某角色曾经所在的队伍 */
export function partiesOf(book: PartyBook, name: string): PartyRecord[] {
  return book.parties.filter((party) => party.members.includes(name));
}

/** 记忆库中出现过的最新章节（用于计算「多少章没出场」） */
export function latestKnownChapter(
  book: PartyBook,
  sheets: GrowthSheet[] = [],
  atlas?: Atlas
): number {
  let latest = 0;
  for (const party of book.parties) {
    latest = Math.max(latest, party.fromChapter ?? 0, party.toChapter ?? 0);
  }
  for (const companion of book.companions)
    latest = Math.max(latest, companion.lastSeenChapter ?? 0);
  for (const sheet of sheets) latest = Math.max(latest, latestChapterOfSheet(sheet));
  for (const location of atlas?.locations ?? []) {
    latest = Math.max(latest, location.firstChapter ?? 0);
    for (const visit of location.visits) latest = Math.max(latest, visit.chapter ?? 0);
  }
  return latest;
}

/**
 * 把角色卡事件与地图到访也视为「出场」：返回 lastSeenChapter 被推进后的副本。
 * 这样主角/配角只要在任意记录里出现过，就不会被误报为被遗忘。
 */
export function withObservedAppearances(
  book: PartyBook,
  sheets: GrowthSheet[] = [],
  atlas?: Atlas
): PartyBook {
  const next = clone(book);
  const bump = (name: string, chapter: number) => {
    const companion = next.companions.find((item) => item.name === name);
    if (companion && chapter > (companion.lastSeenChapter ?? -1))
      companion.lastSeenChapter = chapter;
  };
  for (const sheet of sheets) {
    const latest = latestChapterOfSheet(sheet);
    if (latest <= 0) continue;
    for (const name of [sheet.name, ...sheet.aliases]) bump(name, latest);
  }
  for (const location of atlas?.locations ?? []) {
    for (const visit of location.visits) {
      if (visit.chapter !== undefined) bump(visit.character, visit.chapter);
    }
  }
  return next;
}

/**
 * 被遗忘的配角：超过 threshold 章没有出场的配角（重点配角优先）。
 * 仍在队伍中（未解散）的成员也会被检查——队友长期不露面同样是遗忘。
 */
export function detectForgottenCompanions(
  book: PartyBook,
  currentChapter: number,
  threshold: number
): ForgottenCompanion[] {
  const result: ForgottenCompanion[] = [];
  for (const companion of book.companions) {
    if (companion.lastSeenChapter === undefined) continue;
    const absent = currentChapter - companion.lastSeenChapter;
    if (absent < threshold) continue;
    result.push({
      name: companion.name,
      lastSeenChapter: companion.lastSeenChapter,
      chaptersAbsent: absent,
      important: companion.important === true,
      parties: partiesOf(book, companion.name).map((party) => party.name),
    });
  }
  return result.sort(
    (a, b) => Number(b.important) - Number(a.important) || b.chaptersAbsent - a.chaptersAbsent
  );
}

// ─── 地图 ───────────────────────────────────────────────────────────────────

export function findLocation(atlas: Atlas, ref: string): LocationRecord | undefined {
  const key = ref.trim();
  return atlas.locations.find((item) => item.id === key || item.name === key);
}

export interface AddLocationInput {
  name: string;
  region?: string;
  parent?: string;
  description?: string;
  firstChapter?: number;
}

export function addLocation(atlas: Atlas, input: AddLocationInput): Atlas {
  const name = input.name.trim();
  if (!name) throw new CoreError('INVALID_ARGUMENT', '地点名不能为空');
  if (findLocation(atlas, name)) throw new CoreError('ALREADY_EXISTS', `地点已存在: ${name}`);
  if (input.parent && !findLocation(atlas, input.parent)) {
    throw new CoreError('NOT_FOUND', `上级地点不存在: ${input.parent}`);
  }
  const next = clone(atlas);
  next.locations.push({
    id: uniqueId(slugifyId(name, 'loc'), new Set(next.locations.map((loc) => loc.id))),
    name,
    ...(input.region ? { region: input.region } : {}),
    ...(input.parent ? { parent: input.parent } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.firstChapter !== undefined ? { firstChapter: input.firstChapter } : {}),
    visits: [],
  });
  return next;
}

/** 记录角色到访某地（地点不存在时自动创建） */
export function recordVisit(
  atlas: Atlas,
  locationName: string,
  character: string,
  chapter?: number,
  note?: string
): Atlas {
  const next = findLocation(atlas, locationName)
    ? clone(atlas)
    : addLocation(atlas, { name: locationName, firstChapter: chapter });
  const location = findLocation(next, locationName);
  if (!location) throw new CoreError('NOT_FOUND', `地点不存在: ${locationName}`);
  const name = character.trim();
  if (!name) throw new CoreError('INVALID_ARGUMENT', '角色名不能为空');
  location.visits.push({
    character: name,
    ...(chapter !== undefined ? { chapter } : {}),
    ...(note ? { note } : {}),
  });
  if (
    chapter !== undefined &&
    (location.firstChapter === undefined || chapter < location.firstChapter)
  ) {
    location.firstChapter = chapter;
  }
  return next;
}

export function removeLocation(atlas: Atlas, ref: string): Atlas {
  const location = findLocation(atlas, ref);
  if (!location) throw new CoreError('NOT_FOUND', `地点不存在: ${ref}`);
  const next = clone(atlas);
  next.locations = next.locations.filter((item) => item.id !== location.id);
  return next;
}

/** 某角色的足迹（按章节排序） */
export function footprintsOf(
  atlas: Atlas,
  character: string
): Array<{ location: string; chapter?: number; note?: string }> {
  const result: Array<{ location: string; chapter?: number; note?: string }> = [];
  for (const location of atlas.locations) {
    for (const visit of location.visits) {
      if (visit.character !== character) continue;
      result.push({
        location: location.name,
        ...(visit.chapter !== undefined ? { chapter: visit.chapter } : {}),
        ...(visit.note ? { note: visit.note } : {}),
      });
    }
  }
  return result.sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
}
