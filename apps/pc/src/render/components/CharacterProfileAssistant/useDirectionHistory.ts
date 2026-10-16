import { useEffect, useState } from 'react';

interface DirectionRecord {
  text: string;
  at: string;
}

function readHistory(key: string): DirectionRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is DirectionRecord =>
          !!item &&
          typeof item.text === 'string' &&
          !!item.text.trim() &&
          item.text.length <= 1000 &&
          typeof item.at === 'string' &&
          Number.isFinite(Date.parse(item.at))
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}

/** 仅记录已提交的补充方向，按作品和人物隔离，不保存生成结果或未提交输入。 */
export function useDirectionHistory(workPath: string | null, characterId: number) {
  const key = `novel-editor:character-enrichment-history:${JSON.stringify([workPath, characterId])}`;
  const [state, setState] = useState(() => ({ key, items: readHistory(key) }));
  useEffect(() => {
    setState({ key, items: readHistory(key) });
  }, [key]);
  const items = state.key === key ? state.items : [];
  const write = (next: DirectionRecord[]) => {
    setState({ key, items: next });
    try {
      if (next.length) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
    } catch {
      // 存储不可用时，本次会话仍可复用指令，不影响生成。
    }
  };
  return {
    items,
    remember(text: string) {
      if (!text.trim() || !workPath) return;
      write(
        [
          { text: text.trim(), at: new Date().toISOString() },
          ...items.filter((item) => item.text !== text.trim()),
        ].slice(0, 20)
      );
    },
    clear: () => write([]),
  };
}
