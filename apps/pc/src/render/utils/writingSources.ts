/**
 * 续写上下文的资料来源（当前作品）：人物卡、成长档案与核心规则、当前章章纲
 *
 * 纯函数负责转换；loadWritingSources 经已有 IPC（growth-load / db-outline-list-by-folder）读取，
 * 任何一项失败都只是少带一部分上下文，不影响续写。
 */
import type { ContextCharacter } from '@novel-editor/ai/context';
import { coreRuleTexts, summarizeSheetForContext } from '@novel-editor/core/growth';
import { CHARACTER_DESIGN_FIELDS, parseCharacterDesign } from '@novel-editor/core/entity-media';
import type { Character } from '../components/RightPanel/types';
import type { GrowthIpcResult, GrowthSnapshot } from '../types/growth-api';
import type { PersistedOutlineRow, PersistedOutlineScopeInput } from '../types/electron-api';
import type { WritingSources } from './continuationService';

const OUTLINE_LINE_MAX = 120;

export function charactersForContext(characters: readonly Character[]): ContextCharacter[] {
  return characters
    .filter((item) => item.name.trim())
    .map((item) => {
      // 人物设计（外貌 / 服装 / 性格 / 背景 / 说话方式）让续写不跑偏人设
      const design = parseCharacterDesign(item.design);
      const designText = CHARACTER_DESIGN_FIELDS.filter(({ key }) => design[key])
        .map(({ key, label }) => `${label}：${design[key].replace(/\s+/g, ' ')}`)
        .join('；');
      const summary = [item.role.trim(), item.description.replace(/\s+/g, ' ').trim(), designText]
        .filter(Boolean)
        .join('；');
      const status = item.currentState
        .slice(-2)
        .map((state) => `${state.label}：${state.value}`)
        .join('；');
      return {
        name: item.name.trim(),
        aliases: item.aliases ?? [],
        ...(summary ? { summary } : {}),
        ...(status ? { status } : {}),
      };
    });
}

export function growthForContext(
  snapshot: GrowthSnapshot | null
): Pick<WritingSources, 'growth' | 'rules'> {
  if (!snapshot?.initialized) return { growth: [], rules: [] };
  return {
    growth: snapshot.sheets.map((sheet) => summarizeSheetForContext(sheet, snapshot.ruleset)),
    rules: coreRuleTexts(snapshot.ruleset),
  };
}

/** 章纲行 → 「标题：内容」要点（按层级与顺序） */
export function outlineForContext(rows: readonly PersistedOutlineRow[]): string[] {
  const children = new Map<number | null, PersistedOutlineRow[]>();
  for (const row of rows) {
    const list = children.get(row.parent_id) ?? [];
    list.push(row);
    children.set(row.parent_id, list);
  }
  const result: string[] = [];
  const visit = (parentId: number | null, depth: number) => {
    const list = (children.get(parentId) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    for (const row of list) {
      const title = row.title.trim();
      const content = row.content.replace(/\s+/g, ' ').trim();
      const line = [title, content].filter(Boolean).join('：');
      if (line) {
        const text = Array.from(line);
        const clipped =
          text.length > OUTLINE_LINE_MAX ? `${text.slice(0, OUTLINE_LINE_MAX).join('')}…` : line;
        result.push(`${depth > 0 ? '  '.repeat(depth) : ''}${clipped}`);
      }
      if (depth < 3) visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export function chapterTitleFromPath(filePath: string | null): string | undefined {
  if (!filePath) return undefined;
  const base = filePath.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || undefined;
}

export interface WritingSourcesIpc {
  invoke(channel: 'growth-load', folderPath: string): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'db-outline-list-by-folder',
    folderPath: string,
    scope?: PersistedOutlineScopeInput
  ): Promise<PersistedOutlineRow[]>;
}

export interface LoadWritingSourcesInput {
  ipc: WritingSourcesIpc;
  workPath: string | null;
  filePath: string | null;
  characters: readonly Character[];
  dbReady: boolean;
}

export async function loadWritingSources({
  ipc,
  workPath,
  filePath,
  characters,
  dbReady,
}: LoadWritingSourcesInput): Promise<WritingSources> {
  const [snapshot, outlineRows] = await Promise.all([
    workPath
      ? ipc
          .invoke('growth-load', workPath)
          .then((result) => (result.ok ? result.data : null))
          .catch(() => null)
      : Promise.resolve(null),
    workPath && filePath && dbReady
      ? ipc
          .invoke('db-outline-list-by-folder', workPath, { kind: 'chapter', path: filePath })
          .catch(() => [] as PersistedOutlineRow[])
      : Promise.resolve([] as PersistedOutlineRow[]),
  ]);
  return {
    chapterTitle: chapterTitleFromPath(filePath),
    outline: outlineForContext(Array.isArray(outlineRows) ? outlineRows : []),
    characters: charactersForContext(characters),
    ...growthForContext(snapshot),
  };
}
