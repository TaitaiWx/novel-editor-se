/**
 * 场景声音（场景视频 · 声音）：配音服务列表、为对白生成配音、导入本地配乐 / 音效、读取作品内音频。
 *
 * - 配音经主进程 ai-speech-synthesize（密钥只在主进程），结果写入场景目录 镜头N-台词-<id>.mp3|wav，
 *   分镜.json 里对应对白记录 audioFile / audioDurationSec
 * - 配乐 / 音效经 scene-audio-import 由主进程弹出「打开」对话框并复制进作品（资料/音乐/、资料/音效/），
 *   渲染进程拿到的只是相对作品目录的路径
 */
import { useCallback, useEffect, useState } from 'react';
import { NARRATOR, type CharacterVoice, type DialogueLine, type Shot } from '@novel-editor/video';
import type { AIProviderInfo } from '@/render/types/ai-api';
import { notifyWorkspaceFilesChanged } from '@/render/utils/workspaceFiles';
import { shotNumber, type SceneVideoState } from './sceneVideoState';

type Ipc = NonNullable<Window['electron']>['ipcRenderer'];

export interface UseSceneAudioInput {
  state: SceneVideoState | null;
  workPath: string | null;
  chapter: string;
  scene: string;
  /** 人物名 → 声音设置（人物详情「声音」） */
  voices: Readonly<Record<string, CharacterVoice | undefined>>;
  updateState: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  refreshFiles: () => Promise<unknown>;
  onMessage: (message: { tone: 'info' | 'success' | 'error'; text: string }) => void;
}

export type AudioImportKind = 'bgm' | 'ambience' | 'sfx';

/** 已配置 Key 且已启用的配音服务 */
export function pickSpeechProviders(list: readonly AIProviderInfo[]): AIProviderInfo[] {
  return list.filter((item) => item.kind === 'speech' && item.configured && item.enabled);
}

/** 给对白写入配音结果（只改这一句） */
export function withLineAudio(
  state: SceneVideoState,
  shotId: string,
  lineId: string,
  audio: { audioFile: string; audioDurationSec?: number }
): SceneVideoState {
  return {
    ...state,
    storyboard: {
      ...state.storyboard,
      shots: state.storyboard.shots.map((shot) =>
        shot.id !== shotId
          ? shot
          : {
              ...shot,
              dialogue: (shot.dialogue ?? []).map((line) => {
                if (line.id !== lineId) return line;
                const next: DialogueLine = { ...line, audioFile: audio.audioFile };
                if (audio.audioDurationSec) next.audioDurationSec = audio.audioDurationSec;
                else delete next.audioDurationSec;
                return next;
              }),
            }
      ),
    },
  };
}

export function lineKey(shotId: string, lineId: string): string {
  return `${shotId}:${lineId}`;
}

export function useSceneAudio(input: UseSceneAudioInput) {
  const { state, workPath, chapter, scene, voices, updateState, refreshFiles, onMessage } = input;
  const [speechProviders, setSpeechProviders] = useState<AIProviderInfo[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    void ipc
      .invoke('ai-providers-list')
      .then((result) => setSpeechProviders(result.ok ? pickSpeechProviders(result.data) : []))
      .catch(() => setSpeechProviders([]));
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  const providerId =
    speechProviders.find((item) => item.id === state?.audio.speechProviderId)?.id ??
    speechProviders[0]?.id ??
    null;

  const synthesizeOne = useCallback(
    async (ipc: Ipc, current: SceneVideoState, shot: Shot, line: DialogueLine) => {
      const number = shotNumber(shot);
      if (number === null || !workPath || !providerId) return '没有可用的配音服务';
      const key = lineKey(shot.id, line.id);
      setBusy((prev) => new Set(prev).add(key));
      try {
        const voice = line.speaker === NARRATOR ? undefined : voices[line.speaker];
        const result = await ipc
          .invoke('ai-speech-synthesize', {
            workPath,
            chapter,
            scene,
            shotIndex: number,
            lineId: line.id,
            text: line.text,
            language: current.audio.language,
            providerId,
            ...(line.emotion ? { emotion: line.emotion } : {}),
            ...(voice ? { voice } : {}),
          })
          .catch((error: unknown) => ({
            ok: false as const,
            error: { message: error instanceof Error ? error.message : String(error) },
          }));
        if (!result.ok) return result.error.message;
        updateState((prev) =>
          withLineAudio(prev, shot.id, line.id, {
            audioFile: result.data.fileName,
            audioDurationSec: result.data.durationSec,
          })
        );
        return null;
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [chapter, providerId, scene, updateState, voices, workPath]
  );

  /** 生成配音：lineIds 省略时为这个镜头的全部对白（有台词的） */
  const synthesize = useCallback(
    async (shot: Shot, lineIds?: readonly string[]) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !state) return;
      if (!providerId) {
        onMessage({
          tone: 'info',
          text: '还没有配置配音服务：在设置中心「AI → 语音」里填写 OpenAI 兼容配音或 MiniMax 语音合成的 Key',
        });
        return;
      }
      const wanted = lineIds ? new Set(lineIds) : null;
      const lines = (shot.dialogue ?? []).filter(
        (line) => line.text.trim() && (!wanted || wanted.has(line.id))
      );
      const errors: string[] = [];
      for (const line of lines) {
        const error = await synthesizeOne(ipc, state, shot, line);
        if (error) {
          errors.push(error);
          break;
        }
      }
      await refreshFiles();
      notifyWorkspaceFilesChanged();
      const done = lines.length - errors.length;
      onMessage(
        errors.length
          ? { tone: 'error', text: `配音失败：${errors[0]}` }
          : { tone: 'success', text: `已生成 ${done} 句配音，保存在这一场的资料目录里` }
      );
    },
    [onMessage, providerId, refreshFiles, state, synthesizeOne]
  );

  /** 选择本地音频复制进作品，返回相对作品目录的路径；取消时 null */
  const importAudio = useCallback(
    async (kind: AudioImportKind): Promise<string | null> => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !workPath) {
        onMessage({ tone: 'info', text: '没有打开作品目录，无法导入音频' });
        return null;
      }
      const result = await ipc.invoke('scene-audio-import', { workPath, kind }).catch(() => null);
      if (!result) return null;
      if (!result.ok) {
        onMessage({ tone: 'error', text: `导入失败：${result.error.message}` });
        return null;
      }
      if (result.data.canceled || !result.data.relativePath) return null;
      notifyWorkspaceFilesChanged();
      onMessage({ tone: 'success', text: `已复制到 ${result.data.relativePath}` });
      return result.data.relativePath;
    },
    [onMessage, workPath]
  );

  /** 读取作品内 资料/音乐/、资料/音效/ 下的音频 */
  const readWorkAudio = useCallback(
    async (relativePath: string): Promise<Uint8Array> => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !workPath) throw new Error('没有打开项目');
      const result = await ipc.invoke('scene-audio-read', { workPath, relativePath });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    [workPath]
  );

  return {
    speechProviders,
    providerId,
    busy,
    synthesize,
    importAudio,
    readWorkAudio,
    reload,
  };
}

export type SceneAudioApi = ReturnType<typeof useSceneAudio>;
