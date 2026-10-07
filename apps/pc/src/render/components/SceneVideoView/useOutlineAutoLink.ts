import { useEffect, useRef } from 'react';
import { insertBeatIntoChapterOutline } from '../RightPanel/VolumePlanView/volumeSources';
import { chosenVersionFor, outlineLinkEntry, type SceneVideoState } from './sceneVideoState';

/** 第一个成片出现后，自动在本章章纲里记录这一场的视频（分镜表与成片路径），只记录一次 */
export function useOutlineAutoLink({
  state,
  files,
  workPath,
  chapterPath,
  dbReady,
  updateState,
}: {
  state: SceneVideoState | null;
  files: readonly string[];
  workPath: string | null;
  chapterPath: string;
  dbReady: boolean;
  updateState: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
}): void {
  const linkingRef = useRef(false);
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !state || state.outlineLinked || !workPath || !dbReady || linkingRef.current) {
      return;
    }
    const hasVideo = state.storyboard.shots.some((shot) => chosenVersionFor(state, shot, files));
    if (!hasVideo) return;
    linkingRef.current = true;
    const entry = outlineLinkEntry(state, files);
    void insertBeatIntoChapterOutline(ipc, workPath, chapterPath, entry)
      .then(() => updateState((prev) => ({ ...prev, outlineLinked: true })))
      .catch(() => undefined)
      .finally(() => {
        linkingRef.current = false;
      });
  }, [chapterPath, dbReady, files, state, updateState, workPath]);
}
