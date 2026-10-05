import { getDatabase } from './connection';
import {
  STORY_IDEA_CARD_SOURCES,
  STORY_IDEA_CARD_STATUSES,
  STORY_IDEA_OUTPUT_TYPES,
} from './types';
import type {
  StoryIdeaCardRow,
  StoryIdeaCardSource,
  StoryIdeaCardStatus,
  StoryIdeaOutputRow,
  StoryIdeaOutputType,
} from './types';

/** 三签创作法 */
export const storyIdeaOps = {
  listCardsByNovel(novelId: number) {
    return getDatabase()
      .prepare(
        `SELECT * FROM story_idea_cards
         WHERE novel_id = ?
         ORDER BY datetime(updated_at) DESC, id DESC`
      )
      .all(novelId) as StoryIdeaCardRow[];
  },

  getCardById(id: number) {
    return getDatabase().prepare('SELECT * FROM story_idea_cards WHERE id = ?').get(id) as
      | StoryIdeaCardRow
      | undefined;
  },

  createCard(
    novelId: number,
    payload: {
      title: string;
      premise?: string;
      tagsJson?: string;
      source?: StoryIdeaCardSource;
      status?: StoryIdeaCardStatus;
      themeSeed?: string;
      conflictSeed?: string;
      twistSeed?: string;
      protagonistWish?: string;
      coreObstacle?: string;
      ironyOrGap?: string;
      escalationPath?: string;
      payoffHint?: string;
      selectedLogline?: string;
      selectedDirection?: string;
      note?: string;
    }
  ) {
    const source = payload.source ?? 'manual';
    const status = payload.status ?? 'draft';
    if (!STORY_IDEA_CARD_SOURCES.includes(source)) {
      throw new Error(`Unsupported story idea source: ${source}`);
    }
    if (!STORY_IDEA_CARD_STATUSES.includes(status)) {
      throw new Error(`Unsupported story idea status: ${status}`);
    }
    return getDatabase()
      .prepare(
        `INSERT INTO story_idea_cards (
          novel_id, title, premise, tags_json, source, status,
          theme_seed, conflict_seed, twist_seed,
          protagonist_wish, core_obstacle, irony_or_gap,
          escalation_path, payoff_hint,
          selected_logline, selected_direction, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        novelId,
        payload.title,
        payload.premise || '',
        payload.tagsJson || '[]',
        source,
        status,
        payload.themeSeed || '',
        payload.conflictSeed || '',
        payload.twistSeed || '',
        payload.protagonistWish || '',
        payload.coreObstacle || '',
        payload.ironyOrGap || '',
        payload.escalationPath || '',
        payload.payoffHint || '',
        payload.selectedLogline || '',
        payload.selectedDirection || '',
        payload.note || ''
      );
  },

  updateCard(
    id: number,
    fields: {
      title?: string;
      premise?: string;
      tags_json?: string;
      source?: StoryIdeaCardSource;
      status?: StoryIdeaCardStatus;
      theme_seed?: string;
      conflict_seed?: string;
      twist_seed?: string;
      protagonist_wish?: string;
      core_obstacle?: string;
      irony_or_gap?: string;
      escalation_path?: string;
      payoff_hint?: string;
      selected_logline?: string;
      selected_direction?: string;
      note?: string;
    }
  ) {
    const ALLOWED_COLS = new Set([
      'title',
      'premise',
      'tags_json',
      'source',
      'status',
      'theme_seed',
      'conflict_seed',
      'twist_seed',
      'protagonist_wish',
      'core_obstacle',
      'irony_or_gap',
      'escalation_path',
      'payoff_hint',
      'selected_logline',
      'selected_direction',
      'note',
    ]);
    const updates: string[] = [];
    const values: Array<string | number> = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || !ALLOWED_COLS.has(key)) {
        continue;
      }
      if (key === 'source' && !STORY_IDEA_CARD_SOURCES.includes(val as StoryIdeaCardSource)) {
        throw new Error(`Unsupported story idea source: ${String(val)}`);
      }
      if (key === 'status' && !STORY_IDEA_CARD_STATUSES.includes(val as StoryIdeaCardStatus)) {
        throw new Error(`Unsupported story idea status: ${String(val)}`);
      }
      updates.push(`${key} = ?`);
      values.push(val as string | number);
    }
    if (updates.length === 0) {
      return { changes: 0 };
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE story_idea_cards SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  deleteCard(id: number) {
    return getDatabase().prepare('DELETE FROM story_idea_cards WHERE id = ?').run(id);
  },

  listOutputsByCard(ideaCardId: number) {
    return getDatabase()
      .prepare(
        `SELECT * FROM story_idea_outputs
         WHERE idea_card_id = ?
         ORDER BY type, sort_order, id`
      )
      .all(ideaCardId) as StoryIdeaOutputRow[];
  },

  replaceOutputs(
    novelId: number,
    ideaCardId: number,
    type: StoryIdeaOutputType,
    outputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
  ) {
    if (!STORY_IDEA_OUTPUT_TYPES.includes(type)) {
      throw new Error(`Unsupported story idea output type: ${type}`);
    }
    const database = getDatabase();
    const deleteStmt = database.prepare(
      'DELETE FROM story_idea_outputs WHERE idea_card_id = ? AND type = ?'
    );
    const insertStmt = database.prepare(
      `INSERT INTO story_idea_outputs (
        idea_card_id, novel_id, type, content, meta_json, sort_order, is_selected
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const transaction = database.transaction(() => {
      deleteStmt.run(ideaCardId, type);
      outputs.forEach((output, index) => {
        insertStmt.run(
          ideaCardId,
          novelId,
          type,
          output.content,
          output.metaJson || '{}',
          index,
          output.isSelected ? 1 : 0
        );
      });
    });
    transaction();
    return { changes: outputs.length };
  },

  updateOutput(
    id: number,
    fields: { content?: string; meta_json?: string; sort_order?: number; is_selected?: number }
  ) {
    const ALLOWED_COLS = new Set(['content', 'meta_json', 'sort_order', 'is_selected']);
    const updates: string[] = [];
    const values: Array<string | number> = [];
    for (const [key, val] of Object.entries(fields)) {
      if (val === undefined || !ALLOWED_COLS.has(key)) {
        continue;
      }
      updates.push(`${key} = ?`);
      values.push(val as string | number);
    }
    if (updates.length === 0) {
      return { changes: 0 };
    }
    updates.push("updated_at = datetime('now')");
    values.push(id);
    return getDatabase()
      .prepare(`UPDATE story_idea_outputs SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  clearOutputSelection(ideaCardId: number, type: StoryIdeaOutputType) {
    if (!STORY_IDEA_OUTPUT_TYPES.includes(type)) {
      throw new Error(`Unsupported story idea output type: ${type}`);
    }
    return getDatabase()
      .prepare(
        `UPDATE story_idea_outputs
         SET is_selected = 0, updated_at = datetime('now')
         WHERE idea_card_id = ? AND type = ?`
      )
      .run(ideaCardId, type);
  },

  selectOutput(id: number) {
    const row = getDatabase()
      .prepare('SELECT idea_card_id, type FROM story_idea_outputs WHERE id = ?')
      .get(id) as { idea_card_id: number; type: StoryIdeaOutputType } | undefined;
    if (!row) {
      return { changes: 0 };
    }
    const database = getDatabase();
    const transaction = database.transaction(() => {
      database
        .prepare(
          `UPDATE story_idea_outputs
           SET is_selected = 0, updated_at = datetime('now')
           WHERE idea_card_id = ? AND type = ?`
        )
        .run(row.idea_card_id, row.type);
      database
        .prepare(
          `UPDATE story_idea_outputs
           SET is_selected = 1, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(id);
    });
    transaction();
    return { changes: 1 };
  },

  deleteOutput(id: number) {
    return getDatabase().prepare('DELETE FROM story_idea_outputs WHERE id = ?').run(id);
  },
};
