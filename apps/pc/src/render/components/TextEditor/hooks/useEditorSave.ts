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
  filePathRef: React.MutableRefObject<string | null>;
  onSaveUntitledRef: React.MutableRefObject<
    ((untitledPath: string, content: string) => void) | undefined
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
  filePathRef,
  onSaveUntitledRef,
  autoSaveTimeoutRef,
  toast,
}: UseEditorSaveOptions) {
  const [autoSaving, setAutoSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const handleManualSaveRef = useRef<() => void>(() => {});

  const autoSaveFile = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    const targetContent = currentContentRef.current;

    if (!targetPath || readOnlyRef.current || targetContent === currentOriginalContentRef.current)
      return;
    if (isUntitledPath(targetPath) || isChangelogPath(targetPath)) return;

    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
      if (targetPath === filePathRef.current) {
        currentOriginalContentRef.current = targetContent;
        setHasChanges(false);
        setLastSaved(new Date());
      }
      emitFileSaved(targetPath, 'auto');
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      setAutoSaving(false);
    }
  }, [currentContentRef, currentFilePathRef, currentOriginalContentRef, filePathRef, readOnlyRef]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    if (!readOnlyRef.current) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        autoSaveFile();
      }, AUTO_SAVE_DELAY);
    }
  }, [autoSaveFile, autoSaveTimeoutRef, readOnlyRef]);

  const handleManualSave = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    if (!targetPath || readOnlyRef.current) return;

    if (isUntitledPath(targetPath)) {
      if (onSaveUntitledRef.current) {
        onSaveUntitledRef.current(targetPath, currentContentRef.current);
      }
      return;
    }
    if (isChangelogPath(targetPath)) return;

    if (currentContentRef.current === currentOriginalContentRef.current) {
      toast.success('文件已是最新状态');
      return;
    }

    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, currentContentRef.current);
      if (targetPath === filePathRef.current) {
        currentOriginalContentRef.current = currentContentRef.current;
        setHasChanges(false);
        setLastSaved(new Date());
      }
      emitFileSaved(targetPath, 'manual');
      toast.success('保存成功');
    } catch (err) {
      console.error('Manual save failed:', err);
      toast.error('保存失败');
    } finally {
      setAutoSaving(false);
    }
  }, [
    currentContentRef,
    currentFilePathRef,
    currentOriginalContentRef,
    filePathRef,
    onSaveUntitledRef,
    readOnlyRef,
    toast,
  ]);

  useEffect(() => {
    handleManualSaveRef.current = handleManualSave;
  }, [handleManualSave]);

  return {
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
