import { useEffect, useRef } from 'react';
import { registerPreparationParticipant } from '../utils/rendererPreparation';

/** 尚未提交的表单不能被原生关闭/导出忽略；由作者保存或取消后再继续。 */
export function useUnsavedChangesGuard(dirty: boolean, onBlocked?: () => void): void {
  const latest = useRef(dirty);
  latest.current = dirty;
  const reveal = useRef(onBlocked);
  reveal.current = onBlocked;
  useEffect(
    () =>
      registerPreparationParticipant(() => {
        if (latest.current) reveal.current?.();
        return !latest.current;
      }),
    []
  );
}
