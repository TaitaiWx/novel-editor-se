import { useEffect, useRef } from 'react';
import {
  PREPARATION_CANCELLED_EVENT,
  registerPreparationParticipant,
} from '../utils/rendererPreparation';
export function useRendererPreparation(
  drafts: Record<string, string>,
  toast: { error: (message: string) => void }
): void {
  const latest = useRef(drafts);
  latest.current = drafts;
  useEffect(
    () =>
      registerPreparationParticipant(
        () => !Object.values(latest.current).some((content) => content.length > 0)
      ),
    []
  );
  useEffect(() => {
    const cancelled = () =>
      toast.error('尚有未保存的内容，已取消操作。请先保存未命名草稿，或重试保存失败的文件。');
    document.addEventListener(PREPARATION_CANCELLED_EVENT, cancelled);
    return () => document.removeEventListener(PREPARATION_CANCELLED_EVENT, cancelled);
  }, [toast]);
}
