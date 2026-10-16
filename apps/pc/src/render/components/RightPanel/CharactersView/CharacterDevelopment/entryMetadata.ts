import {
  developmentEntries,
  parseDevelopmentEntry,
  type DevelopmentEntry,
} from '@novel-editor/core/character-development';
import {
  developmentMetadataPrompt,
  enrichmentMetadata,
  type EnrichmentPerson,
} from '@novel-editor/core/character-enrichment';
import { parseAiJson } from '@novel-editor/core/character-discovery';
import { completeWithSignal } from '@/render/utils/completeWithSignal';

export async function resolveEntryMetadata(
  entry: DevelopmentEntry,
  person: EnrichmentPerson,
  signal: AbortSignal
) {
  const result = await completeWithSignal(
    {
      prompt: developmentMetadataPrompt(entry, person),
      temperature: 0.2,
      maxTokens: 1600,
      timeoutMs: 30000,
    },
    signal
  );
  if (!result.ok) throw new Error(result.error.message);
  return enrichmentMetadata(
    parseAiJson(result.data.text),
    entry,
    developmentEntries(person.development, person.design),
    person.chapters ?? []
  );
}

const jobs = new Map<string, AbortController>();
const jobKey = (workPath: string, characterId: number, entryId: string) =>
  JSON.stringify([workPath, characterId, entryId]);
export function cancelEntryMetadata(workPath: string, characterId: number, entryId: string) {
  jobs.get(jobKey(workPath, characterId, entryId))?.abort();
}

/** 保存后的独立后台任务；切换表单不取消，编辑同一条目则取消，落库仍比较完整旧值。 */
export function enrichSavedEntry(workPath: string, person: EnrichmentPerson, saved: string) {
  const entry = parseDevelopmentEntry(JSON.parse(saved));
  if (!entry) return;
  // 主进程写入时也按此解析器规范化字段顺序，草稿的原始 JSON 顺序可能不同。
  const expected = JSON.stringify(entry);
  const key = jobKey(workPath, person.id, entry.id);
  jobs.get(key)?.abort();
  const controller = new AbortController();
  jobs.set(key, controller);
  void (async () => {
    try {
      const metadata = await resolveEntryMetadata(entry, person, controller.signal);
      controller.signal.throwIfAborted();
      const next = { ...entry, ...metadata };
      if (JSON.stringify(next) === expected) return;
      await window.electron.ipcRenderer.invoke(
        'db-character-patch-development',
        workPath,
        person.id,
        [{ id: entry.id, expected, entry: next }]
      );
    } catch (error) {
      if (!controller.signal.aborted)
        console.warn('人物条目后台关联未完成，已保存的内容保留', error);
    } finally {
      if (jobs.get(key) === controller) jobs.delete(key);
    }
  })();
}
