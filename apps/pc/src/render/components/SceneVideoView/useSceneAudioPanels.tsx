/**
 * 场景视频 · 声音的界面拼装（从 SceneVideoView/index.tsx 拆出）：
 * 场景检查器的「声音」分区、镜头检查器的「对白 / 音效」分区，以及样片混音需要的读取函数。
 */
import React, { useCallback, useMemo } from 'react';
import type { CharacterVoice, SceneAudio, Shot } from '@novel-editor/video';
import { SceneAudioSection, ShotAudioSection } from './AudioSection';
import { lineKey, useSceneAudio } from './useSceneAudio';
import { updateShot, type SceneVideoState } from './sceneVideoState';
import type { SceneMessage } from './useSceneAnimatic';

export interface UseSceneAudioPanelsInput {
  state: SceneVideoState | null;
  workPath: string | null;
  chapter: string;
  scene: string;
  characters: readonly { name: string; voice?: CharacterVoice }[];
  updateState: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  refreshFiles: () => Promise<unknown>;
  onMessage: (message: SceneMessage) => void;
  /** 读取场景目录内的文件（配音试听） */
  readFile: (fileName: string) => Promise<Uint8Array>;
  /** 当前视频服务能生成声音 */
  videoSupportsAudio: boolean;
}

export function useSceneAudioPanels(input: UseSceneAudioPanelsInput) {
  const { state, characters, updateState, onMessage, readFile, videoSupportsAudio } = input;
  const voices = useMemo(
    () => Object.fromEntries(characters.map((item) => [item.name, item.voice])),
    [characters]
  );
  const notify = useCallback(
    (message: NonNullable<SceneMessage>) => onMessage(message),
    [onMessage]
  );
  const audio = useSceneAudio({
    state,
    workPath: input.workPath,
    chapter: input.chapter,
    scene: input.scene,
    voices,
    updateState,
    refreshFiles: input.refreshFiles,
    onMessage: notify,
  });

  const updateAudio = useCallback(
    (updater: (prev: SceneAudio) => SceneAudio) =>
      updateState((prev) => ({ ...prev, audio: updater(prev.audio) })),
    [updateState]
  );

  const sceneSection = state ? (
    <SceneAudioSection
      audio={state.audio}
      onChange={updateAudio}
      speechProviders={audio.speechProviders}
      videoSupportsAudio={videoSupportsAudio}
      onImport={audio.importAudio}
      loadWorkAudio={audio.readWorkAudio}
    />
  ) : null;

  const renderShotSection = (shot: Shot, index: number): React.ReactNode => {
    const busyLineIds = new Set(
      (shot.dialogue ?? [])
        .filter((line) => audio.busy.has(lineKey(shot.id, line.id)))
        .map((line) => line.id)
    );
    return (
      <ShotAudioSection
        shot={shot}
        label={`镜头 ${index + 1}`}
        speakers={state?.characters ?? []}
        onUpdateShot={(patch) => updateState((prev) => updateShot(prev, shot.id, patch))}
        onSynthesize={(lineIds) => void audio.synthesize(shot, lineIds)}
        busyLineIds={busyLineIds}
        canSynthesize={Boolean(audio.providerId) && Boolean(input.workPath)}
        readSceneFile={readFile}
        loadWorkAudio={audio.readWorkAudio}
        onImportSfx={() => audio.importAudio('sfx')}
      />
    );
  };

  return { audio, sceneSection, renderShotSection };
}
