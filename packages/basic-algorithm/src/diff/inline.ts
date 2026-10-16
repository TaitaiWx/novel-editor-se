import { myersDiff, type CharSegment } from './index';

export interface InlineTextChange extends CharSegment {
  /** UTF-16 offsets in the current text; deleted text has from === to. */
  from: number;
  to: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);

/** Character-level form diff, with a bounded cost for long, unrelated rewrites. */
export function computeInlineTextDiff(before: string, after: string): InlineTextChange[] {
  if (before === after)
    return after ? [{ type: 'keep', text: after, from: 0, to: after.length }] : [];
  const oldChars = graphemes(before);
  const newChars = graphemes(after);
  let start = 0;
  let end = 0;
  while (start < Math.min(oldChars.length, newChars.length) && oldChars[start] === newChars[start])
    start++;
  while (
    end < Math.min(oldChars.length, newChars.length) - start &&
    oldChars[oldChars.length - end - 1] === newChars[newChars.length - end - 1]
  )
    end++;
  const oldMiddle = oldChars.slice(start, oldChars.length - end);
  const newMiddle = newChars.slice(start, newChars.length - end);
  // Myers keeps a trace of edit paths. Limit the worst-case memory and typing latency.
  const middle =
    oldMiddle.length + newMiddle.length <= 1500
      ? myersDiff(oldMiddle, newMiddle)
      : [
          { type: 'del' as const, value: oldMiddle.join('') },
          { type: 'add' as const, value: newMiddle.join('') },
        ];
  const ops = [
    { type: 'keep' as const, value: oldChars.slice(0, start).join('') },
    ...middle,
    { type: 'keep' as const, value: end ? oldChars.slice(-end).join('') : '' },
  ];
  const result: InlineTextChange[] = [];
  let position = 0;
  for (const op of ops) {
    if (!op.value) continue;
    const to = position + (op.type === 'del' ? 0 : op.value.length);
    const previous = result.at(-1);
    if (previous?.type === op.type) {
      previous.text += op.value;
      previous.to = to;
    } else result.push({ type: op.type, text: op.value, from: position, to });
    position = to;
  }
  return result;
}
