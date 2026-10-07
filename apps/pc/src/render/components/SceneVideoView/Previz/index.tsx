/**
 * 3D 预演（动作预演 / previz）：作者描述这个镜头的动作与走位 → 选模型 →「生成预演」，
 * AI 返回经过校验的 PrevizScript（人物关键帧 + 机位关键帧 + 道具 + 时段），确定性的 three.js 引擎按脚本播放动画。
 * 没有配置 AI 时使用默认脚本（人物站成一排、镜头缓慢推近）。
 *
 * 「保存预演视频」逐帧渲染（长边 1280、24fps，不是实时录屏）并编码为 MP4，同时保存第一帧 PNG：
 * 第一帧作为生成首帧图的构图参考，视频是作者的动作参考（将来也可交给支持视频参考的模型）。
 *
 * 取景框、三分线、安全框、名字标签都是 DOM 叠加层，不进画面。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VscClose } from 'react-icons/vsc';
import type { MotionProvider } from '@novel-editor/ai/motion';
import {
  previzShotSizeOf,
  samplePrevizScript,
  withPrevizMood,
  type PrevizScript,
} from '@novel-editor/video';
import Tooltip from '../../Tooltip';
import DirectorPanel from './DirectorPanel';
import FrameOverlay, { type PrevizOverlays } from './FrameOverlay';
import PlayerBar from './PlayerBar';
import {
  defaultScriptFor,
  generatePrevizScript,
  type PrevizCharacterBrief,
} from './previzGeneration';
import {
  defaultPrevizEncoder,
  renderPrevizVideo,
  type PrevizVideoEncoder,
  type PrevizVideoOutput,
} from './previzVideo';
import { ratioOf } from './presets';
import type { CreatePrevizStage, PrevizLabel, PrevizStageApi } from './types';
import { usePrevizModels } from './usePrevizModels';
import { usePrevizPlayback } from './usePrevizPlayback';
import { usePrevizPointer } from './usePrevizPointer';
import styles from './styles.module.scss';

export type { CreatePrevizStage, PrevizLabel, PrevizStageApi } from './types';
export type { PrevizEncodeInput, PrevizVideoEncoder } from './previzVideo';

/**
 * GPU 忙（例如同时开着别的 Electron 窗口）时 WebGL 上下文偶尔创建失败（three 读取着色器精度为 null），
 * 稍等后重试几次再判定为不支持
 */
const STAGE_ATTEMPTS = 3;
const defaultCreateStage: CreatePrevizStage = async (canvas) => {
  const { PrevizStage } = await import('./stage');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < STAGE_ATTEMPTS; attempt += 1) {
    try {
      return new PrevizStage(canvas);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export interface PrevizShotInfo {
  shotSize: string;
  durationSec: number;
  description: string;
  camera?: string;
  location?: string;
}

export interface PrevizSaveOutput extends PrevizVideoOutput {
  script: PrevizScript;
}

export interface PrevizDialogProps {
  shotLabel: string;
  shot: PrevizShotInfo;
  /** 本镜头的人物（带外貌，交给 AI 理解人物） */
  characters: readonly PrevizCharacterBrief[];
  aspectRatio: string;
  /** 上次保存的脚本（重新打开时恢复） */
  initialScript?: PrevizScript | null;
  onSave: (output: PrevizSaveOutput) => Promise<void>;
  onClose: () => void;
  createStage?: CreatePrevizStage;
  encodeVideo?: PrevizVideoEncoder;
  /**
   * 动作生成服务（文字 → 关节轨迹）；目前没有内置实现。没有时 AI 写的 motion.generate
   * 由同一个模型追加一次请求生成轨迹
   */
  motionProvider?: MotionProvider | null;
}

const sameLabels = (a: readonly PrevizLabel[], b: readonly PrevizLabel[]) =>
  a.length === b.length &&
  a.every(
    (label, index) =>
      label.id === b[index].id &&
      label.x === b[index].x &&
      label.y === b[index].y &&
      label.visible === b[index].visible
  );

const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range'));

/** 预填的动作描述：画面描述 + 出场人物 + 运镜 */
export function initialActionText(shot: PrevizShotInfo, names: readonly string[]): string {
  return [
    shot.description.trim(),
    names.length ? `出场人物：${names.join('、')}` : '',
    shot.camera?.trim() ? `运镜：${shot.camera.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const PrevizDialog: React.FC<PrevizDialogProps> = ({
  shotLabel,
  shot,
  characters,
  aspectRatio,
  initialScript,
  onSave,
  onClose,
  createStage = defaultCreateStage,
  encodeVideo = defaultPrevizEncoder,
  motionProvider = null,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PrevizStageApi | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [labels, setLabels] = useState<PrevizLabel[]>([]);
  const [overlays, setOverlays] = useState<PrevizOverlays>({ thirds: true, safe: false });
  const names = useMemo(() => characters.map((item) => item.name), [characters]);
  const shotSize = previzShotSizeOf(shot.shotSize);
  const [generated, setGenerated] = useState<PrevizScript>(
    () => initialScript ?? defaultScriptFor({ characters, shotSize, durationSec: shot.durationSec })
  );
  const [script, setScript] = useState<PrevizScript>(generated);
  const [action, setAction] = useState(() => initialActionText(shot, names));
  const [notes, setNotes] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const models = usePrevizModels();
  const playback = usePrevizPlayback(script.durationSec);
  const aspect = ratioOf(aspectRatio);
  const busy = generating || progress !== null;
  const pointer = usePrevizPointer({
    stageRef,
    script,
    time: playback.time,
    aspect,
    size,
    onChange: setScript,
    disabled: busy,
  });

  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const next = { width: frame.clientWidth, height: frame.clientHeight };
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    stageRef.current?.resize(next.width, next.height);
  }, []);

  // 每个舞台用自己新建的 canvas：开发模式 StrictMode 会卸载后立即重建，
  // 两个 three.js 渲染器共用同一个 WebGL 上下文会互相改写视口等状态（画面缩到左下角）
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas;
    canvas.dataset.testid = 'previz-canvas';
    host.appendChild(canvas);
    let disposed = false;
    createStage(canvas)
      .then((stage) => {
        if (disposed) {
          stage.dispose();
          return;
        }
        stageRef.current = stage;
        stage.onLabels((next) => setLabels((prev) => (sameLabels(prev, next) ? prev : next)));
        measure();
        setReady(true);
      })
      .catch(() => setError('当前环境不支持 3D 预演（需要 WebGL）'));
    return () => {
      disposed = true;
      stageRef.current?.dispose();
      stageRef.current = null;
      setReady(false);
      canvas.remove();
    };
  }, [createStage, measure]);

  // 打开后焦点放到弹窗上，Esc / 空格立即可用
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (ready) stageRef.current?.setFrame(aspect);
  }, [aspect, ready]);

  // 导出期间舞台由导出流程逐帧驱动，不跟随播放进度
  useEffect(() => {
    if (ready && progress === null) {
      stageRef.current?.setSample(samplePrevizScript(script, playback.time));
    }
  }, [playback.time, progress, ready, script]);

  const generate = async () => {
    playback.pause();
    setGenerating(true);
    setError('');
    try {
      const result = await generatePrevizScript(window.electron?.ipcRenderer, {
        action,
        shotTitle: shotLabel,
        characters,
        shotSize,
        durationSec: shot.durationSec,
        aspectRatio,
        cameraNote: shot.camera,
        location: shot.location,
        model: models.selected,
        motionProvider,
      });
      setGenerated(result.script);
      setScript(result.script);
      setNotes(result.notes);
      playback.seek(0);
      playback.play();
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    playback.pause();
    setProgress(0);
    setError('');
    try {
      const output = await renderPrevizVideo(stage, script, aspect, encodeVideo, {
        onProgress: setProgress,
      });
      await onSave({ ...output, script });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (isTextInput(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ' ' && event.target === event.currentTarget) {
      event.preventDefault();
      playback.toggle();
    }
  };

  const resetCamera = () => setScript((prev) => ({ ...prev, camera: generated.camera }));
  const resetBlocking = () => setScript((prev) => ({ ...prev, figures: generated.figures }));

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`3D 预演 · ${shotLabel}`}
      data-testid="previz-dialog"
      data-stage={ready ? 'ready' : error && !ready ? 'error' : 'loading'}
      data-busy={busy ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      <div className={styles.dialog}>
        <header className={styles.head}>
          <h2 className={styles.title}>3D 预演 · {shotLabel}</h2>
          <span className={styles.hint}>
            描述动作与走位，AI 生成一段可播放的预演；保存后第一帧作为首帧的构图参考
          </span>
          <Tooltip content="关闭（不保存）">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="关闭预演"
              disabled={progress !== null}
              onClick={onClose}
            >
              <VscClose />
            </button>
          </Tooltip>
        </header>
        <div className={styles.body}>
          <div className={styles.viewportWrap}>
            <div
              ref={frameRef}
              className={pointer.dragging ? styles.viewportOrbiting : styles.viewport}
              data-testid="previz-viewport"
              onPointerDown={pointer.onPointerDown}
              onPointerMove={pointer.onPointerMove}
              onPointerUp={pointer.onPointerUp}
              onPointerCancel={pointer.onPointerCancel}
            >
              <div ref={canvasHostRef} className={styles.canvasHost} />
              {ready && (
                <FrameOverlay
                  width={size.width}
                  height={size.height}
                  aspect={aspect}
                  aspectLabel={aspectRatio}
                  overlays={overlays}
                  labels={labels}
                  figures={script.figures}
                  activeId={null}
                />
              )}
              {!ready && <span className={styles.status}>{error || '正在准备 3D 舞台…'}</span>}
            </div>
            <PlayerBar
              playback={playback}
              duration={script.durationSec}
              disabled={!ready || busy}
              overlays={overlays}
              onToggleOverlay={(key) => setOverlays((prev) => ({ ...prev, [key]: !prev[key] }))}
            />
          </div>
          <aside className={styles.side}>
            <DirectorPanel
              action={action}
              onActionChange={setAction}
              models={models}
              onModelChange={models.setValue}
              generating={generating}
              onGenerate={() => void generate()}
              notes={notes}
              summary={script.summary}
              mood={script.mood}
              onMoodChange={(mood) => setScript((prev) => withPrevizMood(prev, mood))}
              onResetCamera={resetCamera}
              onResetBlocking={resetBlocking}
              disabled={!ready || progress !== null}
            />
            <footer className={styles.sideFoot}>
              {error && ready && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              {progress !== null && (
                <div
                  className={styles.progress}
                  role="progressbar"
                  aria-label="预演视频导出进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
              <button
                type="button"
                className={styles.primary}
                disabled={!ready || busy}
                onClick={() => void save()}
              >
                {progress !== null ? `渲染中 ${Math.round(progress * 100)}%` : '保存预演视频'}
              </button>
            </footer>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PrevizDialog;
