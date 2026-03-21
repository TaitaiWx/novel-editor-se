/**
 * 混合检索器 —— 大文件性能优化，结合章节摘要 + 关键词匹配 + TF-IDF 排序。
 *
 * 实现思路（PageIndex 启发）：
 *   1. 对每个章节生成摘要（首尾截取 + 关键名词提取）
 *   2. 构建倒排索引（关键词 → 章节列表）
 *   3. 查询时：关键词命中 + TF-IDF 评分 → 取 Top-K 章节
 *   4. 将 Top-K 章节内容拼接作为 AI 上下文（而非截断前 N 字）
 *
 * 设计原则：
 *   - 不依赖外部 embedding 模型，纯本地计算
 *   - 适合 160 万字规模，索引构建 O(n)，查询 O(k * m)
 *   - 可缓存复用（同一文件内容不变时）
 */

import { splitChapters, type Chapter } from './chapterSplitter';

// ─── 章节摘要 ──────────────────────────────────────────────────────────────

interface ChapterSummary {
  index: number;
  title: string;
  /** 章节开头截取（~200 字） */
  head: string;
  /** 章节结尾截取（~200 字） */
  tail: string;
  /** 章节字数 */
  charCount: number;
  /** 提取的关键词（去停用词后的高频词） */
  keywords: string[];
}

/** 每个章节预览截取的字符数 */
const SUMMARY_SLICE = 200;
/** 关键词提取：每个章节取前 N 个高频词 */
const TOP_KEYWORDS = 15;
/** 中文分词用的简易正则（连续汉字 2-6 字） */
const CN_WORD_RE = /[\u4e00-\u9fff]{2,6}/g;

/** 中文常见停用词 */
const STOP_WORDS = new Set([
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '他',
  '她',
  '它',
  '那',
  '被',
  '从',
  '把',
  '让',
  '用',
  '又',
  '什么',
  '没',
  '来',
  '而',
  '对',
  '以',
  '但',
  '还',
  '能',
  '可以',
  '这个',
  '那个',
  '他们',
  '她们',
  '我们',
  '起来',
  '出来',
  '下来',
  '已经',
  '可能',
  '如果',
  '因为',
  '所以',
  '只是',
  '不过',
  '然后',
  '这样',
  '这里',
  '那里',
  '时候',
  '知道',
  '觉得',
]);

function extractKeywords(text: string): string[] {
  const freq = new Map<string, number>();
  const matches = text.match(CN_WORD_RE) || [];
  for (const w of matches) {
    if (STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEYWORDS)
    .map(([word]) => word);
}

function buildSummary(chapter: Chapter): ChapterSummary {
  const { content } = chapter;
  return {
    index: chapter.index,
    title: chapter.title,
    head: content.slice(0, SUMMARY_SLICE),
    tail: content.length > SUMMARY_SLICE ? content.slice(-SUMMARY_SLICE) : '',
    charCount: content.length,
    keywords: extractKeywords(content),
  };
}

// ─── 倒排索引 ──────────────────────────────────────────────────────────────

interface ContentIndex {
  chapters: Chapter[];
  summaries: ChapterSummary[];
  /** 关键词 → 出现该关键词的章节索引列表 */
  invertedIndex: Map<string, number[]>;
  /** 原文内容的 hash，用于缓存失效判断 */
  contentHash: string;
}

function simpleHash(text: string): string {
  // FNV-1a 32-bit hash for fast change detection
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 128) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function buildContentIndex(text: string): ContentIndex {
  const chapters = splitChapters(text);
  const summaries = chapters.map(buildSummary);

  // 构建倒排索引
  const invertedIndex = new Map<string, number[]>();
  for (const summary of summaries) {
    for (const kw of summary.keywords) {
      const list = invertedIndex.get(kw) || [];
      list.push(summary.index);
      invertedIndex.set(kw, list);
    }
    // 也索引章节标题
    const titleWords = summary.title.match(CN_WORD_RE) || [];
    for (const tw of titleWords) {
      const list = invertedIndex.get(tw) || [];
      if (!list.includes(summary.index)) list.push(summary.index);
      invertedIndex.set(tw, list);
    }
  }

  return {
    chapters,
    summaries,
    invertedIndex,
    contentHash: simpleHash(text),
  };
}

// ─── 混合检索 ──────────────────────────────────────────────────────────────

interface RetrievalResult {
  /** 拼接后的上下文文本（可直接作为 AI context） */
  context: string;
  /** 命中的章节索引 */
  matchedChapters: number[];
  /** 索引中的总章节数 */
  totalChapters: number;
}

/**
 * 混合检索：给定用户 prompt + 工作流关键信息，从索引中检索最相关的章节。
 *
 * 策略：
 *   1. 从 prompt 提取关键词
 *   2. 通过倒排索引查找候选章节
 *   3. 按 TF-IDF 风格评分排序
 *   4. 取 Top-K 章节（默认 5），拼接摘要 + 正文片段
 *
 * @param index    buildContentIndex 的返回值
 * @param query    用户 prompt 或工作流提示文本
 * @param topK     返回前 K 个章节（默认 5）
 * @param maxChars 最大返回字符数（默认 8000）
 */
export function hybridRetrieve(
  index: ContentIndex,
  query: string,
  topK = 5,
  maxChars = 8000
): RetrievalResult {
  const { chapters, summaries, invertedIndex } = index;
  const totalChapters = chapters.length;

  // 单章节直接返回（短文件）
  if (totalChapters <= 1) {
    const text = chapters[0]?.content.slice(0, maxChars) || '';
    return { context: text, matchedChapters: [0], totalChapters };
  }

  // 1. 提取查询关键词
  const queryKeywords = extractKeywords(query);
  // 补充：从 query 中提取的原文关键词片段（2-4 字）
  const queryFragments = query.match(CN_WORD_RE) || [];
  const allQueryTerms = [...new Set([...queryKeywords, ...queryFragments])];

  // 2. 评分：倒排索引匹配 + IDF 加权
  const scores = new Map<number, number>();
  const docCount = totalChapters;

  for (const term of allQueryTerms) {
    const matchedIndices = invertedIndex.get(term);
    if (!matchedIndices) continue;

    // IDF = log(N / df)  — 出现在越少章节中的词，权重越高
    const idf = Math.log(docCount / matchedIndices.length);

    for (const chIdx of matchedIndices) {
      scores.set(chIdx, (scores.get(chIdx) || 0) + idf);
    }
  }

  // 3. 若关键词完全无命中，回退到前后章节
  if (scores.size === 0) {
    const fallbackIndices = [0, Math.floor(totalChapters / 2), totalChapters - 1].filter(
      (v, i, a) => a.indexOf(v) === i
    );
    return buildContext(chapters, summaries, fallbackIndices, maxChars, totalChapters);
  }

  // 4. 排序取 Top-K
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
  const selectedIndices = ranked.map(([idx]) => idx).sort((a, b) => a - b);

  return buildContext(chapters, summaries, selectedIndices, maxChars, totalChapters);
}

function buildContext(
  chapters: Chapter[],
  summaries: ChapterSummary[],
  indices: number[],
  maxChars: number,
  totalChapters: number
): RetrievalResult {
  const parts: string[] = [];
  let remaining = maxChars;

  // 先附上全书章节目录概览（帮助 AI 理解全局结构）
  const toc = summaries.map((s) => `${s.index + 1}. ${s.title}（${s.charCount} 字）`).join('\n');
  const tocHeader = `[全书共 ${totalChapters} 章]\n${toc}\n\n---\n`;
  if (tocHeader.length < remaining * 0.3) {
    parts.push(tocHeader);
    remaining -= tocHeader.length;
  }

  // 按顺序拼接命中章节的正文片段
  for (const idx of indices) {
    if (remaining <= 0) break;
    const ch = chapters[idx];
    if (!ch) continue;

    const header = `\n【${ch.title}】\n`;
    const slice = ch.content.slice(0, Math.min(remaining - header.length, ch.content.length));
    parts.push(header + slice);
    remaining -= header.length + slice.length;
  }

  return {
    context: parts.join(''),
    matchedChapters: indices,
    totalChapters,
  };
}

// ─── 索引缓存 ──────────────────────────────────────────────────────────────

let cachedIndex: ContentIndex | null = null;

/**
 * 获取（或缓存重用）内容索引。
 * 若内容未变（hash 相同），直接返回缓存。
 */
export function getOrBuildIndex(text: string): ContentIndex {
  const hash = simpleHash(text);
  if (cachedIndex && cachedIndex.contentHash === hash) {
    return cachedIndex;
  }
  cachedIndex = buildContentIndex(text);
  return cachedIndex;
}
