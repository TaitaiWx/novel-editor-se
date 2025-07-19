// 状态栏组件相关类型定义

export interface StatusBarV2Props {
  selectedFile: string | null;
  content: string;
  cursorPosition?: { line: number; column: number };
}

export interface DailyStats {
  totalInputChars: number;
  totalActiveTime: number;
  totalEffectiveTime: number;
  date: string;
}

export interface SavedVersion {
  content: string;
  timestamp: number;
  charCount: number;
}

export interface StatTask {
  id: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

export interface ActivityStatus {
  isActive: boolean;
  lastActivityTime: number;
  timeSinceLastActivity: number;
}

export interface ContentChangeStatus {
  isChanging: boolean;
  lastChangeTime: number;
  timeSinceLastChange: number;
  remainingTime: number;
}

export interface QueueStatus {
  queueLength: number;
  isProcessing: boolean;
  currentTask: StatTask | null;
}

// 扩展全局 Window 接口以包含 statsManager
declare global {
  interface Window {
    statsManager?: any;
  }
}
