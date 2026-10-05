import { useRef, useState } from 'react';

/**
 * 标签页领域状态：打开的标签、当前标签、未命名标签内容与计数器（只声明，不含副作用）
 */
export function useTabsState() {
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [untitledTabContents, setUntitledTabContents] = useState<Record<string, string>>({});

  // 未命名标签计数器
  const untitledCounterRef = useRef(0);
  // 最新值 ref：供异步回调读取，避免闭包过期
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  return {
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    untitledTabContents,
    setUntitledTabContents,
    untitledCounterRef,
    activeTabRef,
    openTabsRef,
  };
}

export type TabsState = ReturnType<typeof useTabsState>;
