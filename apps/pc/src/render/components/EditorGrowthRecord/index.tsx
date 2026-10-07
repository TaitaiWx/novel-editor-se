import React, { useEffect, useState } from 'react';
import type { GrowthEventInput } from '@novel-editor/core/growth';
import Popover from '../Popover';
import { useOptionalToast } from '../Toast';
import { GrowthRecordForm } from '../RightPanel/GrowthView/GrowthRecordForm';
import { describeRecordResult } from '../RightPanel/GrowthView/growthText';
import { emitGrowthMemoryChanged } from '../../utils/growthIndex';
import type { GrowthSnapshot } from '../../types/growth-api';
import styles from './styles.module.scss';

export interface EditorGrowthRecordProps {
  /** 为空时不显示 */
  request: { name: string; aliases: string[]; anchor: DOMRect } | null;
  /** 当前作品目录（成长档案跟随作品） */
  workPath: string | null;
  /** 当前打开的章节号，作为默认章节 */
  chapter: number | null;
  onClose: () => void;
}

/**
 * 人物悬停卡片的「记一笔」：复用成长档案的记录表单，章节默认填当前章。
 * 角色还没有成长卡时自动建卡（与人物详情「成长档案」入口一致），写入后广播刷新其他视图。
 */
const EditorGrowthRecord: React.FC<EditorGrowthRecordProps> = ({
  request,
  workPath,
  chapter,
  onClose,
}) => {
  const toast = useOptionalToast();
  const [snapshot, setSnapshot] = useState<GrowthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = request?.name ?? null;
  const aliasKey = request?.aliases.join('\u0000') ?? '';

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (!name || !workPath) return;
    let cancelled = false;
    const aliases = aliasKey ? aliasKey.split('\u0000') : [];
    void window.electron.ipcRenderer
      .invoke('growth-ensure-sheet', workPath, name, aliases)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setSnapshot(result.data);
        else setError(result.error);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [aliasKey, name, workPath]);

  const sheet = snapshot?.sheets.find((item) => item.name === name) ?? null;

  const submit = async (event: GrowthEventInput, force: boolean): Promise<string | null> => {
    if (!workPath || !name || !snapshot) return '成长档案还没有准备好';
    setBusy(true);
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'growth-apply-event',
        workPath,
        name,
        event,
        { force }
      );
      if (!result.ok) return result.error;
      const next = result.data.snapshot;
      setSnapshot(next);
      emitGrowthMemoryChanged(workPath, next);
      const message = describeRecordResult({
        name,
        ruleset: next.ruleset,
        event,
        before: sheet,
        after: next.sheets.find((item) => item.name === name) ?? null,
        levelUps: result.data.levelUps,
      });
      toast?.success(message);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={Boolean(request)}
      anchorRect={request?.anchor ?? null}
      placement="bottom"
      align="start"
      className={styles.popover}
      onClose={onClose}
      closeOnOutsideClick
      closeOnEscape
      zIndex={2000}
    >
      <div className={styles.title}>
        为 <strong>{name}</strong> 记一笔
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {!error && !sheet && <div className={styles.loading}>正在读取成长档案…</div>}
      {snapshot && sheet && (
        <GrowthRecordForm
          key={`${sheet.name}-${chapter ?? ''}`}
          ruleset={snapshot.ruleset}
          sheet={sheet}
          busy={busy}
          defaultChapter={chapter ?? undefined}
          chapterSource={chapter ? 'current' : null}
          onSubmit={submit}
          onCancel={onClose}
          onDone={onClose}
        />
      )}
    </Popover>
  );
};

export default EditorGrowthRecord;
