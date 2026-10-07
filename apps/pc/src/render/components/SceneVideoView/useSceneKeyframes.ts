import { useCallback, useMemo } from 'react';
import type { Shot } from '@novel-editor/video';
import { notifyWorkspaceFilesChanged } from '@/render/utils/workspaceFiles';
import { KEYFRAME_CANDIDATES, buildKeyframePrompt, keyframeReferences } from './keyframe';
import { shotNumber, type SceneVideoState } from './sceneVideoState';
import type { CharacterBrief } from './storyboardGeneration';
import { referencePathsFor } from './useSceneVideoTasks';

export interface UseSceneKeyframesOptions {
  state: SceneVideoState | null;
  characters: readonly CharacterBrief[];
  /** 人物名 → 参考图（相对作品目录） */
  references: Readonly<Record<string, readonly string[]>>;
  workPath: string | null;
  chapter: string;
  scene: string;
  refreshFiles: () => Promise<void>;
}

/**
 * 首帧 / 预演：保存采用的首帧、预演第一帧与预演视频到场景目录；按画面描述 + 人物参考图 + 预演构图生成首帧候选
 */
export function useSceneKeyframes({
  state,
  characters,
  references,
  workPath,
  chapter,
  scene,
  refreshFiles,
}: UseSceneKeyframesOptions) {
  const looks = useMemo(
    () =>
      Object.fromEntries(
        characters
          .filter((item) => item.appearance)
          .map((item) => [item.name, item.appearance ?? ''])
      ),
    [characters]
  );

  /** 保存首帧 / 预演图片到场景目录，返回相对作品目录的路径 */
  const writeSceneImage = useCallback(
    async (kind: 'keyframe' | 'previz', shot: Shot, data: Uint8Array): Promise<string> => {
      const ipc = window.electron?.ipcRenderer;
      const number = shotNumber(shot);
      if (!ipc || !workPath || number === null) throw new Error('没有打开项目');
      const result = await ipc.invoke('video-scene-write-image', {
        workPath,
        chapter,
        scene,
        kind,
        shotIndex: number,
        data,
      });
      if (!result.ok) throw new Error(result.error.message);
      void refreshFiles();
      notifyWorkspaceFilesChanged();
      return result.data.relativePath;
    },
    [chapter, refreshFiles, scene, workPath]
  );

  /** 保存预演视频（镜头N-预演.mp4，覆盖写入），返回相对作品目录的路径 */
  const writePrevizVideo = useCallback(
    async (shot: Shot, data: Uint8Array, ext: 'mp4' | 'webm'): Promise<string> => {
      const ipc = window.electron?.ipcRenderer;
      const number = shotNumber(shot);
      if (!ipc || !workPath || number === null) throw new Error('没有打开项目');
      const result = await ipc.invoke('video-scene-write-media', {
        workPath,
        chapter,
        scene,
        kind: 'previz-video',
        shotIndex: number,
        ext,
        data,
      });
      if (!result.ok) throw new Error(result.error.message);
      void refreshFiles();
      notifyWorkspaceFilesChanged();
      return result.data.relativePath;
    },
    [chapter, refreshFiles, scene, workPath]
  );

  const generateKeyframes = useCallback(
    async (shot: Shot): Promise<string[]> => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !state) throw new Error('没有打开项目');
      const previz = state.previz[shot.id];
      const result = await ipc.invoke('ai-image-generate', {
        workPath: workPath ?? undefined,
        prompt: buildKeyframePrompt(shot, state, looks, Boolean(previz)),
        aspectRatio: state.aspectRatio,
        count: KEYFRAME_CANDIDATES,
        references: keyframeReferences(previz, referencePathsFor(shot, state, references)),
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data.images.map((image) => image.dataUrl);
    },
    [looks, references, state, workPath]
  );

  return { writeSceneImage, writePrevizVideo, generateKeyframes };
}
