import {
  DailyStats,
  SavedVersion,
  StatTask,
  ActivityStatus,
  ContentChangeStatus,
  QueueStatus,
} from '../components/StatusBar/types';

// 统计管理器 - 单例模式
export class StatsManager {
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

  // 文件初始状态跟踪
  private fileInitialContent: Map<string, string> = new Map();

  // 每个文件的最后保存状态跟踪
  private fileLastSavedContent: Map<string, string> = new Map();

  // 时间追踪相关
  private totalTimeInterval: NodeJS.Timeout | null = null;
  private effectiveTimeInterval: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private lastContentChangeTime: number = 0; // 最后一次内容变化时间
  private isUserActive: boolean = true;
  private isContentChanging: boolean = false; // 是否正在进行内容变化
  private inactivityThreshold: number = 30000; // 30秒无活动视为非有效时间
  private contentChangeStopDelay: number = 10000; // 内容变化后10秒停止计时
  private contentChangeStopTimeout: NodeJS.Timeout | null = null;

  // 文档统计相关
  private currentDocumentChars: number = 0;
  private documentsUpdateCallbacks: Set<
    (stats: { totalChars: number; totalLines: number }) => void
  > = new Set();

  private constructor() {
    this.loadStatsFromStorage();
    this.startTimeTracking();
    this.setupActivityTracking();
  }

  static getInstance(): StatsManager {
    if (!StatsManager.instance) {
      StatsManager.instance = new StatsManager();
    }
    return StatsManager.instance;
  }

  // 订阅统计更新（总使用时间和有效时间每5秒实时更新，总输入字数在differ完成后更新）
  subscribe(callback: (stats: DailyStats) => void): () => void {
    this.subscribers.add(callback);
    // 立即返回当前统计
    callback(this.dailyStats);

    return () => {
      this.subscribers.delete(callback);
    };
  }

  // 订阅文档统计更新（文档字数在文件切换时立即更新，在differ完成后更新）
  subscribeDocumentStats(
    callback: (stats: { totalChars: number; totalLines: number }) => void
  ): () => void {
    this.documentsUpdateCallbacks.add(callback);

    return () => {
      this.documentsUpdateCallbacks.delete(callback);
    };
  }

  // 通知所有订阅者（用于时间实时更新）
  private notifySubscribers() {
    this.subscribers.forEach((callback) => callback({ ...this.dailyStats }));
  }

  // 通知输入字数更新（用于differ完成后更新，不包含时间）
  private notifyInputStatsSubscribers() {
    this.subscribers.forEach((callback) => callback({ ...this.dailyStats }));
  }

  // 通知文档统计订阅者
  private notifyDocumentSubscribers(stats: { totalChars: number; totalLines: number }) {
    this.documentsUpdateCallbacks.forEach((callback) => callback(stats));
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

    // 确定用于比较的旧内容
    let oldContent = '';

    // 优先使用该文件的最后保存内容作为比较基准
    if (this.fileLastSavedContent.has(filePath)) {
      oldContent = this.fileLastSavedContent.get(filePath)!;
    } else {
      // 如果没有保存记录，使用文件的初始内容（文件打开时的内容）
      oldContent = this.fileInitialContent.get(filePath) || '';
    }

    // 更新该文件的最后保存内容
    this.fileLastSavedContent.set(filePath, content);

    // 更新版本（保持全局的版本追踪）
    this.lastStatVersion = this.latestSavedVersion;
    this.latestSavedVersion = newVersion;

    // 创建统计任务
    const task: StatTask = {
      id: `${filePath}-${timestamp}`,
      filePath,
      oldContent,
      newContent: content,
      timestamp,
    };

    // 添加到队列
    this.taskQueue.push(task);

    // 开始处理
    this.processNextTask();
  }

  // 处理文件切换事件（文档总字数在切换文件时立即更新，不影响时间统计）
  handleFileSwitch(content: string, filePath?: string): void {
    const totalChars = this.cleanContentForCounting(content).length;
    const totalLines = content.split('\n').length;
    this.currentDocumentChars = totalChars;

    // 记录文件的初始内容（用于第一次保存时的differ计算）
    // 每次文件切换都更新该文件的初始状态，确保以当前打开时的内容为基准
    if (filePath) {
      this.fileInitialContent.set(filePath, content);

      // 如果该文件还没有保存记录，也将当前内容作为"最后保存"的基准
      // 这样第一次保存时不会把现有内容算作新输入
      if (!this.fileLastSavedContent.has(filePath)) {
        this.fileLastSavedContent.set(filePath, content);
      }
    }

    // 立即通知文档统计更新（文件切换时实时更新文档字数，不更新时间）
    this.notifyDocumentSubscribers({ totalChars, totalLines });
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

  // 执行统计任务（differ完成后更新字数统计，不影响时间统计）
  private executeTask(): void {
    if (this.taskQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.taskQueue.shift()!;
    this.currentTask = task;

    try {
      // 1. 计算输入字数差异
      const inputChars = this.calculateInputChars(task.oldContent, task.newContent);

      // 2. 更新每日统计（总输入字数在differ完成后更新，不更新时间）
      this.updateDailyStats(inputChars);

      // 3. 计算并更新当前文档统计（文档字数在differ完成后更新）
      const newDocumentChars = this.cleanContentForCounting(task.newContent).length;
      const newDocumentLines = task.newContent.split('\n').length;
      this.currentDocumentChars = newDocumentChars;

      // 4. 保存统计数据到存储
      this.saveStatsToStorage();

      // 5. 通知订阅者更新（differ完成后批量更新字数，不通知时间更新）
      this.notifyInputStatsSubscribers(); // 只更新输入字数显示
      this.notifyDocumentSubscribers({
        totalChars: newDocumentChars,
        totalLines: newDocumentLines,
      }); // 更新文档字数显示
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
    while (
      commonPrefix < oldLength &&
      commonPrefix < newLength &&
      oldText[commonPrefix] === newText[commonPrefix]
    ) {
      commonPrefix++;
    }

    // 找到最长公共后缀
    let commonSuffix = 0;
    while (
      commonSuffix < oldLength - commonPrefix &&
      commonSuffix < newLength - commonPrefix &&
      oldText[oldLength - 1 - commonSuffix] === newText[newLength - 1 - commonSuffix]
    ) {
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
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9.,!?;:'"()\\-]/g, ''); // 保留中文、英文、数字和常见标点符号
  }

  // 更新每日统计（总输入字数在differ完成后更新）
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

    // 更新输入字数（只在differ计算完成后累加）
    this.dailyStats.totalInputChars += inputChars;
  }

  // 开始时间追踪 - 修改为每秒实时更新UI
  private startTimeTracking(): void {
    // 总使用时间 - 应用打开期间一直计时，每秒实时更新UI
    this.totalTimeInterval = setInterval(() => {
      const today = new Date().toISOString().split('T')[0];

      // 如果是新的一天，重置统计
      if (this.dailyStats.date !== today) {
        this.resetDailyStats(today);
      }

      // 总时间始终递增
      this.dailyStats.totalActiveTime += 1;

      // 每分钟保存一次（减少存储频率）
      if (this.dailyStats.totalActiveTime % 60 === 0) {
        this.saveStatsToStorage();
      }

      // 每秒实时通知订阅者更新UI（与文档切换无关）
      this.notifySubscribers();
    }, 1000);

    // 有效时间 - 只在内容变化期间计时，每秒实时更新UI
    this.effectiveTimeInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastContentChange = now - this.lastContentChangeTime;

      // 检查是否在内容变化的有效期内
      const isInContentChangeWindow =
        this.isContentChanging &&
        this.lastContentChangeTime > 0 &&
        timeSinceLastContentChange < this.contentChangeStopDelay;

      if (isInContentChangeWindow) {
        const today = new Date().toISOString().split('T')[0];

        // 如果是新的一天，重置统计
        if (this.dailyStats.date !== today) {
          this.resetDailyStats(today);
        }

        // 有效时间递增
        this.dailyStats.totalEffectiveTime += 1;

        // 每秒实时通知订阅者更新UI（与文档切换无关）
        this.notifySubscribers();
      }
    }, 1000);
  }

  // 设置用户活动追踪
  private setupActivityTracking(): void {
    // 监听各种用户活动事件
    const activityEvents = ['keydown', 'mousedown', 'mousemove', 'scroll', 'click'];

    const updateActivity = () => {
      this.lastActivityTime = Date.now();
      this.isUserActive = true;
    };

    // 为每个活动事件添加监听器
    activityEvents.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    // 监听文件保存事件也算作活动
    window.addEventListener('save', updateActivity);
  }

  // 重置每日统计（新的一天时重置所有统计）
  private resetDailyStats(newDate: string): void {
    this.dailyStats = {
      totalInputChars: 0,
      totalActiveTime: 0, // 新的一天重置总使用时间
      totalEffectiveTime: 0,
      date: newDate,
    };
    this.saveStatsToStorage();
  }

  // 从存储加载统计（包括总使用时间，确保应用重启后不重置）
  private loadStatsFromStorage(): void {
    try {
      const stored = localStorage.getItem('dailyStats');
      if (stored) {
        const parsed = JSON.parse(stored);
        const today = new Date().toISOString().split('T')[0];

        // 如果是今天的数据，加载所有统计（包括总使用时间）
        if (parsed.date === today) {
          this.dailyStats = {
            totalInputChars: parsed.totalInputChars || 0,
            totalActiveTime: parsed.totalActiveTime || 0, // 保持总使用时间
            totalEffectiveTime: parsed.totalEffectiveTime || 0,
            date: today,
          };
        } else {
          // 如果是新的一天，重置所有统计
          this.dailyStats = {
            totalInputChars: 0,
            totalActiveTime: 0,
            totalEffectiveTime: 0,
            date: today,
          };
        }
      } else {
        // 首次使用，初始化为今天的数据
        this.dailyStats = {
          totalInputChars: 0,
          totalActiveTime: 0,
          totalEffectiveTime: 0,
          date: new Date().toISOString().split('T')[0],
        };
      }
    } catch (error) {
      console.error('Error loading stats from storage:', error);
      // 出错时初始化为今天的空数据
      this.dailyStats = {
        totalInputChars: 0,
        totalActiveTime: 0,
        totalEffectiveTime: 0,
        date: new Date().toISOString().split('T')[0],
      };
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
  getQueueStatus(): QueueStatus {
    return {
      queueLength: this.taskQueue.length,
      isProcessing: this.isProcessing,
      currentTask: this.currentTask,
    };
  }

  // 获取用户活跃状态
  getUserActivityStatus(): ActivityStatus {
    const now = Date.now();
    return {
      isActive: this.isUserActive,
      lastActivityTime: this.lastActivityTime,
      timeSinceLastActivity: now - this.lastActivityTime,
    };
  }

  // 手动标记用户活动（可用于特定操作）
  markUserActivity(): void {
    this.lastActivityTime = Date.now();
    this.isUserActive = true;
  }

  // 标记内容变化开始
  markContentChange(): void {
    const now = Date.now();
    this.lastContentChangeTime = now;
    this.lastActivityTime = now;
    this.isContentChanging = true;
    this.isUserActive = true;

    // 清除之前的停止定时器
    if (this.contentChangeStopTimeout) {
      clearTimeout(this.contentChangeStopTimeout);
    }

    // 设置新的停止定时器
    this.contentChangeStopTimeout = setTimeout(() => {
      this.isContentChanging = false;
    }, this.contentChangeStopDelay);
  }

  // 获取内容变化状态
  getContentChangeStatus(): ContentChangeStatus {
    const now = Date.now();
    const timeSinceLastChange = now - this.lastContentChangeTime;
    const remainingTime = Math.max(0, this.contentChangeStopDelay - timeSinceLastChange);

    return {
      isChanging: this.isContentChanging,
      lastChangeTime: this.lastContentChangeTime,
      timeSinceLastChange,
      remainingTime,
    };
  }

  // 清理文件初始内容缓存（当文件关闭或不再需要时调用）
  clearFileInitialContent(filePath: string): void {
    this.fileInitialContent.delete(filePath);
    this.fileLastSavedContent.delete(filePath);
  }

  // 清理所有文件初始内容缓存
  clearAllFileInitialContent(): void {
    this.fileInitialContent.clear();
    this.fileLastSavedContent.clear();
  }

  // 重置文件保存状态（用于测试或调试）
  resetFileState(filePath: string): void {
    this.fileInitialContent.delete(filePath);
    this.fileLastSavedContent.delete(filePath);
  }

  // 清理资源
  destroy(): void {
    if (this.totalTimeInterval) {
      clearInterval(this.totalTimeInterval);
      this.totalTimeInterval = null;
    }
    if (this.effectiveTimeInterval) {
      clearInterval(this.effectiveTimeInterval);
      this.effectiveTimeInterval = null;
    }
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    if (this.contentChangeStopTimeout) {
      clearTimeout(this.contentChangeStopTimeout);
      this.contentChangeStopTimeout = null;
    }
    this.subscribers.clear();
    this.documentsUpdateCallbacks.clear();
    this.fileInitialContent.clear();
    this.fileLastSavedContent.clear();
  }
}
