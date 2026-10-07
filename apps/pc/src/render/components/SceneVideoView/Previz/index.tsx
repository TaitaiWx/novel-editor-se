/**
 * 3D 预演（摆拍）：像片场走位一样，先用木偶小人摆好站位、朝向、姿势，加几件道具、选时段，
 * 再定景别 / 角度 / 焦距 / 机位，截一张图作为首帧构图参考。
 *
 * 操作：拖人物 / 道具改站位，Shift + 拖动旋转；拖空白处转动机位；Q / E 旋转、Delete 移除、⌘/Ctrl + Z 撤销。
 * 取景框、三分线、安全框、名字标签都是 DOM 叠加层，不进截图；截图按画幅比例、长边 1280。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VscClose, VscDiscard, VscScreenFull } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import CameraPanel from './CameraPanel';
import FigurePanel from './FigurePanel';
import FrameOverlay from './FrameOverlay';
import ScenePanel from './ScenePanel';
import { captureSize, ratioOf } from './presets';
import type { CreatePrevizStage, PrevizLabel, PrevizStageApi } from './types';
import { usePrevizPointer } from './usePrevizPointer';
import { usePrevizScene, type PrevizOverlays } from './usePrevizScene';
import styles from './styles.module.scss';

export type { CreatePrevizStage, PrevizLabel, PrevizStageApi } from './types';

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

export interface PrevizDialogProps {
  shotLabel: string;
  shotSize: string;
  /** 本镜头的人物（默认摆上舞台） */
  characters: readonly string[];
  /** 本场全部人物（可再添加到舞台上），默认同 characters */
  availableCharacters?: readonly string[];
  aspectRatio: string;
  onSave: (png: Uint8Array) => Promise<void>;
  onClose: () => void;
  createStage?: CreatePrevizStage;
}

const ROTATE_STEP = Math.PI / 12;

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

const PrevizDialog: React.FC<PrevizDialogProps> = ({
  shotLabel,
  shotSize,
  characters,
  availableCharacters,
  aspectRatio,
  onSave,
  onClose,
  createStage = defaultCreateStage,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PrevizStageApi | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [labels, setLabels] = useState<PrevizLabel[]>([]);
  const scene = usePrevizScene(characters, shotSize);
  const pointer = usePrevizPointer(stageRef, scene);
  const aspect = ratioOf(aspectRatio);

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

  // 打开后焦点放到弹窗上，Esc / Q / E / Delete / ⌘Z 立即可用
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

  const { view, figures, props, selectedId, mood } = scene;
  useEffect(() => {
    if (ready) stageRef.current?.setFrame(aspect);
  }, [aspect, ready]);
  useEffect(() => {
    if (ready) stageRef.current?.setCamera(view);
  }, [ready, view]);
  useEffect(() => {
    if (ready) stageRef.current?.setMood(mood);
  }, [mood, ready]);
  useEffect(() => {
    if (ready) stageRef.current?.setFigures(figures, selectedId);
  }, [figures, ready, selectedId]);
  useEffect(() => {
    if (ready) stageRef.current?.setProps(props, selectedId);
  }, [props, ready, selectedId]);

  const save = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setSaving(true);
    setError('');
    try {
      await onSave(await stage.capture(captureSize(aspect)));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (isTextInput(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      scene.undo();
      return;
    }
    if (mod || event.altKey || !selectedId) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      scene.removeItem(selectedId);
    } else if (event.key === 'q' || event.key === 'Q') {
      scene.rotateBy(selectedId, ROTATE_STEP);
    } else if (event.key === 'e' || event.key === 'E') {
      scene.rotateBy(selectedId, -ROTATE_STEP);
    }
  };

  const toggleOverlay = (key: keyof PrevizOverlays) =>
    scene.setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`3D 预演 · ${shotLabel}`}
      data-testid="previz-dialog"
      data-stage={ready ? 'ready' : error ? 'error' : 'loading'}
      onKeyDown={onKeyDown}
    >
      <div className={styles.dialog}>
        <header className={styles.head}>
          <h2 className={styles.title}>3D 预演 · {shotLabel}</h2>
          <span className={styles.hint}>
            拖人物或道具改站位（Shift + 拖动旋转），拖空白处转动机位；截图会作为首帧的构图参考
          </span>
          <Tooltip content="关闭（不保存）">
            <button
              type="button"
              className={styles.iconButton}
              aria-label="关闭预演"
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
              className={pointer.orbiting ? styles.viewportOrbiting : styles.viewport}
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
                  overlays={scene.overlays}
                  labels={labels}
                  figures={figures}
                  selectedId={selectedId}
                />
              )}
              {!ready && <span className={styles.status}>{error || '正在准备 3D 舞台…'}</span>}
            </div>
            <div className={styles.viewTools} role="toolbar" aria-label="视图">
              <button
                type="button"
                aria-pressed={scene.overlays.thirds}
                className={scene.overlays.thirds ? styles.toolActive : styles.tool}
                onClick={() => toggleOverlay('thirds')}
              >
                三分线
              </button>
              <button
                type="button"
                aria-pressed={scene.overlays.safe}
                className={scene.overlays.safe ? styles.toolActive : styles.tool}
                onClick={() => toggleOverlay('safe')}
              >
                安全框
              </button>
              <span className={styles.toolGap} />
              <Tooltip content="撤销上一步（⌘/Ctrl + Z）">
                <button
                  type="button"
                  className={styles.tool}
                  aria-label="撤销"
                  disabled={!scene.canUndo}
                  onClick={scene.undo}
                >
                  <VscDiscard />
                </button>
              </Tooltip>
              <Tooltip content="回到正面、对准人物">
                <button
                  type="button"
                  className={styles.tool}
                  aria-label="重置视角"
                  onClick={scene.camera.reset}
                >
                  <VscScreenFull />
                </button>
              </Tooltip>
            </div>
          </div>
          <aside className={styles.side}>
            <div className={styles.sideScroll}>
              <CameraPanel view={view} camera={scene.camera} />
              <FigurePanel scene={scene} availableCharacters={availableCharacters ?? characters} />
              <ScenePanel scene={scene} />
            </div>
            <footer className={styles.sideFoot}>
              {error && ready && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button
                type="button"
                className={styles.primary}
                disabled={!ready || saving}
                onClick={() => void save()}
              >
                {saving ? '保存中…' : '截图作为构图'}
              </button>
            </footer>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PrevizDialog;
