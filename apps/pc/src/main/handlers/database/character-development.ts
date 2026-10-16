import type { EnrichmentExtras } from '@novel-editor/core/character-enrichment';
import { PROFILE_FIELDS, type ProfileApplyRequest } from '@novel-editor/core/character-discovery';
import { BrowserWindow } from 'electron';
import { characterOps, novelOps } from '@novel-editor/store';
import {
  parseDevelopmentEntry,
  type DevelopmentChange,
} from '@novel-editor/core/character-development';
import { assertPathAccess } from '../../path-access';
import { registerWorkspaceHandler } from '../../workspace-ipc';

/** 条目级比较并写入，避免 AI、人物页面及其他窗口互相覆盖。 */
export function registerCharacterDevelopmentHandlers(): void {
  registerWorkspaceHandler('db-character-list-by-folder', async (event, workPath: string) => {
    const root = await assertPathAccess(event.sender.id, workPath);
    const novel = novelOps.getByFolder(root) as { id: number } | undefined;
    return novel ? characterOps.getByNovel(novel.id) : [];
  });
  registerWorkspaceHandler(
    'db-character-patch-profile-draft',
    async (
      event,
      workPath: string,
      characterId: number,
      patch: Record<string, string>,
      expected: Record<string, string>,
      extras: EnrichmentExtras = {}
    ) => {
      const root = await assertPathAccess(event.sender.id, workPath, true);
      if (
        !Number.isSafeInteger(characterId) ||
        characterId <= 0 ||
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch) ||
        !expected ||
        typeof expected !== 'object' ||
        Array.isArray(expected) ||
        Object.entries(patch).some(
          ([key, value]) =>
            !PROFILE_FIELDS.some((field) => field.key === key) ||
            typeof value !== 'string' ||
            value.length > 800 ||
            typeof expected[key] !== 'string' ||
            expected[key].length > 800
        )
      )
        throw new Error('人物表单字段无效');
      const novel = novelOps.getByFolder(root) as { id: number } | undefined;
      if (
        !novel ||
        !(characterOps.getByNovel(novel.id) as { id: number }[]).some((c) => c.id === characterId)
      )
        throw new Error('作品或人物已切换，请重新打开后保存');
      if (!extras || typeof extras !== 'object' || Array.isArray(extras))
        throw new Error('人物草稿参数无效');
      const groups = [{ section: 'design', patch, expected }];
      for (const section of ['voice', 'development'] as const) {
        const values = extras[section];
        const before = extras[section === 'voice' ? 'voiceExpected' : 'developmentExpected'];
        if (values === undefined && before === undefined) continue;
        if (
          !values ||
          typeof values !== 'object' ||
          Array.isArray(values) ||
          !before ||
          typeof before !== 'object' ||
          Array.isArray(before) ||
          Object.keys(values).length > 300
        )
          throw new Error('人物草稿格式无效');
        for (const [key, value] of Object.entries(values)) {
          if (typeof value !== 'string' || typeof before[key] !== 'string')
            throw new Error('人物草稿内容无效');
          if (section === 'voice') {
            const limit = key === 'age' ? 20 : key === 'timbre' ? 60 : key === 'gender' ? 7 : 0;
            if (
              !limit ||
              value.length > limit ||
              before[key].length > limit ||
              (key === 'gender' && !['', 'male', 'female', 'neutral'].includes(value))
            )
              throw new Error('人物基础信息无效');
          } else {
            if (
              !/^[\w:-]{1,100}$/.test(key) ||
              value.length > 300000 ||
              before[key].length > 300000
            )
              throw new Error('人物设定条目无效');
            if (value) {
              let entry;
              try {
                entry = parseDevelopmentEntry(JSON.parse(value));
              } catch {
                throw new Error('人物设定内容无效');
              }
              if (!entry || entry.id !== key) throw new Error('人物设定内容无效');
              values[key] = JSON.stringify(entry);
            }
          }
        }
        groups.push({ section, patch: values, expected: before });
      }
      characterOps.patchAttributeGroups(characterId, groups);
      const result = patch;
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed())
          window.webContents.send('character-development-updated', root, characterId);
      return result;
    }
  );
  registerWorkspaceHandler(
    'db-character-apply-profile',
    async (event, workPath: string, input: ProfileApplyRequest) => {
      const root = await assertPathAccess(event.sender.id, workPath, true);
      const validText = (value: unknown, max: number): value is string =>
        typeof value === 'string' && value.length <= max;
      if (
        !input ||
        typeof input !== 'object' ||
        (input.characterId !== null &&
          (!Number.isSafeInteger(input.characterId) || input.characterId <= 0)) ||
        !validText(input.name, 100) ||
        !input.name.trim() ||
        !validText(input.summary, 1500) ||
        !validText(input.chapter, 1000) ||
        !validText(input.quote, 1200) ||
        !['text', 'idea'].includes(input.source) ||
        !Array.isArray(input.changes) ||
        input.changes.length > PROFILE_FIELDS.length ||
        (input.characterId !== null && !input.changes.length)
      )
        throw new Error('人物建议参数无效');
      const keys = new Set<string>();
      for (const change of input.changes) {
        if (
          !change ||
          !PROFILE_FIELDS.some((f) => f.key === change.key) ||
          keys.has(change.key) ||
          !validText(change.value, 800) ||
          !change.value.trim() ||
          !validText(change.expected, 800) ||
          !validText(change.quote, 1200)
        )
          throw new Error('人物建议字段无效');
        keys.add(change.key);
      }
      const novel = novelOps.getByFolder(root) as { id: number } | undefined;
      if (!novel) throw new Error('未找到当前作品，请重新打开作品后重试');
      const result = characterOps.applyProfileSuggestion(novel.id, input);
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed())
          window.webContents.send('character-development-updated', root, result.characterId);
      return result;
    }
  );
  registerWorkspaceHandler(
    'db-character-patch-development',
    async (event, workPath: string, characterId: number, changes: DevelopmentChange[]) => {
      const root = await assertPathAccess(event.sender.id, workPath, true);
      if (
        !Number.isSafeInteger(characterId) ||
        characterId <= 0 ||
        !Array.isArray(changes) ||
        changes.length < 1 ||
        changes.length > 300
      )
        throw new Error('人物设定参数无效');
      const novel = novelOps.getByFolder(root) as { id: number } | undefined;
      if (
        !novel ||
        !(characterOps.getByNovel(novel.id) as { id: number }[]).some((c) => c.id === characterId)
      )
        throw new Error('作品或人物已切换，请重新打开人物后保存');
      const patch: Record<string, string> = Object.create(null);
      const expected: Record<string, string> = Object.create(null);
      for (const change of changes) {
        if (
          !change ||
          typeof change.id !== 'string' ||
          !/^[\w:-]{1,100}$/.test(change.id) ||
          typeof change.expected !== 'string' ||
          change.expected.length > 300000 ||
          Object.hasOwn(patch, change.id)
        )
          throw new Error('人物设定条目无效');
        const entry = change.entry === null ? null : parseDevelopmentEntry(change.entry);
        if (change.entry !== null && (!entry || entry.id !== change.id))
          throw new Error('人物设定内容无效');
        const value = entry ? JSON.stringify(entry) : '';
        if (value.length > 300000) throw new Error('此条目的记录过长，请拆分为多个条目');
        patch[change.id] = value;
        expected[change.id] = change.expected;
      }
      const result = characterOps.patchAttributeFields(characterId, 'development', patch, expected);
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed())
          window.webContents.send('character-development-updated', root, characterId);
      return result;
    }
  );
}
