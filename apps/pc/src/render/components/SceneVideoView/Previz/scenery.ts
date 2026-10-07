/**
 * 3D 预演的场景元素：简单道具（墙、门、桌椅、柱、树、箱子）与时段氛围（白天 / 黄昏 / 夜晚）。纯数据 + 纯函数。
 */

import type { PrevizMood, PrevizPropKind } from '@novel-editor/video';

export type PropKind = PrevizPropKind;

export interface PropPreset {
  kind: PropKind;
  label: string;
  /** 占地半径（米）：选中标记按它放大 */
  radius: number;
}

export const PROP_PRESETS: readonly PropPreset[] = [
  { kind: 'wall', label: '墙', radius: 1.6 },
  { kind: 'door', label: '门', radius: 0.7 },
  { kind: 'table', label: '桌子', radius: 0.8 },
  { kind: 'chair', label: '椅子', radius: 0.35 },
  { kind: 'pillar', label: '柱子', radius: 0.35 },
  { kind: 'tree', label: '树', radius: 1 },
  { kind: 'crate', label: '箱子', radius: 0.4 },
  { kind: 'box', label: '方块', radius: 0.5 },
  { kind: 'cylinder', label: '圆柱', radius: 0.25 },
  { kind: 'sphere', label: '球', radius: 0.25 },
];

export function propPreset(kind: PropKind): PropPreset {
  return PROP_PRESETS.find((item) => item.kind === kind) ?? PROP_PRESETS[0];
}

export type MoodId = PrevizMood;

export interface MoodPreset {
  id: MoodId;
  label: string;
  /** 天空顶部 / 地平线颜色 */
  skyTop: string;
  skyHorizon: string;
  /** 地面颜色 */
  ground: string;
  /** 半球光：天空 / 地面颜色与强度 */
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** 主光（方向光）颜色、强度、方位（度）与高度角（度） */
  keyColor: string;
  keyIntensity: number;
  keyAzimuth: number;
  keyElevation: number;
  /** 补光强度（从主光对侧打，避免死黑） */
  fillIntensity: number;
  /** 曝光 */
  exposure: number;
}

export const MOODS: readonly MoodPreset[] = [
  {
    id: 'day',
    label: '白天',
    skyTop: '#7fa6cf',
    skyHorizon: '#d9e2ea',
    ground: '#8a8f86',
    hemiSky: '#dfeaf5',
    hemiGround: '#5d5a52',
    hemiIntensity: 1.1,
    keyColor: '#fff4e2',
    keyIntensity: 2.4,
    keyAzimuth: 35,
    keyElevation: 55,
    fillIntensity: 0.35,
    exposure: 1,
  },
  {
    id: 'dusk',
    label: '黄昏',
    skyTop: '#4d4f78',
    skyHorizon: '#e8a274',
    ground: '#6f6158',
    hemiSky: '#e7b590',
    hemiGround: '#3e3340',
    hemiIntensity: 0.8,
    keyColor: '#ffb27a',
    keyIntensity: 2.6,
    keyAzimuth: 70,
    keyElevation: 12,
    fillIntensity: 0.25,
    exposure: 1.05,
  },
  {
    id: 'night',
    label: '夜晚',
    skyTop: '#0d1424',
    skyHorizon: '#26324a',
    ground: '#2c3240',
    hemiSky: '#5a6f99',
    hemiGround: '#141820',
    hemiIntensity: 0.55,
    keyColor: '#a9c2ff',
    keyIntensity: 1.3,
    keyAzimuth: -40,
    keyElevation: 48,
    fillIntensity: 0.2,
    exposure: 1.15,
  },
];

export function moodById(id: string): MoodPreset {
  return MOODS.find((mood) => mood.id === id) ?? MOODS[0];
}

/** 主光方向：方位角（度，0 = 从镜头一侧照来）+ 高度角 → 单位向量（指向光源） */
export function lightDirection(mood: MoodPreset): [number, number, number] {
  const azimuth = (mood.keyAzimuth * Math.PI) / 180;
  const elevation = (mood.keyElevation * Math.PI) / 180;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [
    round(Math.sin(azimuth) * Math.cos(elevation)),
    round(Math.sin(elevation)),
    round(Math.cos(azimuth) * Math.cos(elevation)),
  ];
}
