/**
 * 「生成卷纲」：一句话意图 → 每幕说明 + 每章建议节拍
 * - 未开启 AI：按结构模板确定性生成（buildTemplatePlan）
 * - 开启 AI：buildVolumePlanPrompt 组装提示词，parseVolumePlanResponse 解析 JSON，失败时回退模板
 */
import { STRUCTURE_TEMPLATES, allocateChapters, pickStructureByChapterCount } from './structures';
import type { VolumeOutline } from './types';

export interface GeneratedVolumePlan {
  actNotes: Record<string, string>;
  suggestions: Record<string, string[]>;
}

function fileBase(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** 按幕的位置映射到模板段落（按正文标记分幕时也能得到提示） */
function stageHintFor(outline: VolumeOutline, actIndex: number): string {
  const act = outline.acts[actIndex];
  if (act.hint) return act.hint;
  const template = STRUCTURE_TEMPLATES[pickStructureByChapterCount(outline.acts.length)];
  const sizes = allocateChapters(
    outline.acts.length,
    template.stages.map((stage) => stage.weight)
  );
  let cursor = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    cursor += sizes[i];
    if (actIndex < cursor) return template.stages[i].hint;
  }
  return template.stages[template.stages.length - 1].hint;
}

/** 确定性生成：意图 + 结构模板 → 幕说明与章节建议，不调用 AI */
export function buildTemplatePlan(outline: VolumeOutline, intent: string): GeneratedVolumePlan {
  const goal = intent.trim();
  const actNotes: Record<string, string> = {};
  const suggestions: Record<string, string[]> = {};
  const lastIndex = outline.acts.length - 1;
  outline.acts.forEach((act, actIndex) => {
    const hint = stageHintFor(outline, actIndex);
    if (goal && actIndex === 0) actNotes[act.key] = `起点：${goal}。${hint}`;
    else if (goal && actIndex === lastIndex) actNotes[act.key] = `落点：回应「${goal}」。${hint}`;
    else actNotes[act.key] = hint;

    act.chapters.forEach((chapter, chapterIndex) => {
      // 已有场景 / 章纲的章节不打扰，只给空白或只有开篇句的章节补建议
      if (chapter.continued || chapter.beats.some((beat) => beat.source !== 'opening')) return;
      const isFirst = chapterIndex === 0;
      const isLast = chapterIndex === act.chapters.length - 1;
      const line = isFirst
        ? `开场：${hint.split(/[，,]/)[0]}`
        : isLast
          ? '收束本段，留下通往下一段的钩子'
          : '推进：加深冲突，或让一段关系发生变化';
      suggestions[chapter.path] = [line];
    });
  });
  return { actNotes, suggestions };
}

export interface VolumePlanPrompt {
  prompt: string;
  systemPrompt: string;
  context: string;
}

/** AI 提示词：附带当前推导出的幕 / 章 / 节拍，要求只返回 JSON */
export function buildVolumePlanPrompt(
  outline: VolumeOutline,
  intent: string,
  characters: string[] = []
): VolumePlanPrompt {
  const structureText = outline.acts
    .map((act) => {
      const chapters = act.chapters
        .map((chapter) => {
          const beats = chapter.beats
            .slice(0, 6)
            .map((beat) => [beat.title, beat.text].filter(Boolean).join('：'))
            .join('；');
          return `  - ${fileBase(chapter.path)}（${chapter.title}）${beats ? `：${beats}` : ''}`;
        })
        .join('\n');
      return `[${act.key}] ${act.title}${act.hint ? `（${act.hint}）` : ''}\n${chapters}`;
    })
    .join('\n');
  return {
    systemPrompt: '你是专业的网文 / 剧本策划编辑，输出简洁、具体、可执行的中文建议，只返回 JSON。',
    prompt: [
      `这一卷想写：${intent.trim() || '（作者未填写，请根据现有章节推断）'}`,
      `结构：${outline.structureLabel}，共 ${outline.chapterCount} 章。`,
      '请为每一幕写一句话说明（这一段要完成什么），并为每章给出 1-3 个关键节拍（每条不超过 30 字）。',
      '只返回 JSON：{"acts":[{"key":"幕的 key","note":"一句话"}],"chapters":[{"file":"章节文件名","beats":["节拍"]}]}',
    ].join('\n'),
    context: [
      `当前卷纲：\n${structureText}${outline.chapterCount === 0 ? '\n（本卷还没有章节，请按结构给出每段说明）' : ''}`,
      characters.length > 0 ? `主要人物：${characters.slice(0, 12).join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析 AI 返回；幕按 key（或标题）匹配，章节按文件名（或标题）匹配；没有任何可用内容时返回 null */
export function parseVolumePlanResponse(
  text: string,
  outline: VolumeOutline
): GeneratedVolumePlan | null {
  const data = extractJson(text);
  if (!isRecord(data)) return null;
  const actNotes: Record<string, string> = {};
  const suggestions: Record<string, string[]> = {};

  const acts = Array.isArray(data.acts) ? data.acts : [];
  acts.forEach((item, index) => {
    if (!isRecord(item) || typeof item.note !== 'string' || !item.note.trim()) return;
    const key = typeof item.key === 'string' ? item.key : '';
    const title = typeof item.title === 'string' ? item.title : '';
    const act =
      outline.acts.find((candidate) => candidate.key === key) ||
      outline.acts.find((candidate) => title && candidate.title === title) ||
      (!key && !title ? outline.acts[index] : undefined);
    if (act) actNotes[act.key] = item.note.trim();
  });

  const chapterPaths = new Map<string, string>();
  outline.acts.forEach((act) =>
    act.chapters.forEach((chapter) => {
      chapterPaths.set(fileBase(chapter.path), chapter.path);
      chapterPaths.set(chapter.title, chapter.path);
    })
  );
  const chapters = Array.isArray(data.chapters) ? data.chapters : [];
  chapters.forEach((item) => {
    if (!isRecord(item) || !Array.isArray(item.beats)) return;
    const file = typeof item.file === 'string' ? item.file.trim() : '';
    const path = chapterPaths.get(file) || chapterPaths.get(file.replace(/\.[^.]+$/, ''));
    if (!path) return;
    const beats = item.beats
      .filter((beat): beat is string => typeof beat === 'string' && Boolean(beat.trim()))
      .map((beat) => beat.trim())
      .slice(0, 3);
    if (beats.length > 0) suggestions[path] = beats;
  });

  if (Object.keys(actNotes).length === 0 && Object.keys(suggestions).length === 0) return null;
  return { actNotes, suggestions };
}
