import { useEffect, useRef, useCallback, useState } from 'react';
import { FileEvent, FileEventType, FileState } from '../../types/FileEvent';
import { fileEventBus, EventListener } from '../utils/FileEventBus';

// 文件事件监听器配置
interface FileEventListeners {
  onFileSelected?: (event: FileEvent) => void;
  onFileLoading?: (event: FileEvent) => void;
  onFileLoaded?: (event: FileEvent) => void;
  onFileLoadError?: (event: FileEvent) => void;
  onFileChanged?: (event: FileEvent) => void;
}

// 文件状态管理Hook
export const useFileState = () => {
  const [fileState, setFileState] = useState<FileState>(FileState.NONE);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleFileSelected = useCallback((event: FileEvent) => {
    setFileState(FileState.SELECTED);
    setCurrentFilePath(event.filePath);
    setCurrentContent('');
    setError(null);
  }, []);

  const handleFileLoading = useCallback((event: FileEvent) => {
    setFileState(FileState.LOADING);
    setCurrentFilePath(event.filePath);
    setError(null);
  }, []);

  const handleFileLoaded = useCallback((event: FileEvent) => {
    setFileState(FileState.LOADED);
    setCurrentFilePath(event.filePath);
    setCurrentContent(event.content || '');
    setError(null);
  }, []);

  const handleFileLoadError = useCallback((event: FileEvent) => {
    setFileState(FileState.ERROR);
    setCurrentFilePath(event.filePath);
    setError(event.error || 'Unknown error');
  }, []);

  useFileEvents({
    onFileSelected: handleFileSelected,
    onFileLoading: handleFileLoading,
    onFileLoaded: handleFileLoaded,
    onFileLoadError: handleFileLoadError,
  });

  return {
    fileState,
    currentFilePath,
    currentContent,
    error,
    isFileSelected: fileState === FileState.SELECTED,
    isFileLoading: fileState === FileState.LOADING,
    isFileLoaded: fileState === FileState.LOADED,
    isFileError: fileState === FileState.ERROR,
  };
};

// 文件事件监听Hook
export const useFileEvents = (listeners: FileEventListeners) => {
  const unsubscribeRefs = useRef<Array<() => void>>([]);

  useEffect(() => {
    const unsubscribes: Array<() => void> = [];

    // 订阅各种事件
    if (listeners.onFileSelected) {
      const unsubscribe = fileEventBus.subscribe(
        FileEventType.FILE_SELECTED,
        listeners.onFileSelected
      );
      unsubscribes.push(unsubscribe);
    }

    if (listeners.onFileLoading) {
      const unsubscribe = fileEventBus.subscribe(
        FileEventType.FILE_LOADING,
        listeners.onFileLoading
      );
      unsubscribes.push(unsubscribe);
    }

    if (listeners.onFileLoaded) {
      const unsubscribe = fileEventBus.subscribe(FileEventType.FILE_LOADED, listeners.onFileLoaded);
      unsubscribes.push(unsubscribe);
    }

    if (listeners.onFileLoadError) {
      const unsubscribe = fileEventBus.subscribe(
        FileEventType.FILE_LOAD_ERROR,
        listeners.onFileLoadError
      );
      unsubscribes.push(unsubscribe);
    }

    if (listeners.onFileChanged) {
      const unsubscribe = fileEventBus.subscribe(
        FileEventType.FILE_CHANGED,
        listeners.onFileChanged
      );
      unsubscribes.push(unsubscribe);
    }

    // 保存取消订阅函数
    unsubscribeRefs.current = unsubscribes;

    // 清理函数
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      unsubscribeRefs.current = [];
    };
  }, [
    listeners.onFileSelected,
    listeners.onFileLoading,
    listeners.onFileLoaded,
    listeners.onFileLoadError,
    listeners.onFileChanged,
  ]);

  // 返回手动取消订阅的方法
  const unsubscribe = useCallback(() => {
    unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRefs.current = [];
  }, []);

  return { unsubscribe };
};

// 便捷的事件发出Hook
export const useFileEventEmitter = () => {
  const emitFileSelected = useCallback((filePath: string | null) => {
    fileEventBus.emit(fileEventBus.createEvent(FileEventType.FILE_SELECTED, filePath));
  }, []);

  const emitFileLoading = useCallback((filePath: string) => {
    fileEventBus.emit(fileEventBus.createEvent(FileEventType.FILE_LOADING, filePath));
  }, []);

  const emitFileLoaded = useCallback((filePath: string, content: string) => {
    fileEventBus.emit(fileEventBus.createEvent(FileEventType.FILE_LOADED, filePath, content));
  }, []);

  const emitFileLoadError = useCallback((filePath: string, error: string) => {
    fileEventBus.emit(
      fileEventBus.createEvent(FileEventType.FILE_LOAD_ERROR, filePath, undefined, error)
    );
  }, []);

  const emitFileChanged = useCallback((filePath: string, content: string) => {
    fileEventBus.emit(fileEventBus.createEvent(FileEventType.FILE_CHANGED, filePath, content));
  }, []);

  return {
    emitFileSelected,
    emitFileLoading,
    emitFileLoaded,
    emitFileLoadError,
    emitFileChanged,
  };
};
