import { useEffect, useRef, useState } from 'react';

type Pins = Record<string, boolean>;
const readPins = (raw: unknown): Pins => {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') throw new Error('常驻设定读取失败');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('常驻设定格式无效');
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id, pinned]) => /^[\w:-]{1,100}$/.test(id) && typeof pinned === 'boolean'
    )
  );
};

/** 固定是作品内的展示偏好，不经过人物内容解析器，也不参与 AI 改写。 */
export function usePinnedEntries(workPath: string | null, characterId: number) {
  const key = workPath
    ? `novel-editor:development-pins:${JSON.stringify([workPath, characterId])}`
    : '';
  const [state, setState] = useState<{ key: string; pins: Pins; ready: boolean }>({
    key: '',
    pins: {},
    ready: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const scope = useRef(key);
  scope.current = key;
  const revision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const ipc = window.electron?.ipcRenderer;
    setError('');
    setSaving(false);
    setState({ key, pins: {}, ready: false });
    const load = async () => {
      if (!key || !ipc) return;
      const request = ++revision.current;
      try {
        const pins = readPins(await ipc.invoke('db-settings-get', key));
        if (!cancelled && request === revision.current) setState({ key, pins, ready: true });
      } catch (e) {
        if (!cancelled && request === revision.current)
          setError(e instanceof Error ? e.message : '常驻设定读取失败');
      }
    };
    void load();
    const dispose = ipc?.on('settings-updated', (_event, changedKey: string) => {
      if (changedKey === key && !writing.current) void load();
    });
    return () => {
      cancelled = true;
      if (typeof dispose === 'function') dispose();
    };
  }, [key]);

  const update = async (id: string, pinned: boolean) => {
    const ipc = window.electron?.ipcRenderer;
    if (!key || !ipc || state.key !== key || !state.ready || writing.current) return;
    writing.current = true;
    revision.current++;
    setSaving(true);
    setError('');
    try {
      // 读取最新偏好再合并，避免覆盖另一个分页刚固定的条目。
      const pins = { ...readPins(await ipc.invoke('db-settings-get', key)), [id]: pinned };
      if (scope.current !== key) return;
      await ipc.invoke('db-settings-set', key, JSON.stringify(pins));
      const saved = readPins(await ipc.invoke('db-settings-get', key));
      if (saved[id] !== pinned) throw new Error('固定状态未保存，请重试');
      if (scope.current === key) setState({ key, pins: saved, ready: true });
    } catch (e) {
      if (scope.current === key)
        setError(e instanceof Error ? e.message : '固定状态保存失败，请重试');
    } finally {
      writing.current = false;
      if (scope.current === key) setSaving(false);
    }
  };
  return {
    pins: state.key === key ? state.pins : {},
    ready: state.key === key && state.ready,
    saving,
    error,
    update,
  };
}
