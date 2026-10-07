/**
 * 编辑器辅助扩展入口（由 editor-runtime 的 loadEditorAssist() 懒加载）
 */
import type { Extension } from '@codemirror/state';
import { characterHoverExtension } from './character-hover';
import { continuationExtension } from './continuation';
import type { GetAssistContext } from './types';

export function editorAssistExtension(getContext: GetAssistContext): Extension {
  return [characterHoverExtension(getContext), continuationExtension(getContext)];
}

export {
  acceptContinuation,
  dismissContinuation,
  getContinuationState,
  nextContinuation,
  requestContinuation,
  retryContinuation,
  subscribeContinuation,
} from './continuation';
export { closeCharacterCards, openCharacterCardAtCursor } from './character-hover';
export type { ContinuationState } from './continuation-state';
