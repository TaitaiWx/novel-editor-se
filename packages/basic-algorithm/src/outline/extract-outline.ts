import type { OutlineNode, OutlineOptions } from './types';

// ── 内置正则规则 ──

/** Markdown 标题: # ~ ###### */
const RE_MARKDOWN = /^(#{1,6})\s+(.+)/;

/**
 * 中文章节标记（支持汉字数字和阿拉伯数字混合）
 * 匹配: 第一章、第12章、第三卷、第二幕、第一节、第五回、第六部
 */
const RE_CHINESE_SECTION =
  /^(\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+[\u7ae0\u5e55\u8282\u5377\u90e8\u56de\u7bc7\u96c6])\s*(.*)/;

/**
 * 纯数字编号标题
 * 匹配: "1. 标题"、"1.2 标题"、"第1章"
 */
const RE_NUMBERED = /^(\d+(?:\.\d+)*)[.\u3001)\s]\s*(.+)/;

/**
 * 日期行（如 "2024.03.15"、"2024-3-15 晴"、"2024/03/15"），不应被识别为编号标题
 */
const RE_DATE_LIKE = /^\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\D|$)/;

/**
 * 分隔线式标题（常见于网文）
 * 匹配: "--- 标题 ---"、"*** 标题 ***"、"=== 标题 ==="
 */
const RE_SEPARATOR_TITLE = /^[-*=]{3,}\s+(.+?)\s+[-*=]{3,}\s*$/;

/**
 * 启发式：短行 + 特征模式
 * - 全大写行（英文）
 * - 被空行包围且少于 30 字的行
 */
const MAX_HEURISTIC_LEN = 40;

/**
 * 中文数字→层级映射
 * 章=1, 幕=1, 卷=1, 部=1,
 * 回=2, 集=2, 节=2, 篇=2
 */
function chineseSectionLevel(unit: string): number {
  if ('章幕卷部'.includes(unit)) return 1;
  if ('回集节篇'.includes(unit)) return 2;
  return 1;
}

/** 数字编号深度 → 层级 (1→1, 1.2→2, 1.2.3→3) */
function numberedLevel(prefix: string): number {
  return Math.min(prefix.split('.').length, 6);
}

/**
 * 从文本中提取大纲标题列表
 *
 * 多策略检测顺序（优先级从高到低）：
 * 1. Markdown 标题 (#)
 * 2. 中文章节标记 (第X章/幕/节/卷/部/回/篇/集)
 * 3. 数字编号标题 (1. / 1.2 / 1.2.3)
 * 4. 分隔线包裹标题
 * 5. 启发式检测（短行 + 上下空行包围）
 *
 * 时间复杂度 O(n)，单次遍历
 */
export function extractOutline(text: string, options: OutlineOptions = {}): OutlineNode[] {
  const { enableHeuristic = true, customPatterns = [] } = options;

  if (!text) return [];

  const lines = text.split('\n');
  const result: OutlineNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lineNum = i + 1;

    // 策略 1: Markdown 标题
    const mdMatch = trimmed.match(RE_MARKDOWN);
    if (mdMatch) {
      result.push({
        level: mdMatch[1].length,
        text: mdMatch[2].trim(),
        line: lineNum,
        source: 'markdown',
      });
      continue;
    }

    // 策略 2: 中文章节标记
    const chMatch = trimmed.match(RE_CHINESE_SECTION);
    if (chMatch) {
      const unit = chMatch[1].slice(-1);
      result.push({
        level: chineseSectionLevel(unit),
        text: (chMatch[1] + ' ' + (chMatch[2] || '')).trim(),
        line: lineNum,
        source: 'chinese-section',
      });
      continue;
    }

    // 策略 3: 数字编号标题
    const numMatch = RE_DATE_LIKE.test(trimmed) ? null : trimmed.match(RE_NUMBERED);
    if (numMatch) {
      // 排除纯数字行（如 "123456" 或 "2024.03.15"）
      const textPart = numMatch[2].trim();
      if (textPart.length > 0 && textPart.length < 60) {
        result.push({
          level: numberedLevel(numMatch[1]),
          text: textPart,
          line: lineNum,
          source: 'numbered',
        });
        continue;
      }
    }

    // 策略 4: 分隔线标题
    const sepMatch = trimmed.match(RE_SEPARATOR_TITLE);
    if (sepMatch) {
      result.push({
        level: 1,
        text: sepMatch[1].trim(),
        line: lineNum,
        source: 'separator',
      });
      continue;
    }

    // 策略 5: 自定义正则
    let matched = false;
    for (const pattern of customPatterns) {
      const customMatch = trimmed.match(pattern);
      if (customMatch) {
        result.push({
          level: 1,
          text: (customMatch[1] || trimmed).trim(),
          line: lineNum,
          source: 'heuristic',
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 策略 6: 启发式 — 被空行包围的短行
    if (enableHeuristic && trimmed.length <= MAX_HEURISTIC_LEN && trimmed.length >= 2) {
      const prevEmpty = i === 0 || lines[i - 1].trim() === '';
      const nextEmpty = i === lines.length - 1 || lines[i + 1].trim() === '';
      if (prevEmpty && nextEmpty) {
        // 排除常见非标题短行
        const isLikelyTitle =
          // 不以标点开头
          !/^[\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b\u3008\u3009"'\uff08\uff09\u3010\u3011\u2014\u2026\u00b7,.;:!?()[\]{}]/.test(
            trimmed
          ) &&
          // 不是纯数字/纯标点
          !/^[\d\s.,;:!?]+$/.test(trimmed) &&
          // 不是空白标记
          !/^[-*=_]{3,}$/.test(trimmed);

        if (isLikelyTitle) {
          result.push({
            level: 2,
            text: trimmed,
            line: lineNum,
            source: 'heuristic',
          });
        }
      }
    }
  }

  return result;
}
