/**
 * Text Diff Algorithms — Pure, framework-independent, independently testable.
 *
 * Includes:
 * - Myers' diff algorithm (O(nd) — gold standard, used by git/GNU diff)
 * - Character-level diff for intra-line highlighting
 * - Context collapsing (show only N lines around changes)
 * - Change pairing utilities for char-level maps
 *
 * @module diff
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'keep' | 'add' | 'del';
  text: string;
}

export interface CharSegment {
  type: 'keep' | 'add' | 'del';
  text: string;
}

export interface CollapsedBlock {
  type: 'collapsed';
  count: number;
}

export type DisplayItem = DiffLine | CollapsedBlock;

// ─── Myers' Diff Algorithm ─────────────────────────────────────────────────
//
// Reference: Eugene W. Myers (1986)
//   "An O(ND) Difference Algorithm and Its Variations"
//   Algorithmica 1(2):251-266
//
// Complexity:
//   Time:  O((n + m) × d)  where d = edit distance
//   Space: O(d²) for trace storage (optimal for d ≪ n+m, typical in editing)
//
// This is the same algorithm used by git diff, GNU diff, and most
// professional diff tools. It's optimal for similar texts (small d).
//
// For novel editing (chapters up to 5000 lines), trace memory is negligible:
//   d=100 edits → trace ≈ 80KB, d=500 edits → trace ≈ 2MB.
//   Complete chapter rewrites (d > 1000) are extremely rare.
//
// Optimizations over textbook implementation:
//   - Int32Array for the V vector (cache-friendly, typed)
//   - Compact trace snapshots (only store active range [-d, d])
//   - Early termination when d=0 (identical inputs)
// ─────────────────────────────────────────────────────────────────────────────

type EditOp<T> = { type: 'keep' | 'add' | 'del'; value: T };

/**
 * Generic Myers' diff. Compares two sequences and returns a minimal edit script.
 *
 * @param a   Old sequence
 * @param b   New sequence
 * @param eq  Equality function (defaults to ===)
 * @returns   Array of {type, value} edit operations
 */
export function myersDiff<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y
): EditOp<T>[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((v) => ({ type: 'add' as const, value: v }));
  if (m === 0) return a.map((v) => ({ type: 'del' as const, value: v }));

  const max = n + m;
  const offset = max;
  const size = 2 * max + 1;

  // V[k + offset] = furthest-reaching x-position on diagonal k
  // Int32Array: cache-friendly, zero-initialized, typed
  const v = new Int32Array(size);
  v[1 + offset] = 0;

  // Save a compact snapshot of V AFTER each d-step for backtracking.
  // Only store the active diagonals [-d, d] (step 2) per step.
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      // Decide: move down (insert) or move right (delete)
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // insert: come from diagonal k+1
      } else {
        x = v[k - 1 + offset] + 1; // delete: come from diagonal k-1
      }

      let y = x - k;

      // Follow diagonal (matching elements)
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }

      v[k + offset] = x;

      if (x >= n && y >= m) {
        // Save this step's snapshot and backtrack
        const w = 2 * d + 1;
        const snap = new Int32Array(w);
        for (let kk = -d; kk <= d; kk += 2) snap[kk + d] = v[kk + offset];
        trace.push(snap);
        return myersBacktrack(trace, a, b, d, eq);
      }
    }

    // Save V state AFTER step d (compact: only active diagonals)
    const w = 2 * d + 1;
    const snapshot = new Int32Array(w);
    for (let k = -d; k <= d; k += 2) {
      snapshot[k + d] = v[k + offset];
    }
    trace.push(snapshot);
  }

  // Fallback (should never reach here for valid inputs)
  return myersBacktrack(trace, a, b, max, eq);
}

/**
 * Backtrack through Myers trace to reconstruct the edit script.
 */
function myersBacktrack<T>(
  trace: Int32Array[],
  a: T[],
  b: T[],
  finalD: number,
  _eq: (x: T, y: T) => boolean
): EditOp<T>[] {
  const result: EditOp<T>[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = finalD; d > 0; d--) {
    const k = x - y;
    const snap = trace[d - 1];
    const prevD = d - 1;

    // Determine which diagonal we came from
    let prevK: number;
    if (k === -d || (k !== d && snapGet(snap, k - 1, prevD) < snapGet(snap, k + 1, prevD))) {
      prevK = k + 1; // came from insert (move down)
    } else {
      prevK = k - 1; // came from delete (move right)
    }

    const prevX = snapGet(snap, prevK, prevD);
    const prevY = prevX - prevK;

    // Diagonal (keep) — push in reverse, we'll reverse at the end
    while (x > prevX && y > prevY) {
      x--;
      y--;
      result.push({ type: 'keep', value: a[x] });
    }

    // The edit operation
    if (x === prevX && y > prevY) {
      // Insert
      y--;
      result.push({ type: 'add', value: b[y] });
    } else if (y === prevY && x > prevX) {
      // Delete
      x--;
      result.push({ type: 'del', value: a[x] });
    }
  }

  // Remaining diagonal from (0,0)
  while (x > 0 && y > 0) {
    x--;
    y--;
    result.push({ type: 'keep', value: a[x] });
  }

  return result.reverse();
}

/** Read V value from a compact snapshot (indexed [-d, d] stored as [0, 2d]). */
function snapGet(snap: Int32Array, k: number, d: number): number {
  const idx = k + d;
  if (idx < 0 || idx >= snap.length) return -1;
  return snap[idx];
}

// ─── Line-level diff (string convenience) ───────────────────────────────────

/**
 * Line-level diff using Myers' algorithm.
 * Convenience wrapper that operates on string arrays.
 */
export function computeLineDiff(a: string[], b: string[]): DiffLine[] {
  return myersDiff(a, b, (x, y) => x === y).map((op) => ({
    type: op.type,
    text: op.value,
  }));
}

// ─── Character-level diff ───────────────────────────────────────────────────

/**
 * Character-level diff for highlighting specific changes within a line pair.
 * Unicode-safe (handles CJK, emoji, combining marks).
 * Uses Myers' algorithm internally.
 */
export function computeCharDiff(oldText: string, newText: string): CharSegment[] {
  const a = [...oldText]; // Unicode-safe split
  const b = [...newText];

  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return [{ type: 'add', text: newText }];
  if (b.length === 0) return [{ type: 'del', text: oldText }];

  const raw = myersDiff(a, b);

  // Merge adjacent same-type segments for efficiency
  const merged: CharSegment[] = [];
  for (const op of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.text += op.value;
    } else {
      merged.push({ type: op.type, text: op.value });
    }
  }

  return merged;
}

// ─── Context collapsing ─────────────────────────────────────────────────────

/**
 * Collapse unchanged lines outside the context window.
 * Shows `contextSize` lines before/after each change, hides the rest.
 * Similar to `git diff --unified=N`.
 *
 * @param lines       Full diff output
 * @param contextSize Lines to keep around each change (0 = show all)
 */
export function collapseContext(lines: DiffLine[], contextSize = 3): DisplayItem[] {
  if (contextSize <= 0 || lines.length === 0) return lines;

  // Collect indices of changed lines
  const changedIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'keep') changedIndices.push(i);
  }

  // Edge cases
  if (changedIndices.length === lines.length) return lines;
  if (changedIndices.length === 0) {
    return lines.length > contextSize * 2
      ? [{ type: 'collapsed' as const, count: lines.length }]
      : lines;
  }

  // Mark visible line indices (within context window of any change)
  const visible = new Uint8Array(lines.length); // 0 = hidden, 1 = visible
  for (const idx of changedIndices) {
    const lo = Math.max(0, idx - contextSize);
    const hi = Math.min(lines.length - 1, idx + contextSize);
    for (let k = lo; k <= hi; k++) visible[k] = 1;
  }

  // Build output, grouping consecutive hidden lines into collapsed blocks
  const result: DisplayItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (visible[i]) {
      result.push(lines[i]);
      i++;
    } else {
      let count = 0;
      while (i < lines.length && !visible[i]) {
        count++;
        i++;
      }
      result.push({ type: 'collapsed', count });
    }
  }

  return result;
}

/** Type guard for collapsed blocks */
export function isCollapsedBlock(item: DisplayItem): item is CollapsedBlock {
  return item.type === 'collapsed';
}

// ─── Change pairing utility ────────────────────────────────────────────────

/**
 * Build a map from line index → char-level diff segments
 * for adjacent del→add line pairs (replacement hunks).
 *
 * This enables character-level highlighting within replaced lines,
 * similar to VSCode Copilot's inline diff view.
 */
export function buildCharDiffMap(lines: DiffLine[]): Map<number, CharSegment[]> {
  const map = new Map<number, CharSegment[]>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== 'del') {
      i++;
      continue;
    }
    // Collect consecutive del lines
    const delStart = i;
    while (i < lines.length && lines[i].type === 'del') i++;
    // Collect consecutive add lines
    const addStart = i;
    while (i < lines.length && lines[i].type === 'add') i++;
    // 1:1 pairing (pair each del with corresponding add)
    const pairs = Math.min(i - addStart, addStart - delStart);
    for (let k = 0; k < pairs; k++) {
      const segs = computeCharDiff(lines[delStart + k].text, lines[addStart + k].text);
      map.set(delStart + k, segs);
      map.set(addStart + k, segs);
    }
  }
  return map;
}
