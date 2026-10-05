import type { StoryIdeaCardDraft, StoryIdeaGenerationConfig, StoryIdeaTermSection } from './types';
import { STORY_IDEA_TERM_SECTION_LABELS } from './types';
import { getStoryIdeaTermsBySection } from './normalize';
import { cleanText } from './text';

function buildIdeaContext(content: string): string {
  const normalized = content.trim();
  if (!normalized) return '当前没有正文上下文，仅基于创意卡字段推演。';
  return `正文上下文（截断）:\n${normalized.slice(0, 5000)}`;
}

function buildStoryIdeaGenerationGuide(config?: StoryIdeaGenerationConfig): string {
  const scope = config?.scope || 'hybrid';
  const guidance = cleanText(config?.guidance, 160);
  const scopeText =
    scope === 'free'
      ? '创作范围：不要被当前正文束缚，可以大胆跳脱、联想、混搭。'
      : scope === 'anchored'
        ? '创作范围：尽量贴近当前正文语境、题材气质与已有信息，不要跳太远。'
        : '创作范围：优先参考当前正文，但允许为了创意张力进行适度跳脱。';
  return guidance ? `${scopeText}\n用户限定：${guidance}` : scopeText;
}

function buildIdeaContextByConfig(content: string, config?: StoryIdeaGenerationConfig): string {
  const scope = config?.scope || 'hybrid';
  const normalized = content.trim();
  if (!normalized) {
    return [
      buildStoryIdeaGenerationGuide(config),
      '当前没有正文上下文，仅基于创意卡字段推演。',
    ].join('\n');
  }
  if (scope === 'free') {
    return [
      buildStoryIdeaGenerationGuide(config),
      `可参考的正文线索（非强约束，截断）:\n${normalized.slice(0, 2200)}`,
    ].join('\n');
  }
  if (scope === 'anchored') {
    return [
      buildStoryIdeaGenerationGuide(config),
      `必须优先贴合的正文上下文（截断）:\n${normalized.slice(0, 5000)}`,
    ].join('\n');
  }
  return [buildStoryIdeaGenerationGuide(config), buildIdeaContext(content)].join('\n');
}

export function buildStoryIdeaSeedPrompt(
  draft: StoryIdeaCardDraft,
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  return [
    '请根据当前创意卡和正文上下文，补全或洗练“三签创作法”的签词。',
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    '字段必须包含：title, premise, tags, themeTerms, conflictTerms, twistTerms, note。',
    '要求：',
    '1. title 控制在 14 字内，像一个可记忆的故事命名。',
    '2. premise 是一句话故事假设，控制在 40 字内。',
    '3. tags 是 3-5 个中文标签数组。',
    '4. themeTerms / conflictTerms / twistTerms 各返回 3-5 个中文词语或短词组，偏“抽签词”，不要写成长句。',
    '5. 三组签词要能直接触发故事联想，避免空泛概念。',
    '6. note 写成一条简短的创作提示，指出这些签词适合往什么故事方向组合。',
    '7. 如果用户已填写的签词可用，优先在原意基础上洗练和补足，而不是完全推翻。',
    '',
    `当前创意卡：${JSON.stringify({
      title: draft.title,
      premise: draft.premise,
      tags: draft.tags,
      themeTerms: draft.themeTerms,
      conflictTerms: draft.conflictTerms,
      twistTerms: draft.twistTerms,
      note: draft.note,
    })}`,
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function buildStoryIdeaExtractPrompt(
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  return [
    '请生成一组适合“三签创作法”的签词。',
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    '字段必须包含：title, premise, tags, themeTerms, conflictTerms, twistTerms, note。',
    '要求：',
    '1. themeTerms / conflictTerms / twistTerms 各返回 3-5 个中文词语或短词组。',
    '2. themeTerms 偏题眼和气质，conflictTerms 偏对撞和代价，twistTerms 偏反差和翻面。',
    '3. premise 用一句话概括可以从这些签词延展出的故事假设。',
    '4. note 提示作者这些签词最值得往哪种题材或人物关系上发散。',
    '5. 尽量抽出有画面、有张力、能组合的词，不要抽象空话。',
    '6. 如果创作范围允许跳脱，不要只做摘要提炼，要主动给出更能激发创意的签词。',
    '',
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function buildStoryIdeaOutputsPrompt(
  draft: StoryIdeaCardDraft,
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  return [
    '请基于这张以“签词”为核心的三签创意卡，输出可供作者挑选的候选结果。',
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    'JSON 字段固定为：loglines, sceneHooks, outlineDirections。',
    '其中：',
    '1. loglines: 返回 3 条，每条为 {"content":"","reason":""}。',
    '2. sceneHooks: 返回 4 条，每条为 {"content":"","focus":""}。',
    '3. outlineDirections: 返回 2 条，每条为 {"title":"","summary":"","beats":[...],"outlineTree":[...]}。',
    '4. outlineTree 为大纲树数组；每个节点必须有 title，可选 content 和 children；最多 3 层。',
    '5. beats 保留 3-5 条，适合作者快速比较路线。',
    '6. 输出必须显式利用三组签词的组合张力，而不是泛泛生成套路剧情。',
    '',
    `创意卡：${JSON.stringify({
      title: draft.title,
      premise: draft.premise,
      tags: draft.tags,
      themeTerms: draft.themeTerms,
      conflictTerms: draft.conflictTerms,
      twistTerms: draft.twistTerms,
    })}`,
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}

export function buildStoryIdeaRelatedTermsPrompt(
  draft: StoryIdeaCardDraft,
  section: StoryIdeaTermSection,
  content: string,
  config?: StoryIdeaGenerationConfig
): string {
  const currentTerms = getStoryIdeaTermsBySection(draft, section);
  const sectionLabel = STORY_IDEA_TERM_SECTION_LABELS[section];
  return [
    `请围绕当前“三签创作法”创意卡，为“${sectionLabel}”随机补一批相关签词。`,
    '只返回 JSON 对象，不要解释，不要 Markdown。',
    'JSON 字段固定为：terms。',
    '要求：',
    '1. 返回 6-10 个中文词语或短词组，偏可抽取、可联想、可组合。',
    '2. 尽量与已有签词相关，但不要简单同义重复。',
    '3. 保持题材气质一致，尽量给出有画面感和转折性的词。',
    '4. 不要输出完整句子。',
    '',
    `当前创意卡：${JSON.stringify({
      title: draft.title,
      premise: draft.premise,
      tags: draft.tags,
      themeTerms: draft.themeTerms,
      conflictTerms: draft.conflictTerms,
      twistTerms: draft.twistTerms,
      targetSection: section,
      currentTerms,
    })}`,
    buildIdeaContextByConfig(content, config),
  ].join('\n');
}
