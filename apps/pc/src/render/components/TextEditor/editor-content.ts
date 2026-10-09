/** Text exposed to editor consumers uses CodeMirror's logical LF coordinates. */
export function normalizeEditorContent(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * CodeMirror keeps logical lines and serializes them as LF. Preserve the loaded
 * file's separator when publishing text to save/dirty-state consumers.
 * An unchanged mixed-EOL document remains byte-for-byte identical; after editing,
 * mixed separators use the original first separator. New documents default to LF.
 */
export function serializeEditorContent(normalizedText: string, originalText: string): string {
  if (normalizedText === normalizeEditorContent(originalText)) return originalText;
  const separator = /\r\n|\r|\n/.exec(originalText)?.[0] ?? '\n';
  return separator === '\n' ? normalizedText : normalizedText.replace(/\n/g, separator);
}
