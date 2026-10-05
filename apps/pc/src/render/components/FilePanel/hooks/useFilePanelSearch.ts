import { useCallback, useEffect, useRef, useState } from 'react';
import { matchShortcutEvent } from '../../../utils/appSettings';

/** 文件面板搜索框：显隐、关键词与快速打开快捷键（默认 Cmd/Ctrl+P） */
export function useFilePanelSearch(quickOpenShortcut: string) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        setSearchQuery('');
      }
      return !prev;
    });
  }, []);

  /** 清空关键词并隐藏搜索框 */
  const closeSearch = useCallback(() => {
    setSearchQuery('');
    setShowSearch(false);
  }, []);

  // Cmd+P 快捷键打开搜索
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchShortcutEvent(e, quickOpenShortcut)) {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickOpenShortcut]);

  return {
    searchQuery,
    setSearchQuery,
    showSearch,
    searchInputRef,
    handleToggleSearch,
    closeSearch,
  };
}
