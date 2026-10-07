/**
 * 首帧（关键帧）：生成视频前先为镜头生成一张首帧图，作者从 4 张里挑一张；
 * 首帧带上人物参考图（三视图优先）与预演截图（3D 摆拍的构图），视频按这张首帧开始，人物与构图更稳。
 */
import type { Shot } from '@novel-editor/video';
import type { SceneVideoState } from './sceneVideoState';

export const KEYFRAME_CANDIDATES = 4;
export const KEYFRAME_REFERENCE_LIMIT = 4;

/** 首帧提示词：画风 + 景别运镜 + 地点 + 出场人物外貌 + 画面描述（+ 有预演时按参考图构图） */
export function buildKeyframePrompt(
  shot: Shot,
  state: Pick<SceneVideoState, 'style' | 'location' | 'characters'>,
  looks: Readonly<Record<string, string>>,
  hasPreviz: boolean
): string {
  const names = shot.characters?.length ? shot.characters : state.characters;
  const people = names.map((name) => (looks[name] ? `${name}（${looks[name]}）` : name)).join('、');
  const parts = [
    '影视分镜的首帧画面，电影感构图，不要文字',
    state.style ? `${state.style}风格` : '',
    [shot.shotSize, shot.camera].filter(Boolean).join('，'),
    shot.location || state.location ? `地点：${shot.location || state.location}` : '',
    people ? `人物：${people}` : '',
    shot.description.trim(),
    hasPreviz ? '人物站位、朝向与镜头角度按第一张参考图（预演截图）的构图' : '',
    people ? '人物外貌、发型与服装与人物参考图保持一致' : '',
  ].filter(Boolean);
  return parts.join('。').replace(/\u3002\u3002+/g, '。');
}

/** 首帧参考图：预演截图在前（决定构图），其后是镜头人物的参考图，去重后最多 4 张 */
export function keyframeReferences(
  previzPath: string | undefined,
  characterPaths: readonly string[]
): string[] {
  return Array.from(new Set([...(previzPath ? [previzPath] : []), ...characterPaths])).slice(
    0,
    KEYFRAME_REFERENCE_LIMIT
  );
}
