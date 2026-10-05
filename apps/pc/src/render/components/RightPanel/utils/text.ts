export function splitTextIntoChunks(content: string, maxChars: number): string[] {
  const sanitized = content.trim();
  if (!sanitized) return [];

  const paragraphs = sanitized.split(/\n{2,}/).filter((item) => item.trim());
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < paragraph.length; index += maxChars) {
        chunks.push(paragraph.slice(index, index + maxChars));
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = next;
    }
  }

  pushCurrent();
  return chunks;
}

/**
 * 从 start 位置（必须是 `{` 或 `[`）开始做括号配对，跳过字符串内的括号，
 * 返回配对完整的 JSON 片段；无法配对时返回 null
 */
function sliceBalancedJson(raw: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null;
      if (stack.length === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** 无代码块时最多尝试的 JSON 起点数量，避免超长文本反复解析 */
const MAX_JSON_CANDIDATES = 20;

function nextJsonOpener(raw: string, from: number): number {
  const offset = raw.slice(from).search(/[[{]/);
  return offset === -1 ? -1 : from + offset;
}

export function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  // 无代码块时：从先出现的 `{` / `[` 起按字符串感知的括号配对截取（支持裸 JSON 数组），
  // 并跳过“[注]”之类配对完整但不是合法 JSON 的片段
  let attempts = 0;
  for (
    let start = raw.search(/[[{]/);
    start !== -1 && attempts < MAX_JSON_CANDIDATES;
    start = nextJsonOpener(raw, start + 1)
  ) {
    attempts += 1;
    const balanced = sliceBalancedJson(raw, start);
    if (!balanced) continue;
    try {
      JSON.parse(balanced);
      return balanced.trim();
    } catch {
      /* 不是合法 JSON，继续尝试下一个起点 */
    }
  }

  const objectStart = raw.indexOf('{');
  // 兜底：括号不配对（如被截断）时沿用首尾截取，交给调用方 JSON.parse 判定
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    return raw.slice(objectStart, objectEnd + 1).trim();
  }

  return null;
}
