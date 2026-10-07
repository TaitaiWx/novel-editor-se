import React, { useCallback, useMemo, useState } from 'react';
import { VscFolderOpened } from 'react-icons/vsc';
import { insertBeatIntoChapterOutline } from '../RightPanel/VolumePlanView/volumeSources';
import InputColumn, { type InputCharacter } from './InputColumn';
import StoryboardColumn from './StoryboardColumn';
import type { ShotCardProps } from './StoryboardColumn/ShotCard';
import PreviewColumn from './PreviewColumn';
import { generateStoryboard, type CharacterBrief } from './storyboardGeneration';
import {
  chosenVersionFor,
  describeTaskStatus,
  latestTaskForShot,
  outlineLinkEntry,
  replaceStoryboardShots,
  sceneRelativeDir,
  shotNumber,
} from './sceneVideoState';
import { animaticStoryboard, canStitchAnimatic, stitchAnimatic } from './stitchAnimatic';
import { useSceneVideoDoc, type SaveStatus } from './useSceneVideoDoc';
import { useSceneVideoTasks } from './useSceneVideoTasks';
import { useVideoServices } from './useVideoServices';
import { useResolvedAvatars } from './useResolvedAvatars';
import styles from './styles.module.scss';

export interface SceneVideoCharacter extends InputCharacter, CharacterBrief {}

export interface SceneVideoViewProps {
  /** 标签路径（__workspace__:scene-video:<章>#<场景>） */
  tabPath: string;
  chapterPath: string;
  scene: string;
  /** 当前作品目录（成片与分镜落在 <作品>/资料/视频/） */
  workPath: string | null;
  dbReady: boolean;
  characters: readonly SceneVideoCharacter[];
  loreTitles: readonly string[];
}

type Message = { tone: 'info' | 'success' | 'error'; text: string } | null;

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: '',
  pending: '有修改，稍后自动保存',
  saving: '保存中…',
  saved: '已保存到 分镜.json',
  error: '保存失败',
};

/**
 * 场景视频工作区：输入（左）/ 分镜（中）/ 预览与任务（右）
 * 流程：发起 → 补全输入 → 分镜（先审后生成）→ 生成（异步任务）→ 落盘到 <作品>/资料/视频/<章>/<场景>/
 */
const SceneVideoView: React.FC<SceneVideoViewProps> = ({
  tabPath,
  chapterPath,
  scene,
  workPath,
  dbReady,
  characters,
  loreTitles,
}) => {
  const doc = useSceneVideoDoc({ tabPath, workPath, chapterPath, scene, characters, loreTitles });
  const services = useVideoServices();
  const { state, files, updateState, refreshFiles } = doc;
  const taskRef = useMemo(
    () => (workPath ? { workPath, chapter: doc.chapter, scene } : null),
    [doc.chapter, scene, workPath]
  );
  const { tasks, submitShots, cancelTask, retryTask } = useSceneVideoTasks(taskRef, refreshFiles);
  const [generating, setGenerating] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [stitchProgress, setStitchProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const provider =
    services.videoProviders.find((item) => item.id === state?.providerId) ??
    services.videoProviders[0] ??
    null;
  const avatars = useResolvedAvatars(characters, workPath);
  const inputCharacters = useMemo(
    () => characters.map((item) => ({ name: item.name, avatar: avatars[item.name] })),
    [avatars, characters]
  );

  const readFile = useCallback(
    async (fileName: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !workPath) throw new Error('没有打开项目');
      const result = await ipc.invoke('video-scene-read-file', {
        workPath,
        chapter: doc.chapter,
        scene,
        fileName,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    [doc.chapter, scene, workPath]
  );

  const statusByShot = useMemo(() => {
    const result: Record<string, ShotCardProps['status']> = {};
    for (const shot of state?.storyboard.shots ?? []) {
      const number = shotNumber(shot);
      const task = number === null ? null : latestTaskForShot(tasks, number);
      if (!task) continue;
      const tone =
        task.status === 'failed'
          ? 'failed'
          : task.status === 'cancelled'
            ? 'muted'
            : task.status === 'succeeded' && task.outputPath
              ? 'done'
              : 'active';
      result[shot.id] = { text: describeTaskStatus(task), tone };
    }
    return result;
  }, [state?.storyboard.shots, tasks]);

  const handleGenerate = useCallback(async () => {
    if (!state) return;
    setGenerating(true);
    setNotes([]);
    try {
      const result = await generateStoryboard(window.electron?.ipcRenderer, {
        state,
        textProviderId: services.textProviderId,
        characters,
      });
      if (result.shots.length === 0) {
        setNotes(['场景正文为空，无法拆分镜头']);
        return;
      }
      updateState((prev) => replaceStoryboardShots(prev, result.shots));
      setNotes(result.notes);
      setMessage({
        tone: 'success',
        text:
          result.source === 'ai'
            ? `AI 拆出 ${result.shots.length} 个镜头，检查后再生成`
            : `已按段落拆出 ${result.shots.length} 个镜头`,
      });
    } finally {
      setGenerating(false);
    }
  }, [characters, services.textProviderId, state, updateState]);

  const handleSubmit = useCallback(
    async (scope: 'selected' | 'all') => {
      if (!state || !provider) return;
      const shots =
        scope === 'all'
          ? state.storyboard.shots
          : state.storyboard.shots.filter((shot) => state.selectedShotIds.includes(shot.id));
      setSubmitting(true);
      try {
        const result = await submitShots({
          state,
          shots,
          providerId: provider.id,
          model: state.model ?? provider.model,
          avatars,
        });
        if (result.errors.length) {
          setMessage({ tone: 'error', text: result.errors.join('；') });
        } else {
          setMessage({
            tone: 'info',
            text: `已提交 ${result.submitted} 个镜头，生成完成后自动保存`,
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [avatars, provider, state, submitShots]
  );

  const handleExport = useCallback(async () => {
    const saved = await doc.exportMarkdown();
    setMessage(
      saved
        ? { tone: 'success', text: `已导出分镜表：${sceneRelativeDir(doc.chapter, scene)}/分镜.md` }
        : { tone: 'error', text: doc.saveError || '导出失败：没有打开项目' }
    );
  }, [doc, scene]);

  const handleStitch = useCallback(async () => {
    if (!state || !workPath) return;
    const storyboard = animaticStoryboard(
      { ...state.storyboard, aspectRatio: state.aspectRatio },
      state.selectedShotIds
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
        onProgress: setStitchProgress,
      });
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) throw new Error('没有打开项目');
      const result = await ipc.invoke('video-scene-write-animatic', {
        workPath,
        chapter: doc.chapter,
        scene,
        ext: output.ext,
        data: output.data,
      });
      if (!result.ok) throw new Error(result.error.message);
      await refreshFiles();
      setMessage({ tone: 'success', text: `样片已保存：${result.data.fileName}` });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `拼接失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setStitchProgress(null);
    }
  }, [doc.chapter, files, readFile, refreshFiles, scene, state, workPath]);

  const handleLinkOutline = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !workPath || !state) return;
    await doc.exportMarkdown();
    const entry = outlineLinkEntry(state, files);
    try {
      const result = await insertBeatIntoChapterOutline(ipc, workPath, chapterPath, {
        title: entry.title,
        content: entry.content,
      });
      setMessage({
        tone: 'success',
        text: result === 'inserted' ? '已回链到本章章纲' : '本章章纲里已有这一场的视频记录',
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `回链失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [chapterPath, doc, files, state, workPath]);

  const openFolder = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !workPath) return;
    const loaded = await ipc.invoke('video-scene-load', { workPath, chapter: doc.chapter, scene });
    if (!loaded.ok) return;
    try {
      await ipc.invoke('show-item-in-folder', loaded.data.dir);
    } catch {
      setMessage({ tone: 'info', text: '还没有生成任何文件，导出分镜表或生成镜头后再打开' });
    }
  }, [doc.chapter, scene, workPath]);

  if (doc.loading || !state) {
    return <div className={styles.loading}>正在打开场景视频…</div>;
  }

  return (
    <div className={styles.view} data-testid="scene-video-view">
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.headingTitle}>场景视频</h1>
          <span className={styles.headingMeta}>
            {state.chapter} · {state.scene}
          </span>
        </div>
        <div className={styles.headerRight}>
          {doc.saveStatus !== 'idle' && (
            <span className={styles.saveStatus} data-status={doc.saveStatus}>
              {doc.saveStatus === 'error' && doc.saveError
                ? `${SAVE_LABELS.error}：${doc.saveError}`
                : SAVE_LABELS[doc.saveStatus]}
            </span>
          )}
          <button
            type="button"
            className={styles.headerButton}
            disabled={!workPath}
            title={`在文件夹中显示 ${sceneRelativeDir(state.chapter, state.scene)}`}
            onClick={() => void openFolder()}
          >
            <VscFolderOpened aria-hidden="true" />
            打开文件夹
          </button>
        </div>
      </header>

      {!workPath && (
        <p className={styles.notice}>没有打开作品目录：分镜可以编辑，但无法保存与生成。</p>
      )}
      {message && (
        <p className={styles.message} data-tone={message.tone} role="status">
          {message.text}
        </p>
      )}

      <div className={styles.columns}>
        <InputColumn
          state={state}
          onChange={updateState}
          characters={inputCharacters}
          loreTitles={loreTitles}
          videoProviders={services.videoProviders}
          servicesLoaded={services.loaded}
          pendingSeed={doc.pendingSeed}
          onApplySeed={doc.applyPendingSeed}
          onDismissSeed={doc.dismissPendingSeed}
          onOpenSettings={() =>
            window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }))
          }
        />
        <StoryboardColumn
          state={state}
          onChange={updateState}
          aiReady={Boolean(services.textProviderId)}
          generating={generating}
          notes={notes}
          statusByShot={statusByShot}
          onGenerate={() => void handleGenerate()}
          onExport={() => void handleExport()}
        />
        <PreviewColumn
          state={state}
          onChange={updateState}
          files={files}
          tasks={tasks}
          provider={provider}
          settings={services.settings}
          submitting={submitting}
          onSubmit={(scope) => void handleSubmit(scope)}
          onCancelTask={(id) =>
            void cancelTask(id).then((error) => error && setMessage({ tone: 'error', text: error }))
          }
          onRetryTask={(id) =>
            void retryTask(id).then((error) => error && setMessage({ tone: 'error', text: error }))
          }
          readFile={readFile}
          stitchProgress={stitchProgress}
          stitchSupported={canStitchAnimatic()}
          onStitch={() => void handleStitch()}
          onLinkOutline={() => void handleLinkOutline()}
          linkDisabled={!workPath || !dbReady}
        />
      </div>
    </div>
  );
};

export default SceneVideoView;
