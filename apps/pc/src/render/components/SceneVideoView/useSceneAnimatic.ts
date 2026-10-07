/**
 * 场景视频的样片：按各镜头选用的成片拼接（含声音），写入场景目录；
 * 全部镜头都有成片且没有进行中的任务时自动合成一次（同一组版本只自动尝试一次）。
 * 从 SceneVideoView/index.tsx 拆出。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoTask } from '@novel-editor/video';
import { notifyWorkspaceFilesChanged } from '@/render/utils/workspaceFiles';
import { chosenVersionFor, shouldAutoStitch, type SceneVideoState } from './sceneVideoState';
import { animaticStoryboard, canStitchAnimatic, stitchAnimatic } from './stitchAnimatic';

export type SceneMessage = { tone: 'info' | 'success' | 'error'; text: string } | null;

export interface UseSceneAnimaticInput {
  state: SceneVideoState | null;
  files: readonly string[];
  tasks: readonly VideoTask[];
  workPath: string | null;
  chapter: string;
  scene: string;
  readFile: (fileName: string) => Promise<Uint8Array>;
  /** 读取作品内的配乐 / 音效（资料/音乐/、资料/音效/） */
  readWorkAudio?: (relativePath: string) => Promise<Uint8Array>;
  refreshFiles: () => Promise<unknown>;
  updateState: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  onMessage: (message: SceneMessage) => void;
}

export function useSceneAnimatic({
  state,
  files,
  tasks,
  workPath,
  chapter,
  scene,
  readFile,
  readWorkAudio,
  refreshFiles,
  updateState,
  onMessage,
}: UseSceneAnimaticInput) {
  const [stitchProgress, setStitchProgress] = useState<number | null>(null);

  const stitch = useCallback(
    async (signature: string | null) => {
      if (!state || !workPath) return;
      const storyboard = animaticStoryboard(
        { ...state.storyboard, aspectRatio: state.aspectRatio },
        state.storyboard.shots.map((shot) => shot.id)
      );
      if (storyboard.shots.length === 0) return;
      const chosen = new Map<string, string>();
      storyboard.shots.forEach((shot) => {
        const file = chosenVersionFor(state, shot, files);
        if (file) chosen.set(shot.id, file);
      });
      setStitchProgress(0);
      try {
        const output = await stitchAnimatic({
          storyboard,
          files: chosen,
          readFile,
          sceneAudio: state.audio,
          readWorkAudio,
          onProgress: setStitchProgress,
        });
        const ipc = window.electron?.ipcRenderer;
        if (!ipc) throw new Error('没有打开项目');
        const result = await ipc.invoke('video-scene-write-animatic', {
          workPath,
          chapter,
          scene,
          ext: output.ext,
          data: output.data,
        });
        if (!result.ok) throw new Error(result.error.message);
        if (signature) updateState((prev) => ({ ...prev, animaticSignature: signature }));
        await refreshFiles();
        notifyWorkspaceFilesChanged();
        onMessage(
          output.audioDropped
            ? {
                tone: 'info',
                text: `样片已保存到资料：${result.data.fileName}（当前环境无法编码声音，样片没有声音；镜头成片的原声不受影响）`,
              }
            : { tone: 'success', text: `样片已保存到资料：${result.data.fileName}` }
        );
      } catch (error) {
        onMessage({
          tone: 'error',
          text: `合成样片失败：${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setStitchProgress(null);
      }
    },
    [
      chapter,
      files,
      onMessage,
      readFile,
      readWorkAudio,
      refreshFiles,
      scene,
      state,
      updateState,
      workPath,
    ]
  );

  const stitchSupported = canStitchAnimatic();
  const autoStitchTriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || !workPath || !stitchSupported || stitchProgress !== null) return;
    const signature = shouldAutoStitch(state, files, tasks);
    if (!signature || autoStitchTriedRef.current === signature) return;
    // 同一组版本只自动尝试一次（失败后由作者在「样片」节点手动重试）
    autoStitchTriedRef.current = signature;
    void stitch(signature);
  }, [files, state, stitch, stitchProgress, stitchSupported, tasks, workPath]);

  return { stitch, stitchProgress, stitchSupported };
}
