/**
 * 小说格式（Novel Markdown）的场景容器在大纲 / 卷纲里的识别（与 @novel-editor/core 的 novel-format 同一写法）：
 * `:::scene{#id title=港口 pov=林舟}` 开始一场，`:::` 结束；其他指令行（`::video{…}`）不当作正文预览。
 * 没有容器时继续按「第X场」标题识别。
 */

const SCENE_OPEN_RE = /^:::scene(?:\[([^\]\n]*)\])?(\{[^}\n]*\})?\s*$/;
const DIRECTIVE_LINE_RE = /^:{2,3}([A-Za-z][\w-]*)?(\[[^\]\n]*\])?(\{[^}\n]*\})?\s*$/;

function attribute(raw: string, key: string): string {
  const match = new RegExp(`(?:^|[\\s{])${key}=(?:"([^"]*)"|'([^']*)'|([^\\s}]+))`).exec(raw);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

/** `:::scene{title=港口}` → 场景标题（没有标题时用 id，再没有时为「场景」）；不是场景容器开始行时为 null */
export function sceneContainerTitle(line: string): string | null {
  const match = SCENE_OPEN_RE.exec(line.trim());
  if (!match) return null;
  const attrs = match[2] ?? '';
  const id = /#([^\s}#.]+)/.exec(attrs)?.[1] ?? '';
  return attribute(attrs, 'title') || match[1]?.trim() || id || '场景';
}

/** 指令行（场景容器开始 / 结束、::video 等），不作为正文预览或节拍文字 */
export function isDirectiveLine(line: string): boolean {
  const text = line.trim();
  return text.startsWith('::') && DIRECTIVE_LINE_RE.test(text);
}
