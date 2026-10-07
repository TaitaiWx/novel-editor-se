import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORYBOARD_MAX_SHOTS, type Shot } from '@novel-editor/video';
import {
  notifyWorkspaceFilesChanged,
  requestRevealInFilePanel,
} from '@/render/utils/workspaceFiles';
import { referenceItemFor, requestOpenReference } from '@/render/utils/referencePane';
import { exportMediaFile } from '@/render/utils/mediaExport';
import SceneCanvas from './SceneCanvas';
import { CharacterNode, OutputNode, SceneNode, ShotNode } from './nodes';
import { CharacterInspector, OutputInspector, SceneInspector, ShotInspector } from './Inspector';
import Toolbar from './Toolbar';
import { layoutSceneCanvas, type CanvasNode } from './canvasLayout';
import { generateStoryboard, type CharacterBrief } from './storyboardGeneration';
import {
  animaticFiles,
  appendShot,
  chosenVersionFor,
  estimateSceneCost,
  moveShot,
  removeShot,
  replaceStoryboardShots,
  shotProgress,
  shotsNeedingGeneration,
  shouldAutoStitch,
  updateShot,
} from './sceneVideoState';
import { animaticStoryboard, canStitchAnimatic, stitchAnimatic } from './stitchAnimatic';
import { useSceneVideoDoc, type SaveStatus } from './useSceneVideoDoc';
import { useSceneVideoTasks } from './useSceneVideoTasks';
import { useVideoServices } from './useVideoServices';
import { useResolvedAvatars } from './useResolvedAvatars';
import { useSceneKeyframes } from './useSceneKeyframes';
import { useOutlineAutoLink } from './useOutlineAutoLink';
import ScenePreviz from './ScenePreviz';
import { useImageServices } from '../EntityGallery/useImageServices';
import { dataUrlToBytes } from '../EntityGallery/mediaActions';
import styles from './styles.module.scss';

export interface SceneVideoCharacter extends CharacterBrief {
  /** 主要形象图（相对作品目录或 data URL），小圆头像用 */
  avatar?: string;
  /** 三视图（相对作品目录），画布人物节点显示 */
  turnaround?: string;
  /** 生成视频的人物参考图：三视图优先，其次主要形象图（相对作品目录） */
  referencePaths?: string[];
}

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
  saved: '已保存到资料',
  error: '保存失败',
};

function joinPath(dir: string, name: string): string {
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/**
 * 场景视频画布：人物 → 场景 → 镜头 1…N → 样片，单击节点在右侧检查器编辑。
 *
 * 尽量少的手动操作：
 * - 打开时没有分镜就自动拆分（有 AI 用 AI，否则按段落）
 * - 每次修改自动保存 分镜.json 与可读的 分镜.md 到 <作品>/资料/视频/<章>/<场景>/，资料面板自动刷新
 * - 「生成 N 个镜头」只提交还没有成片的镜头；成片下载后自动出现在节点与资料里
 * - 全部镜头都有成片后自动合成样片；第一个成片出现后自动在本章章纲里记录这一场的视频
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
  const handleTaskFinished = useCallback(() => {
    void refreshFiles();
    notifyWorkspaceFilesChanged();
  }, [refreshFiles]);
  const { tasks, submitShots, cancelTask, retryTask } = useSceneVideoTasks(
    taskRef,
    handleTaskFinished
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stitchProgress, setStitchProgress] = useState<number | null>(null);
  const [previzShotId, setPrevizShotId] = useState<string | null>(null);
  const imageServices = useImageServices();
  const [message, setMessage] = useState<Message>(null);

  const provider =
    services.videoProviders.find((item) => item.id === state?.providerId) ??
    services.videoProviders[0] ??
    null;
  const avatars = useResolvedAvatars(characters, workPath);
  const references = useMemo(
    () =>
      Object.fromEntries(
        characters
          .filter((item) => item.referencePaths?.length)
          .map((item) => [item.name, item.referencePaths ?? []])
      ),
    [characters]
  );
  const characterByName = useMemo(
    () => new Map(characters.map((item) => [item.name, item])),
    [characters]
  );
  const sceneCharacters = useMemo(
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

  // ─── 首帧 / 预演 ───────────────────────────────────────────────────
  const { writeSceneImage, writePrevizVideo, generateKeyframes } = useSceneKeyframes({
    state,
    characters,
    references,
    workPath,
    chapter: doc.chapter,
    scene,
    refreshFiles,
  });

  // ─── 拆分镜 ─────────────────────────────────────────────────────────

  const splitStoryboard = useCallback(
    async (trigger: 'auto' | 'manual') => {
      const current = state;
      if (!current) return;
      setSplitting(true);
      try {
        const result = await generateStoryboard(window.electron?.ipcRenderer, {
          state: current,
          textProviderId: services.textProviderId,
          characters,
        });
        if (result.shots.length === 0) {
          if (trigger === 'manual') setMessage({ tone: 'info', text: '场景正文为空，无法拆分镜' });
          return;
        }
        updateState((prev) => replaceStoryboardShots(prev, result.shots));
        setSelectedId(null);
        const base =
          result.source === 'ai'
            ? `AI 拆出 ${result.shots.length} 个镜头`
            : `已按段落拆出 ${result.shots.length} 个镜头`;
        setMessage({
          tone: result.notes.length ? 'info' : 'success',
          text: [`${base}，单击镜头可以修改`, ...result.notes].join('；'),
        });
      } finally {
        setSplitting(false);
      }
    },
    [characters, services.textProviderId, state, updateState]
  );

  // 第一次打开、还没有分镜时自动拆分（等服务配置读取完成，以便有 AI 时用 AI）
  const autoSplitDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state || !services.loaded || doc.loading) return;
    if (autoSplitDoneRef.current === tabPath) return;
    autoSplitDoneRef.current = tabPath;
    if (state.storyboard.shots.length === 0 && state.sourceText.trim()) {
      void splitStoryboard('auto');
    }
  }, [doc.loading, services.loaded, splitStoryboard, state, tabPath]);

  // ─── 生成 ───────────────────────────────────────────────────────────

  const pendingShots = useMemo(
    () => (state ? shotsNeedingGeneration(state, files, tasks) : []),
    [files, state, tasks]
  );
  const estimate = estimateSceneCost(pendingShots, provider);

  const submit = useCallback(
    async (shots: readonly Shot[]) => {
      if (!state || !provider || shots.length === 0) return;
      setSubmitting(true);
      try {
        const result = await submitShots({
          state,
          shots,
          providerId: provider.id,
          model: state.model ?? provider.model,
          references,
        });
        setMessage(
          result.errors.length
            ? { tone: 'error', text: result.errors.join('；') }
            : {
                tone: 'info',
                text: `已提交 ${result.submitted} 个镜头，完成后自动保存到资料`,
              }
        );
      } finally {
        setSubmitting(false);
      }
    },
    [provider, references, state, submitShots]
  );

  // ─── 样片（自动合成） ───────────────────────────────────────────────

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
        if (signature) updateState((prev) => ({ ...prev, animaticSignature: signature }));
        await refreshFiles();
        notifyWorkspaceFilesChanged();
        setMessage(
          output.audioDropped
            ? {
                tone: 'info',
                text: `样片已保存到资料：${result.data.fileName}（当前环境无法编码声音，样片没有声音；镜头成片的原声不受影响）`,
              }
            : { tone: 'success', text: `样片已保存到资料：${result.data.fileName}` }
        );
      } catch (error) {
        setMessage({
          tone: 'error',
          text: `合成样片失败：${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setStitchProgress(null);
      }
    },
    [doc.chapter, files, readFile, refreshFiles, scene, state, updateState, workPath]
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

  // ─── 章纲（第一个成片出现后自动记录一次） ───────────────────────────
  useOutlineAutoLink({ state, files, workPath, chapterPath, dbReady, updateState });

  // ─── 画布 ───────────────────────────────────────────────────────────

  const layout = useMemo(
    () =>
      state
        ? layoutSceneCanvas({
            characters: state.characters,
            shots: state.storyboard.shots,
            canvas: state.canvas,
          })
        : { nodes: [], edges: [] },
    [state]
  );
  const avatarOf = useCallback(
    (name: string) => sceneCharacters.find((item) => item.name === name)?.avatar,
    [sceneCharacters]
  );
  const shotById = useMemo(
    () => new Map((state?.storyboard.shots ?? []).map((shot, index) => [shot.id, { shot, index }])),
    [state?.storyboard.shots]
  );
  const doneCount = useMemo(
    () =>
      state
        ? state.storyboard.shots.filter((shot) => chosenVersionFor(state, shot, files)).length
        : 0,
    [files, state]
  );

  const revealInMaterials = useCallback(
    (fileName?: string) => {
      if (!doc.dir) {
        setMessage({ tone: 'info', text: '这一场还没有保存任何文件，修改分镜或生成镜头后再查看' });
        return;
      }
      notifyWorkspaceFilesChanged();
      requestRevealInFilePanel(fileName ? joinPath(doc.dir, fileName) : doc.dir);
    },
    [doc.dir]
  );

  /** 在编辑器旁边的参考窗格里看成片 / 样片 */
  const openBeside = useCallback(
    (fileName: string) => {
      if (!doc.dir) return;
      const reference = referenceItemFor(
        joinPath(doc.dir, fileName),
        `${state?.scene ?? ''} · ${fileName}`
      );
      if (reference) requestOpenReference({ items: [reference] });
    },
    [doc.dir, state?.scene]
  );

  // 版本列表「导出」：成片按原格式另存（不转码）
  const exportVersion = useCallback(
    (fileName: string) => {
      if (!doc.dir) return;
      void exportMediaFile({
        sourcePath: joinPath(doc.dir, fileName),
        title: `${state?.scene ?? ''}-${fileName}`,
      }).then((result) => {
        if (result.saved)
          setMessage({ tone: 'success', text: `已导出到 ${result.filePath ?? ''}` });
        else if (result.error) setMessage({ tone: 'error', text: `导出失败：${result.error}` });
      });
    },
    [doc.dir, state?.scene]
  );

  const labelFor = useCallback((node: CanvasNode) => {
    switch (node.kind) {
      case 'character':
        return `人物 ${node.name ?? ''}`;
      case 'scene':
        return '场景';
      case 'shot':
        return `镜头 ${(node.index ?? 0) + 1}`;
      default:
        return '样片';
    }
  }, []);

  const renderNode = (node: CanvasNode): React.ReactNode => {
    if (!state) return null;
    if (node.kind === 'character') {
      const character = characterByName.get(node.name ?? '');
      return (
        <CharacterNode
          name={node.name ?? ''}
          avatar={avatarOf(node.name ?? '')}
          turnaround={character?.turnaround}
          workPath={workPath}
        />
      );
    }
    if (node.kind === 'scene') {
      return (
        <SceneNode
          chapter={state.chapter}
          scene={state.scene}
          sourceText={state.sourceText}
          location={state.location}
          splitting={splitting}
          onResplit={() => void splitStoryboard('manual')}
        />
      );
    }
    if (node.kind === 'output') {
      return (
        <OutputNode
          aspectRatio={state.aspectRatio}
          readFile={readFile}
          animatic={animaticFiles(files)[0] ?? null}
          doneCount={doneCount}
          totalCount={state.storyboard.shots.length}
          stitchProgress={stitchProgress}
        />
      );
    }
    const entry = shotById.get(node.id);
    if (!entry) return null;
    const blocked = !provider
      ? '先配置视频服务'
      : !entry.shot.description.trim()
        ? '先写一句画面描述'
        : undefined;
    return (
      <ShotNode
        shot={entry.shot}
        index={entry.index}
        aspectRatio={state.aspectRatio}
        progress={shotProgress(state, entry.shot, files, tasks)}
        canGenerate={!blocked && !submitting}
        generateBlockedReason={blocked}
        readFile={readFile}
        keyframe={state.keyframes[entry.shot.id]}
        workPath={workPath}
        onGenerate={() => void submit([entry.shot])}
      />
    );
  };

  if (doc.loading || !state) {
    return <div className={styles.loading}>正在打开场景视频…</div>;
  }

  const selectedNode = layout.nodes.find((node) => node.id === selectedId) ?? null;
  const closeInspector = () => setSelectedId(null);
  const previzShot = previzShotId ? (shotById.get(previzShotId) ?? null) : null;
  let inspector: React.ReactNode = null;
  if (selectedNode?.kind === 'scene') {
    inspector = (
      <SceneInspector
        state={state}
        onChange={updateState}
        characters={sceneCharacters}
        loreTitles={loreTitles}
        pendingSeed={doc.pendingSeed}
        onApplySeed={doc.applyPendingSeed}
        onDismissSeed={doc.dismissPendingSeed}
        onClose={closeInspector}
      />
    );
  } else if (selectedNode?.kind === 'character') {
    const name = selectedNode.name ?? '';
    inspector = (
      <CharacterInspector
        name={name}
        avatar={avatarOf(name)}
        turnaround={characterByName.get(name)?.turnaround}
        referenceCount={characterByName.get(name)?.referencePaths?.length ?? 0}
        workPath={workPath}
        onClose={closeInspector}
        onRemove={() => {
          setSelectedId(null);
          updateState((prev) => ({
            ...prev,
            characters: prev.characters.filter((item) => item !== name),
          }));
        }}
      />
    );
  } else if (selectedNode?.kind === 'shot') {
    const entry = shotById.get(selectedNode.id);
    if (entry) {
      const shots = state.storyboard.shots;
      inspector = (
        <ShotInspector
          keyframe={{
            workPath,
            keyframe: state.keyframes[entry.shot.id],
            previz: state.previz[entry.shot.id],
            previzVideo: state.previzVideo[entry.shot.id],
            previzScript: state.previzScripts[entry.shot.id],
            readFile,
            imageReady: imageServices.providers.length > 0,
            onOpenPreviz: () => setPrevizShotId(entry.shot.id),
            onGenerate: () => generateKeyframes(entry.shot),
            onAdopt: async (dataUrl) => {
              const path = await writeSceneImage('keyframe', entry.shot, dataUrlToBytes(dataUrl));
              updateState((prev) => ({
                ...prev,
                keyframes: { ...prev.keyframes, [entry.shot.id]: path },
              }));
            },
            onClear: () =>
              updateState((prev) => {
                const keyframes = { ...prev.keyframes };
                delete keyframes[entry.shot.id];
                return { ...prev, keyframes };
              }),
          }}
          state={state}
          shot={entry.shot}
          index={entry.index}
          files={files}
          tasks={tasks}
          readFile={readFile}
          onChange={updateState}
          onUpdateShot={(patch) => updateState((prev) => updateShot(prev, entry.shot.id, patch))}
          onMove={(offset) => {
            const neighbor = shots[entry.index + offset];
            if (!neighbor) return;
            updateState((prev) => ({
              ...prev,
              storyboard: {
                ...prev.storyboard,
                shots: moveShot(prev.storyboard.shots, entry.shot.id, neighbor.id),
              },
            }));
          }}
          onRemove={() => {
            setSelectedId(null);
            updateState((prev) => removeShot(prev, entry.shot.id));
          }}
          onOpenBeside={openBeside}
          onExportVersion={exportVersion}
          onCancelTask={(id) =>
            void cancelTask(id).then((error) => error && setMessage({ tone: 'error', text: error }))
          }
          onRetryTask={(id) =>
            void retryTask(id).then((error) => error && setMessage({ tone: 'error', text: error }))
          }
          onClose={closeInspector}
        />
      );
    }
  } else if (selectedNode?.kind === 'output') {
    inspector = (
      <OutputInspector
        files={files}
        readFile={readFile}
        stitchSupported={stitchSupported}
        stitchProgress={stitchProgress}
        canStitch={Boolean(workPath) && state.storyboard.shots.length > 0}
        outlineLinked={Boolean(state.outlineLinked)}
        onStitch={() => void stitch(null)}
        onRevealFile={(fileName) => revealInMaterials(fileName)}
        onOpenBeside={openBeside}
        onClose={closeInspector}
      />
    );
  }

  const saveText =
    doc.saveStatus === 'error' && doc.saveError
      ? `${SAVE_LABELS.error}：${doc.saveError}`
      : SAVE_LABELS[doc.saveStatus];

  return (
    <div className={styles.view} data-testid="scene-video-view">
      <Toolbar
        state={state}
        onChange={updateState}
        videoProviders={services.videoProviders}
        servicesLoaded={services.loaded}
        saveText={saveText}
        saveTone={doc.saveStatus === 'saved' ? 'ok' : doc.saveStatus === 'error' ? 'error' : 'idle'}
        estimateText={estimate.text}
        pendingCount={pendingShots.length}
        submitting={submitting}
        canAddShot={state.storyboard.shots.length < STORYBOARD_MAX_SHOTS}
        onGenerate={() => void submit(pendingShots)}
        onAddShot={() => {
          const id = `shot-${state.nextShotNumber}`;
          updateState(appendShot);
          setSelectedId(id);
        }}
        onReveal={() => revealInMaterials()}
        onOpenSettings={() =>
          window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }))
        }
      />
      {!workPath && (
        <p className={styles.notice}>没有打开作品目录：分镜可以编辑，但无法保存与生成。</p>
      )}
      {message && (
        <p className={styles.message} data-tone={message.tone} role="status">
          {message.text}
        </p>
      )}
      <div className={styles.workspace}>
        <SceneCanvas
          nodes={layout.nodes}
          edges={layout.edges}
          selectedId={selectedNode ? selectedNode.id : null}
          onSelect={setSelectedId}
          onMoveNode={(id, point) =>
            updateState((prev) => ({
              ...prev,
              canvas: { ...prev.canvas, positions: { ...prev.canvas.positions, [id]: point } },
            }))
          }
          renderNode={renderNode}
          labelFor={labelFor}
        />
        {inspector}
      </div>
      {previzShot && (
        <ScenePreviz
          shot={previzShot.shot}
          index={previzShot.index}
          state={state}
          characters={characters}
          updateState={updateState}
          writeSceneImage={writeSceneImage}
          writePrevizVideo={writePrevizVideo}
          onSaved={(text) => setMessage({ tone: 'success', text })}
          onClose={() => setPrevizShotId(null)}
        />
      )}
    </div>
  );
};

export default SceneVideoView;
