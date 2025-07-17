import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AiOutlineEye, AiOutlineEdit, AiOutlineFileText, AiOutlineDelete, AiOutlineBarChart } from 'react-icons/ai';
import { BiTime } from 'react-icons/bi';
import { FileEvent, FileEventType, FileState } from '../../types/FileEvent';
import { useFileEvents } from '../../hooks/useFileEvents';
import { diff, DiffOperation } from '../../utils/DiffEngine';
import styles from './styles.module.scss';

interface StatusBarV2Props {
  selectedFile: string | null;
  content: string;
  cursorPosition?: { line: number; column: number };
}

interface DailyStats {
  totalInputChars: number;
  totalActiveTime: number;
  totalEffectiveTime: number;
  date: string; // 格式: YYYY-MM-DD
}

interface DocumentState {
  inputChars: number;
  startTime: number;
  totalChars: number;
  totalLines: number;
  fileInited: boolean;
  lastSavedContent: string; // 上次保存时的内容
  lastSavedTime: number; // 上次保存时间
  lastStatsTime: number; // 上次统计时间
}

interface WeeklyStats {
  date: string;
  inputChars: number;
  activeTime: number;
  effectiveTime: number;
}



// i18n支持
const i18n = {
  zh: {
    statsDisclaimer: '输入统计无法保证完全精确，仅供参考',
    statsInProgress: '正在统计输入量...',
    statsCompleted: '统计完成',
  },
  en: {
    statsDisclaimer: 'Input statistics may not be completely accurate, for reference only',
    statsInProgress: 'Calculating input statistics...',
    statsCompleted: 'Statistics completed',
  }
};

const StatusBarV2: React.FC<StatusBarV2Props> = ({ selectedFile, content, cursorPosition }) => {
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    totalInputChars: 0,
    totalActiveTime: 0,
    totalEffectiveTime: 0,
    date: new Date().toISOString().split('T')[0],
  });

  // 30天历史数据
  const [historicalStats, setHistoricalStats] = useState<DailyStats[]>([]);
  
  // 使用文档状态映射来管理多个文档的状态
  const [documentStates, setDocumentStates] = useState<Record<string, DocumentState>>({});
  const [currentDocumentState, setCurrentDocumentState] = useState<DocumentState>({
    inputChars: 0,
    startTime: Date.now(),
    totalChars: 0,
    totalLines: 0,
    fileInited: false,
    lastSavedContent: '',
    lastSavedTime: 0,
    lastStatsTime: 0,
  });

  const [isActive, setIsActive] = useState(true);
  const [isEffectiveTimeActive, setIsEffectiveTimeActive] = useState(false);
  const [showWeeklyStats, setShowWeeklyStats] = useState(false);

  // 文件状态管理
  const [fileState, setFileState] = useState<FileState>(FileState.NONE);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [isFileLoading, setIsFileLoading] = useState(false);

  // 统计状态管理
  const [isStatsInProgress, setIsStatsInProgress] = useState(false);
  const [statsMessage, setStatsMessage] = useState('');

  // 定时器引用
  const effectiveTimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeTimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const effectiveTimeStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dateCheckTimerRef = useRef<NodeJS.Timeout | null>(null);
  const statsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 语言设置（默认中文）
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');

  // 获取i18n文本
  const t = useCallback((key: keyof typeof i18n.zh) => {
    return i18n[language][key];
  }, [language]);

  // 检查是否为开发模式
  const isDevMode = process.env.NODE_ENV === 'development';

  // 清理格式字符，只保留实际文字
  const cleanContentForCounting = useCallback((text: string): string => {
    return text
      .replace(/\r?\n/g, '') // 去除换行符
      .replace(/\t/g, '') // 去除制表符
      .replace(/\s+/g, '') // 去除所有空白字符（空格、制表符等）
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ''); // 只保留中文、英文、数字
  }, []);

  // 使用高性能diff引擎
  const calculateTextDiff = useCallback((oldText: string, newText: string): DiffOperation[] => {
    const result = diff(oldText, newText, {
      chunkSize: 10240, // 10KB
      maxFileSize: 50 * 1024 * 1024, // 50MB
      ignoreWhitespace: false,
      ignoreCase: false
    });
    return result.operations;
  }, []);

  // 基于diff的字符统计
  const calculateStatsFromDiff = useCallback((diffOperations: DiffOperation[]): number => {
    let totalAdded = 0;
    
    for (const operation of diffOperations) {
      if (operation.type === 'add') {
        // 只统计新增的内容，过滤格式字符
        const cleanContent = cleanContentForCounting(operation.content);
        totalAdded += cleanContent.length;
      }
    }
    
    return totalAdded;
  }, [cleanContentForCounting]);

  // 保存文档状态到 localStorage
  const saveDocumentStates = useCallback((states: Record<string, DocumentState>) => {
    localStorage.setItem('novel-editor-document-states', JSON.stringify(states));
  }, []);

  // 更新今日统计数据
  const updateDailyStats = useCallback((updater: (prev: DailyStats) => DailyStats) => {
    setDailyStats(prev => {
      const newStats = updater(prev);
      
      // 同时更新历史数据，避免无限循环
      setHistoricalStats(prevHistorical => {
        const updatedHistorical = prevHistorical.map(stat => 
          stat.date === newStats.date ? newStats : stat
        );
        // 直接保存到localStorage，不触发额外的状态更新
        localStorage.setItem('novel-editor-historical-stats', JSON.stringify(updatedHistorical));
        return updatedHistorical;
      });
      
      return newStats;
    });
  }, []);

  // 触发统计机制
  const triggerStatsCalculation = useCallback(() => {
    if (!currentDocumentState.fileInited || !content || !currentFilePath) {
      return;
    }

    const now = Date.now();
    const timeSinceLastStats = now - currentDocumentState.lastStatsTime;
    
    // 防重复统计：如果距离上次统计不到10秒，则跳过
    if (timeSinceLastStats < 10000) {
      return;
    }

    // 如果统计正在进行中，跳过
    if (isStatsInProgress) {
      return;
    }

    setIsStatsInProgress(true);
    setStatsMessage(t('statsInProgress'));

    // 使用setTimeout确保UI更新
    setTimeout(() => {
      try {
        const lastContent = currentDocumentState.lastSavedContent;
        if (!lastContent) {
          setIsStatsInProgress(false);
          setStatsMessage('');
          return;
        }

        // 计算diff
        const diffOperations = calculateTextDiff(lastContent, content);
        const addedChars = calculateStatsFromDiff(diffOperations);

        if (addedChars > 0) {
          // 更新统计
          const updatedState: DocumentState = {
            ...currentDocumentState,
            inputChars: currentDocumentState.inputChars + addedChars,
            totalChars: cleanContentForCounting(content).length,
            totalLines: content.split('\n').length,
            lastSavedContent: content,
            lastSavedTime: now,
            lastStatsTime: now,
          };

          setCurrentDocumentState(updatedState);
          setDocumentStates(prevStates => {
            const updatedStates = { ...prevStates, [currentFilePath]: updatedState };
            saveDocumentStates(updatedStates);
            return updatedStates;
          });

          updateDailyStats(prev => ({
            ...prev,
            totalInputChars: prev.totalInputChars + addedChars,
          }));

          setStatsMessage(t('statsCompleted'));
        } else {
          // 没有新增字符，只更新状态
          const updatedState: DocumentState = {
            ...currentDocumentState,
            totalChars: cleanContentForCounting(content).length,
            totalLines: content.split('\n').length,
            lastSavedContent: content,
            lastSavedTime: now,
            lastStatsTime: now,
          };

          setCurrentDocumentState(updatedState);
          setDocumentStates(prevStates => {
            const updatedStates = { ...prevStates, [currentFilePath]: updatedState };
            saveDocumentStates(updatedStates);
            return updatedStates;
          });

          setStatsMessage(t('statsCompleted'));
        }

        // 3秒后清除消息
        setTimeout(() => {
          setStatsMessage('');
        }, 3000);

      } catch (error) {
        setStatsMessage('');
      } finally {
        setIsStatsInProgress(false);
      }
    }, 100);
  }, [currentDocumentState, content, currentFilePath, isStatsInProgress, calculateTextDiff, calculateStatsFromDiff, cleanContentForCounting, saveDocumentStates, updateDailyStats, t]);

  // 有效时间管理 - 基于文档内容变化
  const handleContentChange = useCallback(() => {
    // 只有在文件已初始化且有内容时才启动有效时间
    if (currentDocumentState.fileInited && content && currentFilePath) {
      // 启动有效时间计时
      setIsEffectiveTimeActive(true);
      
      // 清除之前的停止定时器
      if (effectiveTimeStopTimeoutRef.current) {
        clearTimeout(effectiveTimeStopTimeoutRef.current);
      }
      
      // 5秒后停止有效时间计时
      effectiveTimeStopTimeoutRef.current = setTimeout(() => {
        setIsEffectiveTimeActive(false);
      }, 5000);
    }
  }, [currentDocumentState.fileInited, content, currentFilePath]);

  // 从 localStorage 加载数据
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    
    // 加载历史统计数据
    const savedHistoricalStats = localStorage.getItem('novel-editor-historical-stats');
    if (savedHistoricalStats) {
      const parsed = JSON.parse(savedHistoricalStats);
      setHistoricalStats(parsed);
      
      // 查找今天的数据
      const todayStats = parsed.find((stat: DailyStats) => stat.date === today);
      if (todayStats) {
        setDailyStats(todayStats);
      } else {
        // 如果没有今天的数据，创建新的
        const newTodayStats: DailyStats = {
          totalInputChars: 0,
          totalActiveTime: 0,
          totalEffectiveTime: 0,
          date: today,
        };
        setDailyStats(newTodayStats);
        
        // 添加到历史数据中
        const updatedHistorical = [...parsed, newTodayStats];
        setHistoricalStats(updatedHistorical);
        localStorage.setItem('novel-editor-historical-stats', JSON.stringify(updatedHistorical));
      }
    } else {
      // 如果没有历史数据，创建今天的数据
      const newTodayStats: DailyStats = {
        totalInputChars: 0,
        totalActiveTime: 0,
        totalEffectiveTime: 0,
        date: today,
      };
      setDailyStats(newTodayStats);
      setHistoricalStats([newTodayStats]);
      localStorage.setItem('novel-editor-historical-stats', JSON.stringify([newTodayStats]));
    }

    // 加载文档状态
    const savedDocumentStates = localStorage.getItem('novel-editor-document-states');
    if (savedDocumentStates) {
      const parsed = JSON.parse(savedDocumentStates);
      setDocumentStates(parsed);
    }
  }, []);

  // 保存历史统计数据
  const saveHistoricalStats = useCallback((stats: DailyStats[]) => {
    // 只保留最近30天的数据
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
    
    const filteredStats = stats.filter(stat => stat.date >= cutoffDate);
    localStorage.setItem('novel-editor-historical-stats', JSON.stringify(filteredStats));
    setHistoricalStats(filteredStats);
  }, []);



  // 开发模式：清理所有数据
  const clearAllData = useCallback(() => {
    if (isDevMode && window.confirm('确定要清理所有统计数据吗？此操作不可恢复。')) {
      localStorage.removeItem('novel-editor-historical-stats');
      localStorage.removeItem('novel-editor-document-states');
      
      const today = new Date().toISOString().split('T')[0];
      const newStats: DailyStats = {
        totalInputChars: 0,
        totalActiveTime: 0,
        totalEffectiveTime: 0,
        date: today,
      };
      
      setDailyStats(newStats);
      setHistoricalStats([newStats]);
      setDocumentStates({});
      
      // 只重置当前文档的输入统计，保留总字数以避免将现有内容计入新统计
      const resetDocumentState: DocumentState = {
        ...currentDocumentState,
        inputChars: 0, // 只重置输入字数，保留其他状态
        lastSavedContent: content, // 更新为当前内容
        lastSavedTime: Date.now(),
        lastStatsTime: Date.now(),
      };
      setCurrentDocumentState(resetDocumentState);
      
      alert('所有统计数据已清理');
    }
  }, [isDevMode, currentDocumentState, content]);

  // 检查日期变化并归档数据
  const checkDateChange = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    const currentDate = dailyStats.date;
    
    if (today !== currentDate) {
      // 归档昨天的数据（已经在历史数据中了）
      // 创建今天的新数据
      const newTodayStats: DailyStats = {
        totalInputChars: 0,
        totalActiveTime: 0,
        totalEffectiveTime: 0,
        date: today,
      };
      
      setDailyStats(newTodayStats);
      setHistoricalStats(prevHistorical => {
        const updatedHistorical = [...prevHistorical, newTodayStats];
        localStorage.setItem('novel-editor-historical-stats', JSON.stringify(updatedHistorical));
        return updatedHistorical;
      });
    }
  }, [dailyStats.date]);

  // 获取七日统计数据
  const getWeeklyStats = useCallback((): WeeklyStats[] => {
    const today = new Date();
    const weeklyStats: WeeklyStats[] = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayStats = historicalStats.find(stat => stat.date === dateStr);
      weeklyStats.push({
        date: dateStr,
        inputChars: dayStats?.totalInputChars || 0,
        activeTime: dayStats?.totalActiveTime || 0,
        effectiveTime: dayStats?.totalEffectiveTime || 0,
      });
    }
    
    return weeklyStats;
  }, [historicalStats]);

  // 启动日期检查定时器
  const startDateCheckTimer = useCallback(() => {
    if (dateCheckTimerRef.current) {
      clearInterval(dateCheckTimerRef.current);
    }
    dateCheckTimerRef.current = setInterval(checkDateChange, 60000); // 每分钟检查一次
  }, [checkDateChange]);

  // 停止日期检查定时器
  const stopDateCheckTimer = useCallback(() => {
    if (dateCheckTimerRef.current) {
      clearInterval(dateCheckTimerRef.current);
      dateCheckTimerRef.current = null;
    }
  }, []);

  // 文件事件处理
  const handleFileSelected = useCallback((event: FileEvent) => {
    setFileState(FileState.SELECTED);
    setCurrentFilePath(event.filePath);
    setIsFileLoading(false);
    
    if (event.filePath) {
      // 检查是否已存在该文档的状态
      const existingState = documentStates[event.filePath];
      if (existingState) {
        setCurrentDocumentState(existingState);
      } else {
        const newState: DocumentState = {
          inputChars: 0,
          startTime: Date.now(),
          totalChars: 0,
          totalLines: 0,
          fileInited: false,
          lastSavedContent: '',
          lastSavedTime: 0,
          lastStatsTime: 0,
        };
        setCurrentDocumentState(newState);
        const updatedStates = { ...documentStates, [event.filePath]: newState };
        setDocumentStates(updatedStates);
        saveDocumentStates(updatedStates);
      }
    } else {
      setCurrentDocumentState({
        inputChars: 0,
        startTime: Date.now(),
        totalChars: 0,
        totalLines: 0,
        fileInited: false,
        lastSavedContent: '',
        lastSavedTime: 0,
        lastStatsTime: 0,
      });
    }
  }, [documentStates, saveDocumentStates]);

  const handleFileLoading = useCallback((event: FileEvent) => {
    setFileState(FileState.LOADING);
    setCurrentFilePath(event.filePath);
    setIsFileLoading(true);
    setIsEffectiveTimeActive(false);
    if (effectiveTimeIntervalRef.current) {
      clearInterval(effectiveTimeIntervalRef.current);
      effectiveTimeIntervalRef.current = null;
    }
  }, []);

  const handleFileLoaded = useCallback((event: FileEvent) => {
    setFileState(FileState.LOADED);
    setCurrentFilePath(event.filePath);
    setIsFileLoading(false);
    
    if (event.filePath && event.content) {
      // 使用字符清理函数计算实际文字数量
      const cleanContent = cleanContentForCounting(event.content);
      const updatedState: DocumentState = {
        ...currentDocumentState,
        totalChars: cleanContent.length,
        totalLines: event.content.split('\n').length,
        fileInited: true,
        lastSavedContent: event.content,
        lastSavedTime: Date.now(),
        lastStatsTime: Date.now(),
      };
      setCurrentDocumentState(updatedState);
      setDocumentStates(prevStates => {
        const updatedStates = { ...prevStates, [event.filePath!]: updatedState };
        saveDocumentStates(updatedStates);
        return updatedStates;
      });
    }
  }, [currentDocumentState, saveDocumentStates, cleanContentForCounting]);

  const handleFileLoadError = useCallback((event: FileEvent) => {
    setFileState(FileState.ERROR);
    setCurrentFilePath(event.filePath);
    setIsFileLoading(false);
    setCurrentDocumentState({
      inputChars: 0,
      startTime: Date.now(),
      totalChars: 0,
      totalLines: 0,
      fileInited: false,
      lastSavedContent: '',
      lastSavedTime: 0,
      lastStatsTime: 0,
    });
  }, []);

  // 订阅文件事件
  useFileEvents({
    onFileSelected: handleFileSelected,
    onFileLoading: handleFileLoading,
    onFileLoaded: handleFileLoaded,
    onFileLoadError: handleFileLoadError,
  });

  // 监听保存事件（自动保存或手动保存）
  useEffect(() => {
    const handleSave = () => {
      triggerStatsCalculation();
    };

    // 监听快捷键保存事件
    const handleShortcutSave = () => {
      triggerStatsCalculation();
    };

    // 监听自动保存完成事件（通过自定义事件）
    window.addEventListener('save', handleSave);
    window.addEventListener('shortcut-save-file', handleShortcutSave);
    
    return () => {
      window.removeEventListener('save', handleSave);
      window.removeEventListener('shortcut-save-file', handleShortcutSave);
    };
  }, [triggerStatsCalculation]);

  // 监听文档内容变化，管理有效时间
  useEffect(() => {
    // 只有在文件已加载完成且有内容时才处理
    if (currentDocumentState.fileInited && content && currentFilePath) {
      handleContentChange();
    }
  }, [content, currentDocumentState.fileInited, currentFilePath, handleContentChange]);

  // 监听用户活动
  useEffect(() => {
    const handleActivity = () => {
      setIsActive(true);
    };

    const handleVisibilityChange = () => {
      setIsActive(!document.hidden);
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 计算使用时间
  useEffect(() => {
    // 每秒更新活跃时间
    activeTimeIntervalRef.current = setInterval(() => {
      // 如果窗口活跃，更新总使用时间
      if (isActive && !document.hidden) {
        setDailyStats(prev => {
          const newStats = {
            ...prev,
            totalActiveTime: prev.totalActiveTime + 1,
          };
          
          // 直接更新历史数据，避免无限循环
          setHistoricalStats(prevHistorical => {
            const updatedHistorical = prevHistorical.map(stat => 
              stat.date === newStats.date ? newStats : stat
            );
            // 直接保存到localStorage，不触发额外的状态更新
            localStorage.setItem('novel-editor-historical-stats', JSON.stringify(updatedHistorical));
            return updatedHistorical;
          });
          
          return newStats;
        });
      }
    }, 1000);

    return () => {
      if (activeTimeIntervalRef.current) {
        clearInterval(activeTimeIntervalRef.current);
      }
    };
  }, [isActive]);

  // 计算有效时间（基于内容变化和用户活动状态）
  useEffect(() => {
    if (effectiveTimeIntervalRef.current) {
      clearInterval(effectiveTimeIntervalRef.current);
    }

    // 只有在有效时间激活且文件已初始化时才开始计时
    if (isEffectiveTimeActive && currentDocumentState.fileInited) {
      effectiveTimeIntervalRef.current = setInterval(() => {
        // 只有在有效时间激活状态且窗口活跃时才计时
        if (isActive && !document.hidden) {
          setDailyStats(prev => {
            const newStats = {
              ...prev,
              totalEffectiveTime: prev.totalEffectiveTime + 1,
            };
            
            // 直接更新历史数据，避免无限循环
            setHistoricalStats(prevHistorical => {
              const updatedHistorical = prevHistorical.map(stat => 
                stat.date === newStats.date ? newStats : stat
              );
              // 直接保存到localStorage，不触发额外的状态更新
              localStorage.setItem('novel-editor-historical-stats', JSON.stringify(updatedHistorical));
              return updatedHistorical;
            });
            
            return newStats;
          });
        }
      }, 1000);
    }

    return () => {
      if (effectiveTimeIntervalRef.current) {
        clearInterval(effectiveTimeIntervalRef.current);
      }
    };
  }, [isEffectiveTimeActive, isActive, currentDocumentState.fileInited]);

  // 启动日期检查定时器
  useEffect(() => {
    startDateCheckTimer();
    return () => {
      stopDateCheckTimer();
    };
  }, [startDateCheckTimer, stopDateCheckTimer]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (effectiveTimeStopTimeoutRef.current) {
        clearTimeout(effectiveTimeStopTimeoutRef.current);
      }
    };
  }, []);

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

  // 格式化日期显示
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (dateStr === today.toISOString().split('T')[0]) {
      return '今天';
    } else if (dateStr === yesterday.toISOString().split('T')[0]) {
      return '昨天';
    } else {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
  };

  const weeklyStats = getWeeklyStats();

  return (
    <>
      <div className={styles.statusBar}>
        {/* 统计提示信息 */}
        <div className={styles.statusSection} title={t('statsDisclaimer')}>
          <AiOutlineBarChart className={styles.icon} />
          <span className={styles.value} style={{ fontSize: '12px', opacity: 0.8 }}>
            {t('statsDisclaimer')}
          </span>
        </div>

        {/* 统计状态信息 */}
        {statsMessage && (
          <div className={styles.statusSection} style={{ color: '#4CAF50' }}>
            <span className={styles.value} style={{ fontSize: '12px' }}>
              {statsMessage}
            </span>
          </div>
        )}

        <div 
          className={styles.statusSection} 
          title="今日输入字数"
          onClick={() => setShowWeeklyStats(true)}
          style={{ cursor: 'pointer' }}
        >
          <AiOutlineEdit className={styles.icon} />
          <span className={styles.value}>{dailyStats.totalInputChars} 字</span>
        </div>

        <div className={styles.statusSection} title="当前文档输入字数">
          <AiOutlineFileText className={styles.icon} />
          <span className={styles.value}>{currentDocumentState.inputChars} 字</span>
        </div>

        <div className={styles.statusSection} title="当前文档总字数">
          <AiOutlineFileText className={styles.icon} />
          <span className={styles.value}>{currentDocumentState.totalChars} 字</span>
        </div>

        <div className={styles.statusSection} title="今日使用时间">
          <BiTime className={styles.icon} />
          <span className={styles.value}>{formatTime(dailyStats.totalActiveTime)}</span>
        </div>

        <div className={styles.statusSection} title="今日有效写作时间">
          <AiOutlineEye className={styles.icon} />
          <span className={styles.value}>{formatTime(dailyStats.totalEffectiveTime)}</span>
        </div>

        {cursorPosition && (
          <div className={styles.statusSection} title="光标位置">
            <span className={styles.value}>
              第 {cursorPosition.line} 行，第 {cursorPosition.column} 列
            </span>
          </div>
        )}

        <div className={styles.statusSection} title="当前文档总行数">
          <span className={styles.value}>{currentDocumentState.totalLines} 行</span>
        </div>

        {isDevMode && (
          <div 
            className={styles.statusSection} 
            title="清理所有数据（开发模式）"
            onClick={clearAllData}
            style={{ cursor: 'pointer', color: '#ff6b6b' }}
          >
            <AiOutlineDelete className={styles.icon} />
            <span className={styles.value}>清理数据</span>
          </div>
        )}
      </div>

      {/* 七日统计弹窗 */}
      {showWeeklyStats && (
        <div className={styles.modalOverlay} onClick={() => setShowWeeklyStats(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>七日数据统计</h3>
              <button 
                className={styles.closeButton}
                onClick={() => setShowWeeklyStats(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.weeklyStats}>
                {weeklyStats.map((stat, index) => (
                  <div key={stat.date} className={styles.weeklyStatItem}>
                    <div className={styles.weeklyStatDate}>{formatDate(stat.date)}</div>
                    <div className={styles.weeklyStatData}>
                      <div className={styles.weeklyStatRow}>
                        <span>输入字数:</span>
                        <span>{stat.inputChars} 字</span>
                      </div>
                      <div className={styles.weeklyStatRow}>
                        <span>使用时间:</span>
                        <span>{formatTime(stat.activeTime)}</span>
                      </div>
                      <div className={styles.weeklyStatRow}>
                        <span>有效时间:</span>
                        <span>{formatTime(stat.effectiveTime)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StatusBarV2; 