/**
 * 文本统计
 *
 * analyzeContentStats / buildThousandCharMarkers 的口径与 GUI 状态栏
 * (apps/pc/src/render/utils/contentStats.ts) 保持一致：只跳过换行、回车、Tab 和半角空格。
 * GUI 通过 @novel-editor/core/text-stats 直接复用这里的实现。
 *
 * 小说格式（Novel Markdown）：front-matter 与指令行（:::scene、::video 等）不计字数，
 * 行内指令只计方括号里的文字（stripNovelMarkup 保持行数不变，行号与编辑器一致）。
 */
import { stripNovelMarkup } from './novel-format';

export interface ContentStats {
  lineCount: number;
  charCount: number;
}

export interface ThousandCharMarker {
  lineNumber: number;
  charCount: number;
}

/** 完整的文本统计结果（CLI `ne stats` 输出） */
export interface TextStats {
  /** 字数：与 GUI 状态栏口径一致（不计空白） */
  chars: number;
  /** 中日韩字符数 */
  cjkChars: number;
  /** 拉丁单词数（连续字母/数字串） */
  words: number;
  /** 行数 */
  lines: number;
  /** 段落数：非空行数（中文小说通常一行一段） */
  paragraphs: number;
  /** UTF-8 字节数 */
  bytes: number;
}

function isCountableCharCode(code: number): boolean {
  return code !== 10 && code !== 13 && code !== 9 && code !== 32;
}

export function analyzeContentStats(rawContent: string): ContentStats {
  if (!rawContent) {
    return { lineCount: 0, charCount: 0 };
  }
  const content = stripNovelMarkup(rawContent);

  let lineCount = 1;
  let charCount = 0;

  // 与状态栏字数口径保持一致，只跳过换行、Tab 和半角空格。
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 10) {
      lineCount += 1;
      continue;
    }
    if (isCountableCharCode(code)) {
      charCount += 1;
    }
  }

  return { lineCount, charCount };
}

export function buildThousandCharMarkers(
  rawContent: string,
  milestoneStep = 1000
): ThousandCharMarker[] {
  if (!rawContent || !Number.isFinite(milestoneStep) || milestoneStep <= 0) {
    return [];
  }
  const content = stripNovelMarkup(rawContent);

  const markers: ThousandCharMarker[] = [];
  let currentLine = 1;
  let charCount = 0;
  let nextMilestone = milestoneStep;
  let pendingMarkerCount: number | null = null;

  // 逐字符单次扫描全文，在跨过每个千字阈值时把该行的累计字数记录下来。
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);

    if (code === 10) {
      if (pendingMarkerCount !== null) {
        markers.push({ lineNumber: currentLine, charCount: pendingMarkerCount });
        pendingMarkerCount = null;
      }
      currentLine += 1;
      continue;
    }

    if (!isCountableCharCode(code)) {
      continue;
    }

    charCount += 1;
    if (charCount >= nextMilestone) {
      pendingMarkerCount = charCount;
      while (charCount >= nextMilestone) {
        nextMilestone += milestoneStep;
      }
    } else if (pendingMarkerCount !== null) {
      pendingMarkerCount = charCount;
    }
  }

  if (pendingMarkerCount !== null) {
    markers.push({ lineNumber: currentLine, charCount: pendingMarkerCount });
  }

  return markers;
}

const CJK_REGEX = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
const WORD_REGEX = /[A-Za-z0-9]+(?:['\u2019-][A-Za-z0-9]+)*/g;

export function computeTextStats(content: string): TextStats {
  const { lineCount, charCount } = analyzeContentStats(content);
  const plain = stripNovelMarkup(content);
  const paragraphs = plain ? plain.split(/\r?\n/).filter((line) => line.trim()).length : 0;
  return {
    chars: charCount,
    cjkChars: plain.match(CJK_REGEX)?.length ?? 0,
    words: plain.match(WORD_REGEX)?.length ?? 0,
    lines: lineCount,
    paragraphs,
    bytes: Buffer.byteLength(content, 'utf-8'),
  };
}

/** 累加多份统计结果 */
export function sumTextStats(list: TextStats[]): TextStats {
  return list.reduce<TextStats>(
    (acc, item) => ({
      chars: acc.chars + item.chars,
      cjkChars: acc.cjkChars + item.cjkChars,
      words: acc.words + item.words,
      lines: acc.lines + item.lines,
      paragraphs: acc.paragraphs + item.paragraphs,
      bytes: acc.bytes + item.bytes,
    }),
    { chars: 0, cjkChars: 0, words: 0, lines: 0, paragraphs: 0, bytes: 0 }
  );
}
