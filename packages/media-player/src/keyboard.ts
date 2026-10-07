/**
 * 播放器快捷键（纯函数）：按键 → 动作。修饰键（⌘ / Ctrl / Alt）一律不处理，留给宿主应用。
 *
 * | 按键 | 动作 |
 * | Space / K | 播放 / 暂停 |  ← / → | ±5 秒 |  ↑ / ↓ | 音量 ±10% |  M | 静音 |  F | 全屏 |
 * | S | 截图 |  R | 开始 / 停止录制 |  < / > | 减速 / 加速 |  C | 字幕 |  P | 画中画 |
 */

export type PlayerKeyAction =
  | 'toggle-play'
  | 'seek-back'
  | 'seek-forward'
  | 'volume-up'
  | 'volume-down'
  | 'toggle-mute'
  | 'toggle-fullscreen'
  | 'screenshot'
  | 'toggle-record'
  | 'speed-down'
  | 'speed-up'
  | 'toggle-captions'
  | 'toggle-pip';

export interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** 焦点在按钮上时空格交给按钮自己 */
  onButton?: boolean;
}

const KEY_ACTIONS: Record<string, PlayerKeyAction> = {
  k: 'toggle-play',
  arrowleft: 'seek-back',
  arrowright: 'seek-forward',
  arrowup: 'volume-up',
  arrowdown: 'volume-down',
  m: 'toggle-mute',
  f: 'toggle-fullscreen',
  s: 'screenshot',
  r: 'toggle-record',
  '<': 'speed-down',
  '>': 'speed-up',
  c: 'toggle-captions',
  p: 'toggle-pip',
};

export function keyAction(input: KeyInput): PlayerKeyAction | null {
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  const key = input.key.toLowerCase();
  if (key === ' ') return input.onButton ? null : 'toggle-play';
  return KEY_ACTIONS[key] ?? null;
}

/** 可选的播放速度 */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** 相邻的播放速度（到头时保持不变） */
export function stepPlaybackRate(current: number, direction: 1 | -1): number {
  const rates = PLAYBACK_RATES as readonly number[];
  const index = rates.findIndex((rate) => Math.abs(rate - current) < 0.001);
  if (index < 0) {
    // 不在列表里：找最近的一档再移动
    const next =
      direction > 0
        ? rates.find((rate) => rate > current)
        : [...rates].reverse().find((rate) => rate < current);
    return next ?? current;
  }
  return rates[Math.min(rates.length - 1, Math.max(0, index + direction))];
}

export function formatRate(rate: number): string {
  return rate === 1 ? '正常' : `${rate}x`;
}
