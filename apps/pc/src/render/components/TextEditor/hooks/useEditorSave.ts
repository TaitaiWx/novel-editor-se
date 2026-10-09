import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emitFileSaved, isChangelogPath, isUntitledPath } from '../editor-paths';

/** 自动保存延迟（毫秒） */
export const AUTO_SAVE_DELAY = 2000;

interface UseEditorSaveOptions {
  currentFilePathRef: React.MutableRefObject<string | null>;
  currentContentRef: React.MutableRefObject<string>;
  currentOriginalContentRef: React.MutableRefObject<string>;
  readOnlyRef: React.MutableRefObject<boolean>;
  onSaveUntitledRef: React.MutableRefObject<
    | ((untitledPath: string, content: string) => boolean | void | Promise<boolean | void>)
    | undefined
  >;
  autoSaveTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  toast: { success: (message: string) => void; error: (message: string) => void };
}

/** 自动保存（2 秒防抖）与手动保存（Cmd/Ctrl+S），维护保存状态 */
export function useEditorSave({
  currentFilePathRef,
  currentContentRef,
  currentOriginalContentRef,
  readOnlyRef,
  onSaveUntitledRef,
  autoSaveTimeoutRef,
  toast,
}: UseEditorSaveOptions) {
  const pendingSaveCountRef = useRef(0);
  const scheduleAutoSaveRef = useRef<() => void>(() => {});
  const [autoSaving, setAutoSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const handleManualSaveRef = useRef<() => Promise<boolean>>(async () => false);

  const autoSaveFile = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    const targetContent = currentContentRef.current;

    if (
      !targetPath ||
      readOnlyRef.current ||
      (targetContent === currentOriginalContentRef.current && pendingSaveCountRef.current === 0)
    )
      return;
    if (isUntitledPath(targetPath) || isChangelogPath(targetPath)) return;

    pendingSaveCountRef.current += 1;
    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
      if (targetPath === currentFilePathRef.current) {
        currentOriginalContentRef.current = targetContent;
        setHasChanges(currentContentRef.current !== targetContent);
        setLastSaved(new Date());
        if (currentContentRef.current !== targetContent) scheduleAutoSaveRef.current();
      }
      emitFileSaved(targetPath, 'auto');
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      pendingSaveCountRef.current -= 1;
      setAutoSaving(pendingSaveCountRef.current > 0);
    }
  }, [currentContentRef, currentFilePathRef, currentOriginalContentRef, readOnlyRef]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    if (!readOnlyRef.current) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        autoSaveTimeoutRef.current = null;
        void autoSaveFile();
      }, AUTO_SAVE_DELAY);
    }
  }, [autoSaveFile, autoSaveTimeoutRef, readOnlyRef]);

  const handleManualSave = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    const targetContent = currentContentRef.current;
    if (!targetPath) return false;
    if (readOnlyRef.current) return true;

    if (isUntitledPath(targetPath)) {
      if (!onSaveUntitledRef.current) return false;
      return (await onSaveUntitledRef.current(targetPath, targetContent)) === true;
    }
    if (isChangelogPath(targetPath)) return true;

    if (
      currentContentRef.current === currentOriginalContentRef.current &&
      pendingSaveCountRef.current === 0
    ) {
      toast.success('文件已是最新状态');
      return true;
    }

    pendingSaveCountRef.current += 1;
    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
      if (targetPath === currentFilePathRef.current) {
        currentOriginalContentRef.current = targetContent;
        setHasChanges(currentContentRef.current !== targetContent);
        setLastSaved(new Date());
        if (currentContentRef.current !== targetContent) scheduleAutoSaveRef.current();
      }
      emitFileSaved(targetPath, 'manual');
      toast.success('保存成功');
      return (
        currentFilePathRef.current === targetPath && currentContentRef.current === targetContent
      );
    } catch (err) {
      console.error('Manual save failed:', err);
      toast.error('保存失败');
      return false;
    } finally {
      pendingSaveCountRef.current -= 1;
      setAutoSaving(pendingSaveCountRef.current > 0);
    }
  }, [
    currentContentRef,
    currentFilePathRef,
    currentOriginalContentRef,
    onSaveUntitledRef,
    readOnlyRef,
    toast,
  ]);

  useEffect(() => {
    handleManualSaveRef.current = handleManualSave;
    scheduleAutoSaveRef.current = scheduleAutoSave;
  }, [handleManualSave, scheduleAutoSave]);

  useEffect(
    () => () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      scheduleAutoSaveRef.current = () => {};
    },
    [autoSaveTimeoutRef]
  );

  return {
    pendingSaveCountRef,
    autoSaving,
    lastSaved,
    setLastSaved,
    hasChanges,
    setHasChanges,
    scheduleAutoSave,
    handleManualSave,
    handleManualSaveRef,
  };
}
