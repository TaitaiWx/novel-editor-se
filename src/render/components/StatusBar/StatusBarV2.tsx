import React, { useState, useEffect, useRef, memo } from 'react';
import { AiOutlineEye, AiOutlineEdit, AiOutlineFileText, AiOutlineBarChart } from 'react-icons/ai';
import { BiTime } from 'react-icons/bi';
import { StatsManager } from '../../constants/StatsManager';
import { StatusBarV2Props, DailyStats } from './types';
import { formatTime } from '../../utils/datetime';
import styles from './styles.module.scss';

const StatusBarV2: React.FC<StatusBarV2Props> = memo(
  ({ selectedFile: _selectedFile, content, cursorPosition }) => {
    const [dailyStats, setDailyStats] = useState<DailyStats>({
      totalInputChars: 0,
      totalActiveTime: 0,
      totalEffectiveTime: 0,
      date: new Date().toISOString().split('T')[0],
    });

    const [currentDocumentStats, setCurrentDocumentStats] = useState({
      totalChars: 0,
      totalLines: 0,
    });

    const statsManagerRef = useRef<StatsManager | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const unsubscribeDocumentRef = useRef<(() => void) | null>(null);

    // 初始化统计管理器
    useEffect(() => {
      statsManagerRef.current = StatsManager.getInstance();

      // 将 StatsManager 实例暴露到全局，供其他组件使用
      window.statsManager = statsManagerRef.current;

      // 订阅实时统计更新（包括总时间和有效时间的每秒更新）
      unsubscribeRef.current = statsManagerRef.current.subscribe(setDailyStats);

      // 订阅文档统计更新
      unsubscribeDocumentRef.current =
        statsManagerRef.current.subscribeDocumentStats(setCurrentDocumentStats);

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
        if (unsubscribeDocumentRef.current) {
          unsubscribeDocumentRef.current();
        }
        window.removeEventListener('save', handleSave as EventListener);

        // 清理全局引用
        if (window.statsManager === statsManagerRef.current) {
          delete window.statsManager;
        }
      };
    }, []);

    // 更新当前文档统计 - 现在由 StatsManager 处理，不触发时间更新
    useEffect(() => {
      if (content && statsManagerRef.current) {
        // 处理文件切换时的统计更新（只更新文档字数，不影响时间）
        statsManagerRef.current.handleFileSwitch(content, _selectedFile || undefined);
      }
    }, [content, _selectedFile]);

    // 当选择的文件改变时，标记用户活动并处理文件切换（不影响统计时间）
    useEffect(() => {
      if (statsManagerRef.current) {
        statsManagerRef.current.markUserActivity();
      }
    }, [_selectedFile]);

    return (
      <div className={styles.statusBarV2}>
        {/* 统计提示信息 */}
        <div className={styles.statusSection} title="基于实际文档内容的字数统计">
          <AiOutlineBarChart className={styles.icon} />
          <span className={`${styles.value} ${styles.notice}`}>基于实际文档内容统计</span>
        </div>

        <div className={`${styles.statusSection} ${styles.clickable}`} title="今日输入字数">
          <AiOutlineEdit className={styles.icon} />
          <span className={styles.value}>{dailyStats.totalInputChars} 字</span>
        </div>

        <div className={styles.statusSection} title="当前文档字数">
          <AiOutlineFileText className={styles.icon} />
          <span className={styles.value}>{currentDocumentStats.totalChars} 字</span>
        </div>

        <div className={styles.statusSection} title="今日总使用时间（应用打开的时间）">
          <BiTime className={styles.icon} />
          <span className={styles.value}>{formatTime(dailyStats.totalActiveTime)}</span>
        </div>

        <div
          className={styles.statusSection}
          title="今日有效写作时间（内容变化期间的时间，内容变化停止10秒后停止计时）"
        >
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
          <span className={styles.value}>{currentDocumentStats.totalLines} 行</span>
        </div>
      </div>
    );
  }
);

// 添加显示名称以便调试
StatusBarV2.displayName = 'StatusBarV2';

export default StatusBarV2;
