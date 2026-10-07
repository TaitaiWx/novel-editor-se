/**
 * 3D 预演的编辑状态：人物、道具、选中项、机位、时段与辅助线，以及「撤销上一步」。
 * 只在内存里，截图后由调用方保存图片；关闭弹窗即丢弃。
 */
import { useCallback, useRef, useState } from 'react';
import {
  SHOT_FRAMING,
  clampPedestal,
  clampPitch,
  clampToStage,
  createFigure,
  createProp,
  defaultCameraView,
  defaultFigures,
  defaultLensFor,
  figuresCenter,
  normalizeRotation,
  normalizeYaw,
  type CameraAngle,
  type MoodId,
  type PrevizCameraView,
  type PrevizFigure,
  type PrevizProp,
  type PropKind,
} from './presets';

interface Snapshot {
  figures: PrevizFigure[];
  props: PrevizProp[];
  selectedId: string | null;
}

export interface PrevizOverlays {
  thirds: boolean;
  safe: boolean;
}

const HISTORY_LIMIT = 40;
/** 同一类连续操作（拖滑块、拖人物）在这段时间内只记一步撤销 */
const COALESCE_MS = 800;

export function usePrevizScene(characters: readonly string[], initialShotSize: string) {
  const [figures, setFigures] = useState<PrevizFigure[]>(() => defaultFigures(characters));
  const [props, setProps] = useState<PrevizProp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => figures[0]?.id ?? null);
  const [view, setView] = useState<PrevizCameraView>(() =>
    defaultCameraView(SHOT_FRAMING[initialShotSize] ? initialShotSize : '中景')
  );
  const [mood, setMood] = useState<MoodId>('day');
  const [overlays, setOverlays] = useState<PrevizOverlays>({ thirds: true, safe: false });
  const [historySize, setHistorySize] = useState(0);
  const history = useRef<Snapshot[]>([]);
  const lastPush = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const current = useRef<Snapshot>({ figures, props, selectedId });
  current.current = { figures, props, selectedId };

  /** 记录撤销点；key 相同且间隔很短的连续操作合并为一步 */
  const remember = useCallback((key: string) => {
    const now = Date.now();
    if (key && lastPush.current.key === key && now - lastPush.current.at < COALESCE_MS) {
      lastPush.current.at = now;
      return;
    }
    lastPush.current = { key, at: now };
    history.current = [...history.current, current.current].slice(-HISTORY_LIMIT);
    setHistorySize(history.current.length);
  }, []);

  const undo = useCallback(() => {
    const previous = history.current[history.current.length - 1];
    if (!previous) return;
    history.current = history.current.slice(0, -1);
    lastPush.current = { key: '', at: 0 };
    setHistorySize(history.current.length);
    setFigures(previous.figures);
    setProps(previous.props);
    setSelectedId(previous.selectedId);
  }, []);

  const isProp = useCallback((id: string | null) => Boolean(id && /^p\d+$/.test(id)), []);

  const updateFigure = useCallback(
    (id: string, patch: Partial<PrevizFigure>, key = `figure:${id}`) => {
      remember(key);
      setFigures((prev) =>
        prev.map((figure) => (figure.id === id ? { ...figure, ...patch } : figure))
      );
    },
    [remember]
  );

  const updateProp = useCallback(
    (id: string, patch: Partial<PrevizProp>, key = `prop:${id}`) => {
      remember(key);
      setProps((prev) => prev.map((prop) => (prop.id === id ? { ...prop, ...patch } : prop)));
    },
    [remember]
  );

  /** 拖动：移动到地面点（限制在舞台内）；一次拖动只记一步撤销 */
  const moveItem = useCallback(
    (id: string, x: number, z: number) => {
      const patch = { x: clampToStage(x), z: clampToStage(z) };
      if (isProp(id)) updateProp(id, patch, `move:${id}`);
      else updateFigure(id, patch, `move:${id}`);
    },
    [isProp, updateFigure, updateProp]
  );

  const rotationOf = useCallback(
    (id: string) =>
      (isProp(id)
        ? current.current.props.find((prop) => prop.id === id)?.rotation
        : current.current.figures.find((figure) => figure.id === id)?.rotation) ?? 0,
    [isProp]
  );

  const setRotation = useCallback(
    (id: string, radians: number) => {
      const rotation = normalizeRotation(radians);
      if (isProp(id)) updateProp(id, { rotation }, `rotate:${id}`);
      else updateFigure(id, { rotation }, `rotate:${id}`);
    },
    [isProp, updateFigure, updateProp]
  );

  const rotateBy = useCallback(
    (id: string, radians: number) => setRotation(id, rotationOf(id) + radians),
    [rotationOf, setRotation]
  );

  const addFigure = useCallback(
    (name: string) => {
      remember('');
      const figure = createFigure(name, current.current.figures);
      setFigures((prev) => [...prev, figure]);
      setSelectedId(figure.id);
    },
    [remember]
  );

  const addProp = useCallback(
    (kind: PropKind) => {
      remember('');
      const prop = createProp(kind, current.current.props);
      setProps((prev) => [...prev, prop]);
      setSelectedId(prop.id);
    },
    [remember]
  );

  /** 移除人物或道具；选中项被移除时改选第一个人物 */
  const removeItem = useCallback(
    (id: string) => {
      remember('');
      const nextFigures = current.current.figures.filter((figure) => figure.id !== id);
      setFigures(nextFigures);
      setProps((prev) => prev.filter((prop) => prop.id !== id));
      setSelectedId((prev) => (prev === id ? (nextFigures[0]?.id ?? null) : prev));
    },
    [remember]
  );

  const patchView = useCallback(
    (patch: Partial<PrevizCameraView>) => setView((prev) => ({ ...prev, ...patch })),
    []
  );

  const camera = {
    /** 换景别时焦距跟着换成该景别的常用焦距（之后仍可手动改） */
    setShotSize: (shotSize: string) => patchView({ shotSize, lens: defaultLensFor(shotSize) }),
    setAngle: (angle: CameraAngle) => patchView({ angle, pitch: 0 }),
    setLens: (lens: number) => patchView({ lens }),
    setYaw: (yaw: number) => patchView({ yaw: normalizeYaw(yaw) }),
    setPitch: (pitch: number) => patchView({ pitch: clampPitch(pitch) }),
    setPedestal: (pedestal: number) => patchView({ pedestal: clampPedestal(pedestal) }),
    /** 重置视角：回到正面、对准人物中心，景别 / 角度 / 焦距不变 */
    reset: () => {
      const center = figuresCenter(current.current.figures);
      patchView({ yaw: 0, pitch: 0, pedestal: 0, focusX: center.x, focusZ: center.z });
    },
  };

  return {
    figures,
    props,
    selectedId,
    setSelectedId,
    view,
    camera,
    mood,
    setMood,
    overlays,
    setOverlays,
    canUndo: historySize > 0,
    undo,
    isProp,
    updateFigure,
    updateProp,
    moveItem,
    setRotation,
    rotateBy,
    addFigure,
    addProp,
    removeItem,
  };
}

export type PrevizScene = ReturnType<typeof usePrevizScene>;
