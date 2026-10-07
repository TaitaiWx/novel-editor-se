/**
 * 把人物卡片渲染进 CodeMirror tooltip 的 DOM（独立的 React root）。
 * 头像与上次出场异步读取；同步渲染首帧，保证 tooltip 定位时已有尺寸。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import CharacterHoverCard from './index';
import { buildCharacterCardModel, type CharacterCardSource, type LastAppearance } from './model';

export interface CharacterCardMountProps extends CharacterCardSource {
  loadAvatar: () => Promise<string | null>;
  loadLastAppearance: () => Promise<LastAppearance | null>;
  canRecord: boolean;
  onOpen: () => void;
  onRecord: (anchor: DOMRect) => void;
  onHighlightAll: () => void;
}

export const CharacterHoverCardContainer: React.FC<CharacterCardMountProps> = ({
  character,
  growth,
  loadAvatar,
  loadLastAppearance,
  canRecord,
  onOpen,
  onRecord,
  onHighlightAll,
}) => {
  const model = useMemo(() => buildCharacterCardModel({ character, growth }), [character, growth]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [lastAppearance, setLastAppearance] = useState<LastAppearance | null | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    loadAvatar()
      .then((value) => {
        if (!cancelled) setAvatar(value);
      })
      .catch(() => undefined);
    loadLastAppearance()
      .then((value) => {
        if (!cancelled) setLastAppearance(value);
      })
      .catch(() => {
        if (!cancelled) setLastAppearance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAvatar, loadLastAppearance]);

  return (
    <CharacterHoverCard
      model={model}
      avatarSrc={avatar}
      lastAppearance={lastAppearance}
      canRecord={canRecord}
      onOpen={onOpen}
      onRecord={onRecord}
      onHighlightAll={onHighlightAll}
    />
  );
};

/** 渲染卡片，返回清理函数（卸载放到微任务里，避免在 React 提交过程中同步卸载） */
export function mountCharacterHoverCard(dom: HTMLElement, props: CharacterCardMountProps) {
  const root = createRoot(dom);
  flushSync(() => root.render(<CharacterHoverCardContainer {...props} />));
  return () => {
    queueMicrotask(() => root.unmount());
  };
}
