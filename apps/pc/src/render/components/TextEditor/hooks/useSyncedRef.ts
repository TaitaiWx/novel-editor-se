import { useEffect, useRef } from 'react';

/**
 * 返回一个始终指向最新值的 ref（在 effect 阶段同步）。
 * 用于把回调 / 配置传给长生命周期的 EditorView，避免因依赖变化重建编辑器。
 */
export function useSyncedRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
