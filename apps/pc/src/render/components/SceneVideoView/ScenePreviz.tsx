/**
 * 场景视频里的 3D 预演入口：为某个镜头打开 PrevizDialog，保存时写入
 * 镜头N-预演.mp4（预演视频）与 镜头N-预演.png（第一帧，生成首帧时作为构图参考），并记到 分镜.json。
 */
import React, { useMemo } from 'react';
import type { Shot } from '@novel-editor/video';
import PrevizDialog from './Previz';
import type { SceneVideoState } from './sceneVideoState';
import type { CharacterBrief } from './storyboardGeneration';

export interface ScenePrevizProps {
  shot: Shot;
  index: number;
  state: SceneVideoState;
  characters: readonly CharacterBrief[];
  updateState: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  writeSceneImage: (kind: 'keyframe' | 'previz', shot: Shot, data: Uint8Array) => Promise<string>;
  writePrevizVideo: (shot: Shot, data: Uint8Array, ext: 'mp4' | 'webm') => Promise<string>;
  onSaved: (text: string) => void;
  onClose: () => void;
}

const ScenePreviz: React.FC<ScenePrevizProps> = ({
  shot,
  index,
  state,
  characters,
  updateState,
  writeSceneImage,
  writePrevizVideo,
  onSaved,
  onClose,
}) => {
  const briefs = useMemo(() => {
    const names = shot.characters?.length ? shot.characters : state.characters;
    const byName = new Map(characters.map((item) => [item.name, item]));
    return names.map((name) => ({ name, appearance: byName.get(name)?.appearance }));
  }, [characters, shot.characters, state.characters]);

  return (
    <PrevizDialog
      shotLabel={`镜头 ${index + 1}`}
      shot={{
        shotSize: shot.shotSize,
        durationSec: shot.durationSec,
        description: shot.description,
        camera: shot.camera,
        location: shot.location || state.location || undefined,
      }}
      characters={briefs}
      aspectRatio={state.aspectRatio}
      initialScript={state.previzScripts[shot.id] ?? null}
      onSave={async (output) => {
        const videoPath = await writePrevizVideo(shot, output.video, output.ext);
        const framePath = await writeSceneImage('previz', shot, output.firstFrame);
        updateState((prev) => ({
          ...prev,
          previz: { ...prev.previz, [shot.id]: framePath },
          previzVideo: { ...prev.previzVideo, [shot.id]: videoPath },
          previzScripts: { ...prev.previzScripts, [shot.id]: output.script },
        }));
        onSaved('预演视频已保存；生成首帧时会按它的第一帧构图');
      }}
      onClose={onClose}
    />
  );
};

export default ScenePreviz;
