import { registerWorkspaceHandler } from '../workspace-ipc';
/**
 * 记忆资料同步 IPC Handler（建议 2：记忆资料单独放个文件夹）
 *
 * 把 SQLite 中的人物卡（characters）与设定（world_settings）导出为
 * `<folder>/资料/记忆/角色卡/*.md`、`<folder>/资料/记忆/设定/*.md` 只读快照，
 * 让作者、CLI 与 AI agent 不打开数据库也能查阅全部记忆资料。
 */
import {
  syncMemorySnapshots,
  type CharacterSnapshotInput,
  type SettingSnapshotInput,
} from '@novel-editor/core';
import { characterOps, novelOps, worldSettingOps } from '@novel-editor/store';
import { assertFolder, guard } from './growth';

const LORE_CATEGORY_LABELS: Record<string, string> = {
  world: '世界观',
  faction: '势力',
  system: '体系',
  term: '术语',
};

interface CharacterRow {
  name?: unknown;
  role?: unknown;
  description?: unknown;
  attributes?: unknown;
}

interface WorldSettingRow {
  title?: unknown;
  category?: unknown;
  content?: unknown;
  tags?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** 数据库人物行 → 快照输入（attributes JSON 中的别名与当前状态） */
export function toCharacterSnapshot(row: CharacterRow): CharacterSnapshotInput {
  const attributes = parseJson(row.attributes);
  const record =
    typeof attributes === 'object' && attributes !== null
      ? (attributes as Record<string, unknown>)
      : {};
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.filter((item): item is string => typeof item === 'string' && !!item.trim())
    : [];
  const currentState = Array.isArray(record.currentState)
    ? record.currentState
        .map((item) => {
          if (typeof item !== 'object' || item === null) return null;
          const entry = item as Record<string, unknown>;
          const label = text(entry.label);
          const value = text(entry.value);
          return label && value ? { label, value } : null;
        })
        .filter((item): item is { label: string; value: string } => item !== null)
    : [];
  return {
    name: text(row.name),
    role: text(row.role) || undefined,
    description: text(row.description) || undefined,
    aliases,
    currentState,
  };
}

/** 数据库设定行 → 快照输入 */
export function toSettingSnapshot(row: WorldSettingRow): SettingSnapshotInput {
  const tags = parseJson(row.tags);
  const category = text(row.category);
  return {
    title: text(row.title),
    category: LORE_CATEGORY_LABELS[category] ?? (category || undefined),
    content: text(row.content) || undefined,
    tags: Array.isArray(tags)
      ? tags.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export function registerMemoryHandlers(): void {
  registerWorkspaceHandler('memory-sync-snapshots', (_event, folderPath: unknown) =>
    guard(async () => {
      const root = await assertFolder(folderPath);
      const novel = (novelOps.getByFolder(folderPath as string) ?? novelOps.getByFolder(root)) as
        | { id: number }
        | undefined;
      const characters = novel ? (characterOps.getByNovel(novel.id) as CharacterRow[]) : [];
      const settings = novel ? (worldSettingOps.getByNovel(novel.id) as WorldSettingRow[]) : [];
      return syncMemorySnapshots(root, {
        characters: characters.map(toCharacterSnapshot),
        settings: settings.map(toSettingSnapshot),
      });
    })
  );
}
