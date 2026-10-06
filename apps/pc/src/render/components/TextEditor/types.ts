import type React from 'react';
import type { EditorView } from '@codemirror/view';
import type { CharacterHighlightPattern } from './writing-decorations';
import type { InlineDiffRange } from './inline-diff';

export interface CursorPosition {
  line: number;
  column: number;
}

export interface ScrollToLineRequest {
  line: number;
  id: string;
}

export interface ReplaceLineRequest {
  line: number;
  text: string;
  id: number;
}

export interface TransientHighlightLineRequest {
  line: number;
  id: string;
}

export interface EditorViewportSnapshot {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface TextEditorProps {
  filePath: string | null;
  reloadToken?: number;
  focusMode?: boolean;
  wordWrap?: boolean;
  showLineNumbers?: boolean;
  showThousandCharMarkers?: boolean;
  thousandCharMarkerStep?: number;
  readOnly?: boolean;
  hideHeader?: boolean;
  virtualContent?: string | null;
  encoding?: string;
  characterHighlights?: CharacterHighlightPattern[];
  /** Markdown 实时渲染默认开关（设置中心）；文件头可临时切换 源码 / 实时预览 */
  markdownLivePreview?: boolean;
  scrollToLine?: ScrollToLineRequest | null;
  transientHighlightLine?: TransientHighlightLineRequest | null;
  replaceLineRequest?: ReplaceLineRequest | null;
  /** 内联 diff 数据（显示在编辑器内部的局部对比） */
  inlineDiff?: InlineDiffRange | null;
  /** 暴露 EditorView ref 供外部直接操作（精确事务替换等） */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  viewportSnapshots?: Record<string, EditorViewportSnapshot>;
  onViewportSnapshotChange?: (filePath: string, snapshot: EditorViewportSnapshot) => void;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
  onScrollProcessed?: () => void;
  onTransientHighlightProcessed?: () => void;
  settingsComponent?: React.ReactNode;
}
