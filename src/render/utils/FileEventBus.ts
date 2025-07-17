import { FileEvent, FileEventType } from '../types/FileEvent';

// 事件监听器类型
type EventListener = (event: FileEvent) => void;

// 文件事件总线类
class FileEventBus {
  private listeners: Map<FileEventType, Set<EventListener>> = new Map();
  private isDebugMode: boolean = process.env.NODE_ENV === 'development';

  // 订阅事件
  subscribe(type: FileEventType, callback: EventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    
    const listenerSet = this.listeners.get(type)!;
    listenerSet.add(callback);

    // 返回取消订阅函数
    return () => {
      listenerSet.delete(callback);
      if (listenerSet.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  // 取消订阅
  unsubscribe(type: FileEventType, callback: EventListener): void {
    const listenerSet = this.listeners.get(type);
    if (listenerSet) {
      listenerSet.delete(callback);
      if (listenerSet.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  // 发出事件
  emit(event: FileEvent): void {
    const listenerSet = this.listeners.get(event.type);
    if (listenerSet) {
      listenerSet.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error(`[FileEventBus] Error in event listener for ${event.type}:`, error);
        }
      });
    }
  }

  // 创建事件对象
  createEvent(
    type: FileEventType,
    filePath: string | null,
    content?: string,
    error?: string
  ): FileEvent {
    const event: FileEvent = {
      type,
      filePath,
      content,
      error,
      timestamp: Date.now()
    };
    return event;
  }

  // 获取监听器数量（用于调试）
  getListenerCount(type: FileEventType): number {
    return this.listeners.get(type)?.size || 0;
  }

  // 清理所有监听器
  clear(): void {
    this.listeners.clear();
  }
}

// 创建全局事件总线实例
export const fileEventBus = new FileEventBus();

// 导出便捷方法
export const emitFileEvent = (
  type: FileEventType,
  filePath: string | null,
  content?: string,
  error?: string
) => {
  const event = fileEventBus.createEvent(type, filePath, content, error);
  fileEventBus.emit(event);
};

// 导出类型
export type { EventListener }; 