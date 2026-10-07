/**
 * 从模型回复中提取 JSON：容忍 ```json 代码块、前后解释文字、尾随逗号
 */

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1');
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  for (const candidate of [text, stripTrailingCommas(text)]) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      // 继续尝试
    }
  }
  return { ok: false };
}

/** 找到从 start 开始、括号配平的 JSON 片段（跳过字符串内的括号） */
function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; error: string };

export function extractJson(text: string): JsonExtraction {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, error: 'AI 没有返回内容' };
  const direct = tryParse(trimmed);
  if (direct.ok) return direct;
  const fenced = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed.ok) return parsed;
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] !== '{' && trimmed[i] !== '[') continue;
    const slice = balancedSlice(trimmed, i);
    if (!slice) continue;
    const parsed = tryParse(slice);
    if (parsed.ok) return parsed;
  }
  return { ok: false, error: 'AI 返回的内容不是有效的 JSON' };
}
