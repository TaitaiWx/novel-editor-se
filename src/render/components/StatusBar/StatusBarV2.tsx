import React, { useState, useEffect } from 'react';
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
        inputChars: Math.floor(cleanContent.length * 0.8), // 模拟输入字数
        totalChars: cleanContent.length,
        totalLines: content.split('\n').length,
      });
    }
  }, [content]);

  // 模拟活跃时间更新
  useEffect(() => {
    const interval = setInterval(() => {
      setDailyStats(prev => ({
        ...prev,
        totalActiveTime: prev.totalActiveTime + 1,
        totalEffectiveTime: prev.totalEffectiveTime + 1,
      }));
    }, 1000);

    return () => clearInterval(interval);
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