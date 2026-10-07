/**
 * 3D 预演（摆拍）：像 Blender 一样先用木偶小人摆好站位、朝向、姿势，选景别与角度，截一张图作为首帧构图参考。
 * 不需要专业参数：拖动地面上的人物改站位，点选人物换姿势，景别默认跟镜头一致。
 */
import React, { useEffect, useRef, useState } from 'react';
import { VscClose } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import {
  CAMERA_ANGLES,
  POSE_PRESETS,
  SHOT_CAMERA,
  clampToStage,
  defaultFigures,
  type CameraAngle,
  type PrevizFigure,
} from './presets';
import styles from './styles.module.scss';

/** 舞台接口（three.js 实现在 stage.ts，测试可注入假实现） */
export interface PrevizStageApi {
  resize(width: number, height: number): void;
  setCamera(shotSize: string, angle: CameraAngle): void;
  setFigures(figures: readonly PrevizFigure[], selectedId: string | null): void;
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null;
  pickFigure(clientX: number, clientY: number): string | null;
  capture(): Promise<Uint8Array>;
  dispose(): void;
}

export type CreatePrevizStage = (canvas: HTMLCanvasElement) => Promise<PrevizStageApi>;

const defaultCreateStage: CreatePrevizStage = async (canvas) => {
  const { PrevizStage } = await import('./stage');
  return new PrevizStage(canvas);
};

function ratioOf(aspectRatio: string): number {
  const [w, h] = aspectRatio.split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

export interface PrevizDialogProps {
  shotLabel: string;
  shotSize: string;
  characters: readonly string[];
  aspectRatio: string;
  onSave: (png: Uint8Array) => Promise<void>;
  onClose: () => void;
  createStage?: CreatePrevizStage;
}

const PrevizDialog: React.FC<PrevizDialogProps> = ({
  shotLabel,
  shotSize: initialShotSize,
  characters,
  aspectRatio,
  onSave,
  onClose,
  createStage = defaultCreateStage,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PrevizStageApi | null>(null);
  const dragRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [figures, setFigures] = useState<PrevizFigure[]>(() => defaultFigures(characters));
  const [selectedId, setSelectedId] = useState<string | null>(figures[0]?.id ?? null);
  const [shotSize, setShotSize] = useState(SHOT_CAMERA[initialShotSize] ? initialShotSize : '中景');
  const [angle, setAngle] = useState<CameraAngle>('eye');
  const selected = figures.find((figure) => figure.id === selectedId) ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    createStage(canvas)
      .then((stage) => {
        if (disposed) {
          stage.dispose();
          return;
        }
        stageRef.current = stage;
        const frame = frameRef.current;
        if (frame) stage.resize(frame.clientWidth, frame.clientHeight);
        setReady(true);
      })
      .catch(() => setError('当前环境不支持 3D 预演（需要 WebGL）'));
    return () => {
      disposed = true;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, [createStage]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      stageRef.current?.resize(frame.clientWidth, frame.clientHeight)
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ready) stageRef.current?.setCamera(shotSize, angle);
  }, [angle, ready, shotSize]);
  useEffect(() => {
    if (ready) stageRef.current?.setFigures(figures, selectedId);
  }, [figures, ready, selectedId]);

  const updateSelected = (patch: Partial<PrevizFigure>) =>
    setFigures((prev) =>
      prev.map((figure) => (figure.id === selectedId ? { ...figure, ...patch } : figure))
    );

  const save = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setSaving(true);
    try {
      await onSave(await stage.capture());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-label={`3D 预演 · ${shotLabel}`}
      data-testid="previz-dialog"
    >
      <div className={styles.dialog}>
        <header className={styles.head}>
          <h2 className={styles.title}>3D 预演 · {shotLabel}</h2>
          <span className={styles.hint}>
            拖动人物改站位，点选人物换姿势；截图会作为首帧的构图参考
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
          <div
            ref={frameRef}
            className={styles.frame}
            style={{ aspectRatio: String(ratioOf(aspectRatio)) }}
            onPointerDown={(event) => {
              const stage = stageRef.current;
              if (!stage) return;
              const id = stage.pickFigure(event.clientX, event.clientY);
              if (id) {
                setSelectedId(id);
                dragRef.current = id;
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }
            }}
            onPointerMove={(event) => {
              const id = dragRef.current;
              const stage = stageRef.current;
              if (!id || !stage) return;
              const point = stage.pickGround(event.clientX, event.clientY);
              if (!point) return;
              setFigures((prev) =>
                prev.map((figure) =>
                  figure.id === id
                    ? { ...figure, x: clampToStage(point.x), z: clampToStage(point.z) }
                    : figure
                )
              );
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
          >
            <canvas ref={canvasRef} className={styles.canvas} data-testid="previz-canvas" />
            {!ready && <span className={styles.status}>{error || '正在准备 3D 舞台…'}</span>}
          </div>
          <aside className={styles.side}>
            <section className={styles.group} aria-label="镜头">
              <h3>镜头</h3>
              <label className={styles.field}>
                <span>景别</span>
                <select
                  aria-label="预演景别"
                  value={shotSize}
                  onChange={(event) => setShotSize(event.target.value)}
                >
                  {Object.keys(SHOT_CAMERA).map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.segment} role="radiogroup" aria-label="镜头角度">
                {CAMERA_ANGLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={angle === item.id}
                    className={angle === item.id ? styles.segmentActive : undefined}
                    onClick={() => setAngle(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
            <section className={styles.group} aria-label="人物">
              <h3>人物</h3>
              <div className={styles.figureList} role="listbox" aria-label="预演人物">
                {figures.map((figure) => (
                  <button
                    key={figure.id}
                    type="button"
                    role="option"
                    aria-selected={figure.id === selectedId}
                    className={figure.id === selectedId ? styles.figureActive : styles.figure}
                    onClick={() => setSelectedId(figure.id)}
                  >
                    <span className={styles.dot} style={{ background: figure.color }} />
                    {figure.name}
                  </button>
                ))}
              </div>
              {selected && (
                <>
                  <div className={styles.poses} role="radiogroup" aria-label="姿势">
                    {POSE_PRESETS.map((pose) => (
                      <button
                        key={pose.id}
                        type="button"
                        role="radio"
                        aria-checked={selected.pose === pose.id}
                        className={selected.pose === pose.id ? styles.poseActive : styles.pose}
                        onClick={() => updateSelected({ pose: pose.id })}
                      >
                        {pose.label}
                      </button>
                    ))}
                  </div>
                  <label className={styles.field}>
                    <span>朝向</span>
                    <input
                      type="range"
                      aria-label="人物朝向"
                      min={-180}
                      max={180}
                      step={15}
                      value={Math.round((selected.rotation * 180) / Math.PI)}
                      onChange={(event) =>
                        updateSelected({ rotation: (Number(event.target.value) * Math.PI) / 180 })
                      }
                    />
                  </label>
                </>
              )}
            </section>
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
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PrevizDialog;
