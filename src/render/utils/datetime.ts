/**
 * 日期时间相关工具函数
 */

/**
 * 格式化时间显示（秒转换为时分秒格式）
 * @param seconds 总秒数
 * @returns 格式化后的时间字符串
 */
export const formatTime = (seconds: number): string => {
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

/**
 * 获取今天的日期字符串（YYYY-MM-DD格式）
 * @returns 今天的日期字符串
 */
export const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * 格式化日期显示
 * @param date 日期对象或日期字符串
 * @param format 格式类型，默认为 'YYYY-MM-DD'
 * @returns 格式化后的日期字符串
 */
export const formatDate = (
  date: Date | string,
  format: 'YYYY-MM-DD' | 'MM/DD' | 'full' = 'YYYY-MM-DD'
): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  switch (format) {
    case 'YYYY-MM-DD':
      return dateObj.toISOString().split('T')[0];
    case 'MM/DD':
      return `${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')}`;
    case 'full':
      return dateObj.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });
    default:
      return dateObj.toISOString().split('T')[0];
  }
};

/**
 * 检查两个日期是否为同一天
 * @param date1 第一个日期
 * @param date2 第二个日期
 * @returns 是否为同一天
 */
export const isSameDay = (date1: Date | string, date2: Date | string): boolean => {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;

  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
};

/**
 * 计算两个时间戳之间的时间差（秒）
 * @param startTime 开始时间戳
 * @param endTime 结束时间戳，默认为当前时间
 * @returns 时间差（秒）
 */
export const getTimeDifference = (startTime: number, endTime: number = Date.now()): number => {
  return Math.floor((endTime - startTime) / 1000);
};
