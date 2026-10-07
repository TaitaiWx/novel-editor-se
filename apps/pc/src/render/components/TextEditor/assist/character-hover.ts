/**
 * 人物悬停卡片（CodeMirror 部分）
 *
 * - 鼠标停在人物名 / 别名上 300ms 弹出卡片；移开或 Esc 关闭；⌘/Ctrl+K 打开光标处人物的卡片
 * - 不打断写作：卡片不抢焦点；输入法组字中、刚输入完（800ms 内）不弹出
 * - 「高亮全部」：临时高亮该人物在可见区域内的所有出现（8 秒后或 Esc 清除）
 * - 卡片内容由上层渲染（renderCharacterCard），这里只负责识别与定位
 */
import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  closeHoverTooltips,
  hasHoverTooltips,
  hoverTooltip,
  keymap,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import {
  buildCharacterMatcher,
  mentionAt,
  mentionsInRanges,
  type CharacterMatcher,
  type CharacterMention,
  type MatchableCharacter,
} from './character-match';
import type { GetAssistContext } from './types';

export const HOVER_DELAY_MS = 300;
export const TYPING_QUIET_MS = 800;
export const HIGHLIGHT_ALL_MS = 8000;

const matcherCache = new WeakMap<readonly MatchableCharacter[], CharacterMatcher>();

/** 同一份人物列表只建一次识别器（列表变化即重建，缓存随之失效） */
export function matcherFor(characters: readonly MatchableCharacter[]): CharacterMatcher {
  let matcher = matcherCache.get(characters);
  if (!matcher) {
    matcher = buildCharacterMatcher(characters);
    matcherCache.set(characters, matcher);
  }
  return matcher;
}

// ─── 输入中不弹卡片 ──────────────────────────────────────────────────────────

const lastInputAt = new WeakMap<EditorView, number>();

const typingTracker = EditorView.updateListener.of((update) => {
  if (
    update.docChanged &&
    update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))
  ) {
    lastInputAt.set(update.view, Date.now());
  }
});

export function isTypingRecently(view: EditorView, now = Date.now()): boolean {
  const last = lastInputAt.get(view);
  return last !== undefined && now - last < TYPING_QUIET_MS;
}

// ─── ⌘K 固定卡片 / 高亮全部 状态 ─────────────────────────────────────────────

interface PinnedCard {
  characterId: number;
  from: number;
  to: number;
}

export const setPinnedCharacterCard = StateEffect.define<PinnedCard | null>();
export const setHighlightAllCharacter = StateEffect.define<number | null>();

const pinnedCardField = StateField.define<PinnedCard | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setPinnedCharacterCard)) next = effect.value;
    }
    if (!next || next !== value) return next;
    if (tr.docChanged) return null;
    if (tr.selection) {
      const head = tr.state.selection.main.head;
      if (head < next.from || head > next.to) return null;
    }
    return next;
  },
});

export const highlightAllField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setHighlightAllCharacter)) next = effect.value;
    }
    return next;
  },
});

/** 关闭所有人物卡片与「高亮全部」；没有可关闭的内容时返回 false */
export function closeCharacterCards(view: EditorView): boolean {
  const effects: StateEffect<unknown>[] = [];
  if (hasHoverTooltips(view.state)) effects.push(closeHoverTooltips);
  if (view.state.field(pinnedCardField, false)) effects.push(setPinnedCharacterCard.of(null));
  if (view.state.field(highlightAllField, false) !== null) {
    effects.push(setHighlightAllCharacter.of(null));
  }
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
}

// ─── 卡片 tooltip ────────────────────────────────────────────────────────────

function createCardTooltip(
  getContext: GetAssistContext,
  mention: Pick<CharacterMention, 'from' | 'to' | 'characterId'>
): Tooltip {
  return {
    pos: mention.from,
    end: mention.to,
    above: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'cm-character-card-host';
      let cleanup: (() => void) | null = null;
      // Esc 关闭（焦点不在编辑器时也生效；捕获阶段处理，避免同时退出专注模式）
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        closeCharacterCards(view);
      };
      return {
        dom,
        mount() {
          const render = getContext().config?.renderCharacterCard;
          if (!render) return;
          cleanup = render(dom, mention.characterId, {
            close: () => closeCharacterCards(view),
            highlightAll: () => {
              view.dispatch({
                effects: [
                  setHighlightAllCharacter.of(mention.characterId),
                  setPinnedCharacterCard.of(null),
                  closeHoverTooltips,
                ],
              });
            },
          });
          window.addEventListener('keydown', onKeyDown, true);
        },
        destroy() {
          window.removeEventListener('keydown', onKeyDown, true);
          cleanup?.();
          cleanup = null;
        },
      };
    },
  };
}

/** ⌘/Ctrl+K：打开光标处人物的卡片 */
export function openCharacterCardAtCursor(view: EditorView, getContext: GetAssistContext): boolean {
  const config = getContext().config;
  if (!config?.renderCharacterCard) return false;
  const matcher = matcherFor(config.characters);
  const head = view.state.selection.main.head;
  const mention =
    mentionAt(matcher, view.state.doc, head, -1) ?? mentionAt(matcher, view.state.doc, head, 1);
  if (!mention) return false;
  view.dispatch({
    effects: setPinnedCharacterCard.of({
      characterId: mention.characterId,
      from: mention.from,
      to: mention.to,
    }),
  });
  return true;
}

// ─── 高亮全部（只装饰可见区域） ──────────────────────────────────────────────

const highlightMark = Decoration.mark({ class: 'cm-character-highlight-all' });

function createHighlightAllPlugin(getContext: GetAssistContext) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private timer: ReturnType<typeof setTimeout> | null = null;

      constructor(private readonly view: EditorView) {
        this.decorations = this.build();
      }

      update(update: ViewUpdate) {
        const before = update.startState.field(highlightAllField, false) ?? null;
        const after = update.state.field(highlightAllField, false) ?? null;
        if (before !== after) this.schedule(after);
        if (before !== after || (after !== null && (update.docChanged || update.viewportChanged))) {
          this.decorations = this.build();
        }
      }

      private schedule(characterId: number | null) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (characterId === null) return;
        this.timer = setTimeout(() => {
          this.timer = null;
          if (this.view.state.field(highlightAllField, false) === characterId) {
            this.view.dispatch({ effects: setHighlightAllCharacter.of(null) });
          }
        }, HIGHLIGHT_ALL_MS);
      }

      private build(): DecorationSet {
        const characterId = this.view.state.field(highlightAllField, false) ?? null;
        const characters = getContext().config?.characters;
        if (characterId === null || !characters) return Decoration.none;
        const mentions = mentionsInRanges(
          matcherFor(characters),
          this.view.state.doc,
          this.view.visibleRanges,
          characterId
        );
        return Decoration.set(mentions.map((item) => highlightMark.range(item.from, item.to)));
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
    { decorations: (value) => value.decorations }
  );
}

const hoverTheme = EditorView.baseTheme({
  '.cm-tooltip.cm-character-card-host': {
    border: 'none',
    background: 'transparent',
    zIndex: '120',
  },
  '.cm-character-highlight-all': {
    backgroundColor: 'rgba(215, 186, 125, 0.28)',
    boxShadow: '0 0 0 1px rgba(215, 186, 125, 0.5)',
    borderRadius: '2px',
  },
});

export function characterHoverExtension(getContext: GetAssistContext): Extension {
  const pinnedTooltip = showTooltip.compute([pinnedCardField], (state) => {
    const pinned = state.field(pinnedCardField);
    return pinned ? createCardTooltip(getContext, pinned) : null;
  });
  return [
    typingTracker,
    pinnedCardField,
    pinnedTooltip,
    highlightAllField,
    createHighlightAllPlugin(getContext),
    hoverTheme,
    hoverTooltip(
      (view, pos, side) => {
        const config = getContext().config;
        if (!config?.renderCharacterCard || !config.characters.length) return null;
        if (view.composing || isTypingRecently(view)) return null;
        if (view.state.field(pinnedCardField, false)) return null;
        const mention = mentionAt(matcherFor(config.characters), view.state.doc, pos, side);
        return mention ? createCardTooltip(getContext, mention) : null;
      },
      { hoverTime: HOVER_DELAY_MS, hideOnChange: true }
    ),
    Prec.high(
      keymap.of([
        { key: 'Mod-k', run: (view) => openCharacterCardAtCursor(view, getContext) },
        { key: 'Escape', run: closeCharacterCards },
      ])
    ),
  ];
}
