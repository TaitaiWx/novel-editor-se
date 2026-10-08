export type SettingsTab = 'general' | 'structure' | 'ai' | 'data' | 'shortcuts' | 'about';
export type ClearDataScope = 'document' | 'ai' | 'all';

export interface SystemProfileInfo {
  isLowSpec: boolean;
  totalMemoryGB: number;
  cpuCount: number;
  cpuSpeedMHz: number;
  reasons: string[];
}

export const VALID_TABS: SettingsTab[] = [
  'general',
  'structure',
  'ai',
  'data',
  'shortcuts',
  'about',
];

export const TAB_LABELS: Record<SettingsTab, string> = {
  general: '通用',
  structure: '正文结构',
  ai: 'AI',
  data: '数据与缓存',
  shortcuts: '快捷键',
  about: '关于',
};
