import { ipcMain } from 'electron';
import { novelOps, storyIdeaOps } from '@novel-editor/store';

type StoryIdeaCardSource = 'manual' | 'ai';
type StoryIdeaCardStatus =
  | 'draft'
  | 'exploring'
  | 'shortlisted'
  | 'promoted_to_board'
  | 'promoted_to_outline'
  | 'archived';
type StoryIdeaOutputType = 'logline' | 'scene_hook' | 'outline_direction';

/** 三签创意卡与候选输出 */
export function registerStoryIdeaHandlers(): void {
  // ─── Story Idea / 三签创作法 ───────────────────────────────────────────

  ipcMain.handle('db-story-idea-card-list-by-folder', (_event, folderPath: string) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) return [];
    return storyIdeaOps.listCardsByNovel(novel.id);
  });

  ipcMain.handle(
    'db-story-idea-card-create-by-folder',
    (
      _event,
      folderPath: string,
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
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法创建三签创意卡');
      }
      return storyIdeaOps.createCard(novel.id, payload);
    }
  );

  ipcMain.handle(
    'db-story-idea-card-update',
    (
      _event,
      cardId: number,
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
    ) => storyIdeaOps.updateCard(cardId, fields)
  );

  ipcMain.handle('db-story-idea-card-delete', (_event, cardId: number) => {
    return storyIdeaOps.deleteCard(cardId);
  });

  ipcMain.handle('db-story-idea-output-list', (_event, cardId: number) => {
    return storyIdeaOps.listOutputsByCard(cardId);
  });

  ipcMain.handle(
    'db-story-idea-output-replace-by-folder',
    (
      _event,
      folderPath: string,
      cardId: number,
      type: StoryIdeaOutputType,
      outputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法保存三签候选');
      }
      return storyIdeaOps.replaceOutputs(novel.id, cardId, type, outputs);
    }
  );

  ipcMain.handle(
    'db-story-idea-output-update',
    (
      _event,
      outputId: number,
      fields: { content?: string; meta_json?: string; sort_order?: number; is_selected?: number }
    ) => storyIdeaOps.updateOutput(outputId, fields)
  );

  ipcMain.handle('db-story-idea-output-select', (_event, outputId: number) => {
    return storyIdeaOps.selectOutput(outputId);
  });

  ipcMain.handle('db-story-idea-output-delete', (_event, outputId: number) => {
    return storyIdeaOps.deleteOutput(outputId);
  });
}
