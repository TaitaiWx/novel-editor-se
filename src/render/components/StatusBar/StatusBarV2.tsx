import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AiOutlineEye, AiOutlineEdit, AiOutlineFileText, AiOutlineBarChart } from 'react-icons/ai';
import { BiTime } from 'react-icons/bi';

interface StatusBarV2Props {
  selectedFile: string | null;
  content: string;
  cursorPosition?: { line: number; column: number };
}

interface DailyStats {
  totalInputChars: number;
  totalActiveTime: number;
  totalEffectiveTime: number;
  date: string;
}

interface SavedVersion {
  content: string;
  timestamp: number;
  charCount: number;
}

interface StatTask {
  id: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

// 统计管理器 - 单例模式
class StatsManager {
  private static instance: StatsManager;
  private lastStatVersion: SavedVersion | null = null;
  private latestSavedVersion: SavedVersion | null = null;
  private currentTask: StatTask | null = null;
  private taskQueue: StatTask[] = [];
  private isProcessing = false;
  private processingDelay = 1000; // 1秒延迟
  private processingTimeout: NodeJS.Timeout | null = null;
  private subscribers: Set<(stats: DailyStats) => void> = new Set();
  private dailyStats: DailyStats = {
    totalInputChars: 0,
    totalActiveTime: 0,
    totalEffectiveTime: 0,
    date: new Date().toISOString().split('T')[0],
  };

  private constructor() {
    this.loadStatsFromStorage();
    this.startActiveTimeTracking();
  }

  static getInstance(): StatsManager {
    if (!StatsManager.instance) {
      StatsManager.instance = new StatsManager();
    }
    return StatsManager.instance;
  }

  // 订阅统计更新
  subscribe(callback: (stats: DailyStats) => void): () => void {
    this.subscribers.add(callback);
    // 立即返回当前统计
    callback(this.dailyStats);
    
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // 通知所有订阅者
  private notifySubscribers() {
    this.subscribers.forEach(callback => callback(this.dailyStats));
  }

  // 处理文件保存事件
  handleFileSave(filePath: string, content: string, timestamp: number): void {
    const charCount = this.cleanContentForCounting(content).length;
    
    // 创建新版本
    const newVersion: SavedVersion = {
      content,
      timestamp,
      charCount,
    };

    // 更新版本
    this.lastStatVersion = this.latestSavedVersion;
    this.latestSavedVersion = newVersion;

    // 创建统计任务
    const task: StatTask = {
      id: `${filePath}-${timestamp}`,
      filePath,
      oldContent: this.lastStatVersion?.content || '',
      newContent: content,
      timestamp,
    };

    // 添加到队列
    this.taskQueue.push(task);

    // 开始处理
    this.processNextTask();
  }

  // 处理下一个任务
  private processNextTask(): void {
    if (this.isProcessing || this.taskQueue.length === 0) {
      return;
    }

    // 清除之前的延迟
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }

    // 设置延迟处理
    this.processingTimeout = setTimeout(() => {
      this.executeTask();
    }, this.processingDelay);
  }

  // 执行统计任务
  private executeTask(): void {
    if (this.taskQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.taskQueue.shift()!;
    this.currentTask = task;

    try {
      // 计算差异
      const inputChars = this.calculateInputChars(task.oldContent, task.newContent);
      
      // 更新统计
      this.updateDailyStats(inputChars);
      
      // 保存到存储
      this.saveStatsToStorage();
      
      // 通知订阅者
      this.notifySubscribers();
      
    } catch (error) {
      console.error('Error processing stat task:', error);
    } finally {
      this.currentTask = null;
      this.isProcessing = false;
      
      // 处理下一个任务
      if (this.taskQueue.length > 0) {
        this.processNextTask();
      }
    }
  }

  // 计算输入字数差异
  private calculateInputChars(oldContent: string, newContent: string): number {
    const oldClean = this.cleanContentForCounting(oldContent);
    const newClean = this.cleanContentForCounting(newContent);
    
    // 使用最长公共子序列算法计算差异
    const diff = this.calculateDiff(oldClean, newClean);
    
    // 返回新增的字符数
    return Math.max(0, diff.added);
  }

  // 计算文本差异
  private calculateDiff(oldText: string, newText: string): { added: number; removed: number } {
    // 简化的差异计算算法
    // 在实际应用中可以使用更复杂的算法如 Myers 差异算法
    
    const oldLength = oldText.length;
    const newLength = newText.length;
    
    // 找到最长公共前缀
    let commonPrefix = 0;
    while (commonPrefix < oldLength && commonPrefix < newLength && 
           oldText[commonPrefix] === newText[commonPrefix]) {
      commonPrefix++;
    }
    
    // 找到最长公共后缀
    let commonSuffix = 0;
    while (commonSuffix < oldLength - commonPrefix && commonSuffix < newLength - commonPrefix &&
           oldText[oldLength - 1 - commonSuffix] === newText[newLength - 1 - commonSuffix]) {
      commonSuffix++;
    }
    
    // 计算中间部分的差异
    const oldMiddle = oldText.substring(commonPrefix, oldLength - commonSuffix);
    const newMiddle = newText.substring(commonPrefix, newLength - commonSuffix);
    
    return {
      added: newMiddle.length,
      removed: oldMiddle.length,
    };
  }

  // 清理格式字符，只保留实际文字和标点符号
  private cleanContentForCounting(text: string): string {
    return text
      .replace(/\r?\n/g, '') // 去除换行符
      .replace(/\t/g, '') // 去除制表符
      .replace(/\s+/g, '') // 去除所有空白字符（空格、制表符等）
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9.,!?;:'"()\-]/g, ''); // 保留中文、英文、数字和常见标点符号
  }

  // 更新每日统计
  private updateDailyStats(inputChars: number): void {
    const today = new Date().toISOString().split('T')[0];
    
    // 如果是新的一天，重置统计
    if (this.dailyStats.date !== today) {
      this.dailyStats = {
        totalInputChars: 0,
        totalActiveTime: 0,
        totalEffectiveTime: 0,
        date: today,
      };
    }
    
    // 更新输入字数
    this.dailyStats.totalInputChars += inputChars;
  }

  // 开始活跃时间追踪
  private startActiveTimeTracking(): void {
    setInterval(() => {
      const today = new Date().toISOString().split('T')[0];
      
      // 如果是新的一天，重置统计
      if (this.dailyStats.date !== today) {
        this.dailyStats = {
          totalInputChars: 0,
          totalActiveTime: 0,
          totalEffectiveTime: 0,
          date: today,
        };
      }
      
      // 更新活跃时间
      this.dailyStats.totalActiveTime += 1;
      this.dailyStats.totalEffectiveTime += 1;
      
      // 每小时保存一次
      if (this.dailyStats.totalActiveTime % 3600 === 0) {
        this.saveStatsToStorage();
      }
      
      this.notifySubscribers();
    }, 1000);
  }

  // 从存储加载统计
  private loadStatsFromStorage(): void {
    try {
      const stored = localStorage.getItem('dailyStats');
      if (stored) {
        const parsed = JSON.parse(stored);
        const today = new Date().toISOString().split('T')[0];
        
        // 只加载今天的统计
        if (parsed.date === today) {
          this.dailyStats = parsed;
        }
      }
    } catch (error) {
      console.error('Error loading stats from storage:', error);
    }
  }

  // 保存统计到存储
  private saveStatsToStorage(): void {
    try {
      localStorage.setItem('dailyStats', JSON.stringify(this.dailyStats));
    } catch (error) {
      console.error('Error saving stats to storage:', error);
    }
  }

  // 获取当前统计
  getCurrentStats(): DailyStats {
    return { ...this.dailyStats };
  }

  // 获取任务队列状态（用于调试）
  getQueueStatus(): { queueLength: number; isProcessing: boolean; currentTask: StatTask | null } {
    return {
      queueLength: this.taskQueue.length,
      isProcessing: this.isProcessing,
      currentTask: this.currentTask,
    };
  }
}

const StatusBarV2: React.FC<StatusBarV2Props> = ({ selectedFile, content, cursorPosition }) => {
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    totalInputChars: 0,
    totalActiveTime: 0,
    totalEffectiveTime: 0,
    date: new Date().toISOString().split('T')[0],
  });

  const [currentDocumentStats, setCurrentDocumentStats] = useState({
    inputChars: 0,
    totalChars: 0,
    totalLines: 0,
  });

  const statsManagerRef = useRef<StatsManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // 初始化统计管理器
  useEffect(() => {
    statsManagerRef.current = StatsManager.getInstance();
    unsubscribeRef.current = statsManagerRef.current.subscribe(setDailyStats);

    // 监听保存事件
    const handleSave = (event: CustomEvent) => {
      const { filePath, content, timestamp } = event.detail;
      statsManagerRef.current?.handleFileSave(filePath, content, timestamp);
    };

    window.addEventListener('save', handleSave as EventListener);

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      window.removeEventListener('save', handleSave as EventListener);
    };
  }, []);

  // 清理格式字符，只保留实际文字
  const cleanContentForCounting = (text: string): string => {
    return text
      .replace(/\r?\n/g, '') // 去除换行符
      .replace(/\t/g, '') // 去除制表符
      .replace(/\s+/g, '') // 去除所有空白字符（空格、制表符等）
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ''); // 只保留中文、英文、数字
  };

  // 更新当前文档统计
  useEffect(() => {
    if (content) {
      const cleanContent = cleanContentForCounting(content);
      setCurrentDocumentStats({
        inputChars: Math.floor(cleanContent.length * SIMULATED_INPUT_RATIO), // 模拟输入字数
        totalChars: cleanContent.length,
        totalLines: content.split('\n').length,
      });
    }
  }, [content]);

  // 格式化时间显示
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}时${minutes}分${secs}秒`;
    } else if (minutes > 0) {
      return `${minutes}分${secs}秒`;
    } else {
      return `${secs}秒`;
    }
  };

  const statusBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem',
    padding: '0.5rem 1rem',
    backgroundColor: '#2d2d2d',
    borderTop: '1px solid #404040',
    color: '#d4d4d4',
    fontSize: '0.75rem',
    lineHeight: 1,
    minHeight: '28px',
    flexShrink: 0,
    overflowX: 'auto',
    whiteSpace: 'nowrap',
  };

  const statusSectionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    flexShrink: 0,
    transition: 'all 0.2s ease',
    cursor: 'help' as const,
    padding: '0.25rem 0.5rem',
    borderRadius: '0.25rem',
  };

  const iconStyle = {
    fontSize: '0.9rem',
    color: '#007acc',
    flexShrink: 0,
  };

  const valueStyle = {
    color: '#ffffff',
    fontWeight: 600,
    flexShrink: 0,
  };

  return (
    <div style={statusBarStyle}>
      {/* 统计提示信息 */}
      <div style={statusSectionStyle} title="输入统计无法保证完全精确，仅供参考">
        <AiOutlineBarChart style={iconStyle} />
        <span style={{ ...valueStyle, fontSize: '12px', opacity: 0.8 }}>
          输入统计无法保证完全精确，仅供参考
        </span>
      </div>

      <div 
        style={{ ...statusSectionStyle, cursor: 'pointer' }}
        title="今日输入字数"
      >
        <AiOutlineEdit style={iconStyle} />
        <span style={valueStyle}>{dailyStats.totalInputChars} 字</span>
      </div>

      <div style={statusSectionStyle} title="当前文档输入字数">
        <AiOutlineFileText style={iconStyle} />
        <span style={valueStyle}>{currentDocumentStats.inputChars} 字</span>
      </div>

      <div style={statusSectionStyle} title="当前文档总字数">
        <AiOutlineFileText style={iconStyle} />
        <span style={valueStyle}>{currentDocumentStats.totalChars} 字</span>
      </div>

      <div style={statusSectionStyle} title="今日使用时间">
        <BiTime style={iconStyle} />
        <span style={valueStyle}>{formatTime(dailyStats.totalActiveTime)}</span>
      </div>

      <div style={statusSectionStyle} title="今日有效写作时间">
        <AiOutlineEye style={iconStyle} />
        <span style={valueStyle}>{formatTime(dailyStats.totalEffectiveTime)}</span>
      </div>

      {cursorPosition && (
        <div style={statusSectionStyle} title="光标位置">
          <span style={valueStyle}>
            第 {cursorPosition.line} 行，第 {cursorPosition.column} 列
          </span>
        </div>
      )}

      <div style={statusSectionStyle} title="当前文档总行数">
        <span style={valueStyle}>{currentDocumentStats.totalLines} 行</span>
      </div>
    </div>
  );
};

export default StatusBarV2; 