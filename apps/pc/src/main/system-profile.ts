/**
 * 系统能力探测 — 自动判定低配模式
 *
 * 设计原则：
 * 1. 全自动，不需要用户介入；判定结果只用作"友好降级"，不会影响功能
 * 2. 判定要保守：宁可在中等配置上启用低配优化，也不要在低配上漏判
 * 3. 一次性同步探测，避免阻塞主进程启动
 */
import { cpus, totalmem } from 'os';

export interface SystemProfile {
  /** 是否判定为低配设备 */
  isLowSpec: boolean;
  /** 总内存（GB），保留一位小数 */
  totalMemoryGB: number;
  /** 逻辑 CPU 核数 */
  cpuCount: number;
  /** CPU 单核标称频率（MHz）。0 表示无法获取 */
  cpuSpeedMHz: number;
  /** 触发低配判定的具体原因列表 */
  reasons: string[];
}

/** 内存阈值：< 6GB 视为低配。覆盖 4GB 老机型，对 8GB+ 主流机型友好 */
const LOW_MEMORY_THRESHOLD_GB = 6;
/** 核数阈值：<= 2 物理核（4 逻辑线程及以下）视为低配 */
const LOW_CPU_COUNT_THRESHOLD = 4;
/** CPU 频率阈值：低于 2.4GHz 视为羸弱 CPU */
const LOW_CPU_SPEED_MHZ = 2400;

let cachedProfile: SystemProfile | null = null;

/**
 * 同步探测系统能力。结果会缓存，多次调用复用同一份判定。
 */
export function detectSystemProfile(): SystemProfile {
  if (cachedProfile) return cachedProfile;

  const cpuList = cpus();
  const cpuCount = cpuList.length;
  // 不同型号 CPU 频率差异大，取首核作为参考即可
  const cpuSpeedMHz = cpuList[0]?.speed ?? 0;
  const totalMemoryBytes = totalmem();
  const totalMemoryGB = Math.round((totalMemoryBytes / (1024 * 1024 * 1024)) * 10) / 10;

  const reasons: string[] = [];
  if (totalMemoryGB > 0 && totalMemoryGB < LOW_MEMORY_THRESHOLD_GB) {
    reasons.push(`内存 ${totalMemoryGB}GB < ${LOW_MEMORY_THRESHOLD_GB}GB`);
  }
  if (cpuCount > 0 && cpuCount <= LOW_CPU_COUNT_THRESHOLD) {
    reasons.push(`逻辑核数 ${cpuCount} ≤ ${LOW_CPU_COUNT_THRESHOLD}`);
  }
  if (cpuSpeedMHz > 0 && cpuSpeedMHz < LOW_CPU_SPEED_MHZ) {
    reasons.push(`CPU 频率 ${cpuSpeedMHz}MHz < ${LOW_CPU_SPEED_MHZ}MHz`);
  }

  // 任一指标命中即判定为低配
  const isLowSpec = reasons.length > 0;

  cachedProfile = {
    isLowSpec,
    totalMemoryGB,
    cpuCount,
    cpuSpeedMHz,
    reasons,
  };
  return cachedProfile;
}

/**
 * 仅在测试场景使用：清除缓存以便重新探测
 */
export function __resetSystemProfileForTesting(): void {
  cachedProfile = null;
}
