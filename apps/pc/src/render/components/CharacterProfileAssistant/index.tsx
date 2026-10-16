import UiButton from '@novel-editor/ui/Button';
import UiTextArea from '@novel-editor/ui/TextArea';
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Popover from '@novel-editor/ui/Popover';
import Tooltip from '@novel-editor/ui/Tooltip';
import { VscDebugStop, VscHistory } from 'react-icons/vsc';
import { useDirectionHistory } from './useDirectionHistory';
import { completeWithSignal } from '../../utils/completeWithSignal';
import GenerationStatus, { type GenerationPhase } from '@novel-editor/ui/GenerationStatus';
import {
  ENRICHMENT_SECTIONS,
  enrichmentPrompt,
  defaultEnrichmentPlan,
  enrichmentRoutingPrompt,
  parseEnrichmentPlan,
  type EnrichmentTask,
  type EnrichmentTarget,
  parseEnrichmentResponse,
  EnrichmentResponseError,
  parseEnrichment,
  type EnrichmentPerson,
  type EnrichmentValues,
  type EnrichmentSection,
  type EnrichmentChapter,
} from '@novel-editor/core/character-enrichment';
import styles from './styles.module.scss';

export interface CharacterProfileAssistantHandle {
  retry: (section: EnrichmentSection) => void;
  cancel: () => void;
}
export interface EnrichmentProgress {
  running: boolean;
  planning?: boolean;
  states: Partial<Record<EnrichmentSection, { phase: GenerationPhase; reason?: string }>>;
  section: EnrichmentSection;
  completed: number;
  failed: EnrichmentSection[];
  total: number;
}
function CharacterProfileAssistant(
  {
    character,
    chapters,
    workPath,
    disabled,
    onFill,
    onProgress,
  }: {
    character: EnrichmentPerson;
    chapters?: EnrichmentChapter[];
    workPath: string | null;
    disabled?: boolean;
    onFill: (values: EnrichmentValues, expected: EnrichmentPerson) => boolean;
    onProgress: (progress: EnrichmentProgress | null) => void;
  },
  ref: React.ForwardedRef<CharacterProfileAssistantHandle>
) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useDirectionHistory(workPath, character.id);
  const closePopover = () => {
    setOpen(false);
    setDirection('');
    setHistoryOpen(false);
  };
  const [progress, setProgress] = useState<EnrichmentProgress | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const lastTasks = useRef<
    Partial<Record<EnrichmentSection, { task: EnrichmentTask; direction: string }>>
  >({});
  const lastDirection = useRef('');
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const callbacks = useRef({ onFill, onProgress });
  callbacks.current = { onFill, onProgress };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      callbacks.current.onProgress(null);
    };
  }, []);
  useEffect(() => {
    if (open && !running.current) input.current?.focus({ preventScroll: true });
  }, [open]);
  const report = (value: EnrichmentProgress | null) => {
    setProgress(value);
    callbacks.current.onProgress(value);
  };
  const generate = async (only?: EnrichmentSection) => {
    if (running.current || disabled || !workPath) return;
    running.current = true;
    const run = new AbortController();
    controller.current = run;
    closePopover();
    setNotice('');
    setNoticeError(false);
    anchor.current?.focus({ preventScroll: true });
    const expected = structuredClone({ ...character, chapters });
    const instruction = only
      ? (lastTasks.current[only]?.direction ?? lastDirection.current)
      : direction.trim();
    if (!only) {
      lastDirection.current = instruction;
      history.remember(instruction);
    }
    const values: EnrichmentValues = { design: {}, voice: {}, development: {} };
    const states: EnrichmentProgress['states'] = { ...progress?.states };
    let tasks: EnrichmentTask[] = [];
    let completed = 0;
    let currentSection: EnrichmentSection = only ?? 'design';
    let planning = !only && !!instruction;
    const alive = () => mounted.current && !run.signal.aborted;
    const publish = (active: boolean) => {
      if (!mounted.current) return;
      report({
        section: currentSection,
        completed,
        total: tasks.length,
        running: active,
        planning,
        states: { ...states },
        failed: ENRICHMENT_SECTIONS.filter((item) => states[item.id]?.phase === 'failed').map(
          (item) => item.id
        ),
      });
    };
    publish(true);
    try {
      if (only) {
        const saved = lastTasks.current[only];
        tasks = saved
          ? [saved.task]
          : defaultEnrichmentPlan().filter((task) => task.section === only);
      } else if (instruction) {
        const routing = await completeWithSignal(
          {
            prompt: enrichmentRoutingPrompt(instruction),
            temperature: 0,
            maxTokens: 3000,
            timeoutMs: 30000,
          },
          run.signal
        );
        if (!alive()) return;
        if (!routing.ok) throw new Error(routing.error.message);
        if (routing.data.finishReason === 'length' || routing.data.finishReason === 'max_tokens')
          throw new Error('生成范围分析未返回完整结果，请缩短补充方向后重试。');
        tasks = parseEnrichmentPlan(routing.data.text, instruction);
      } else tasks = defaultEnrichmentPlan();
      for (const task of tasks)
        lastTasks.current[task.section] = { task: structuredClone(task), direction: instruction };
      planning = false;
      for (const task of tasks) states[task.section] = { phase: 'waiting' };
      for (const task of tasks) {
        if (!alive()) return;
        currentSection = task.section;
        states[task.section] = { phase: 'generating' };
        publish(true);
        try {
          const pending: {
            targets: EnrichmentTarget[];
            compact: boolean;
            attempts: number;
            feedback?: string;
          }[] = [];
          const regular: EnrichmentTarget[] = [];
          for (const target of task.targets) {
            if (target.type === 'entry' && target.count) {
              for (let count = target.count; count > 0; count -= 3)
                pending.push({
                  targets: [{ ...target, count: Math.min(3, count) }],
                  compact: false,
                  attempts: 0,
                });
            } else {
              regular.push(target);
            }
          }
          for (let index = 0; index < regular.length; index += 4)
            pending.push({ targets: regular.slice(index, index + 4), compact: false, attempts: 0 });
          const deadline = Date.now() + Math.max(120_000, pending.length * 45_000);
          let added = false;
          while (pending.length) {
            if (!alive()) return;
            const batch = pending.shift()!;
            const remaining = deadline - Date.now();
            if (remaining < 1000) throw new Error('此页生成超时，请重试此页。');
            const context: EnrichmentPerson = {
              ...expected,
              network: expected.network
                ? {
                    ...expected.network,
                    relations: [...expected.network.relations, ...(values.newRelations ?? [])],
                  }
                : undefined,
              relations: expected.relations?.map((relation) => ({
                ...relation,
                note: relation.id
                  ? (values.relationNotes?.[relation.id] ?? relation.note)
                  : relation.note,
              })),
              design: { ...expected.design, ...values.design } as EnrichmentPerson['design'],
              voice: { ...expected.voice, ...values.voice },
              development: { ...expected.development, ...values.development },
            };
            const result = await completeWithSignal(
              {
                prompt: enrichmentPrompt(
                  context,
                  task.section,
                  batch.feedback
                    ? `${instruction}\n上次返回未通过校验，请纠正：${batch.feedback}`
                    : instruction,
                  batch.targets,
                  batch.compact,
                  task.operation
                ),
                temperature: 0.6,
                maxTokens: 6000,
                timeoutMs: Math.min(remaining, 120_000),
              },
              run.signal
            );
            if (!alive()) return;
            if (!result.ok) throw new Error(result.error.message);
            let parsed: EnrichmentValues;
            try {
              parsed = parseEnrichment(
                parseEnrichmentResponse(result.data.text, result.data.finishReason),
                task.section,
                context,
                () => crypto.randomUUID(),
                new Date().toISOString(),
                batch.targets,
                task.operation
              );
            } catch (error) {
              if (!(error instanceof EnrichmentResponseError)) throw error;
              if (batch.targets.length > 1) {
                const middle = Math.ceil(batch.targets.length / 2);
                pending.unshift(
                  { ...batch, targets: batch.targets.slice(0, middle), compact: true },
                  { ...batch, targets: batch.targets.slice(middle), compact: true }
                );
              } else if (!batch.compact)
                pending.unshift({ ...batch, compact: true, feedback: error.message });
              else throw error;
              states[task.section] = { phase: 'generating', reason: '正在缩小生成范围并重试…' };
              publish(true);
              continue;
            }
            values.newRelations = [...(values.newRelations ?? []), ...(parsed.newRelations ?? [])];
            values.relationNotes = { ...values.relationNotes, ...parsed.relationNotes };
            Object.assign(values.design, parsed.design);
            Object.assign(values.voice, parsed.voice);
            Object.assign(values.development, parsed.development);
            added = callbacks.current.onFill(parsed, expected) || added;
            const remainingTask = lastTasks.current[task.section]!.task;
            for (const target of batch.targets) {
              const count =
                target.type === 'entry' && target.count !== undefined
                  ? Object.values(parsed.development).filter(
                      (value) => JSON.parse(value).kind === target.key
                    ).length
                  : undefined;
              remainingTask.targets = remainingTask.targets.flatMap((item) => {
                if (item.type !== target.type || item.key !== target.key) return [item];
                if (item.type === 'entry' && item.count !== undefined && count !== undefined)
                  return item.count > count ? [{ ...item, count: item.count - count }] : [];
                return [];
              });
              if (
                target.type === 'entry' &&
                target.count !== undefined &&
                count !== undefined &&
                count < target.count
              ) {
                if (batch.attempts >= 2)
                  throw new Error(
                    `模型未生成足够的有效条目，仍缺 ${remainingTask.targets.reduce((n, item) => n + (item.type === 'entry' ? (item.count ?? 0) : 0), 0)} 项；重试将只补剩余数量。`
                  );
                pending.unshift({
                  targets: [{ ...target, count: target.count - count }],
                  compact: batch.compact,
                  attempts: batch.attempts + 1,
                });
                states[task.section] = { phase: 'generating', reason: '正在补齐指定数量…' };
                publish(true);
              }
            }
          }
          states[task.section] = {
            phase: 'done',
            reason: added ? '已填入草稿，等待保存' : '已检查，没有新增内容',
          };
        } catch (error) {
          if (!alive()) throw error;
          states[task.section] = {
            phase: 'failed',
            reason: `${error instanceof Error ? error.message : '生成失败，请重试'} 已填入的草稿会保留，可单独保存。`,
          };
        }
        completed++;
        publish(true);
      }
    } catch (error) {
      if (mounted.current && !run.signal.aborted) {
        setNoticeError(true);
        setNotice(
          error instanceof SyntaxError
            ? '未能解析生成范围，请重新描述补充方向。'
            : error instanceof Error
              ? error.message
              : '生成失败，请重试。'
        );
      }
    } finally {
      if (run.signal.aborted) {
        for (const task of tasks) {
          if (states[task.section]?.phase === 'waiting') delete states[task.section];
          else if (states[task.section]?.phase === 'generating')
            states[task.section] = { phase: 'cancelled', reason: '已取消，已填入的草稿保留。' };
        }
        if (mounted.current) setNotice('已取消生成，已填入的草稿保留。');
      }
      planning = false;
      running.current = false;
      if (controller.current === run) controller.current = null;
      publish(false);
    }
  };
  useImperativeHandle(ref, () => ({
    cancel: () => controller.current?.abort(),
    retry: (section) => {
      void generate(section);
    },
  }));
  const busy = progress?.running ?? false;
  const progressLabel = progress
    ? progress.planning
      ? '正在分析补充范围'
      : `${ENRICHMENT_SECTIONS.find((s) => s.id === progress.section)!.label} · ${progress.completed}/${progress.total}`
    : '';
  return (
    <>
      <div className={styles.triggerRow}>
        <UiButton
          unstyled
          type="button"
          ref={anchor}
          className={styles.trigger}
          disabled={disabled || !workPath || busy}
          title={busy ? progressLabel : undefined}
          onClick={() => (open ? closePopover() : setOpen(true))}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-busy={busy}
        >
          {busy ? (
            <GenerationStatus
              label={
                progress?.planning
                  ? '分析需求…'
                  : `丰富中 ${progress?.completed}/${progress?.total}`
              }
            />
          ) : (
            'AI 丰富人物'
          )}
        </UiButton>
        {busy && (
          <Tooltip content="取消生成" position="bottom">
            <UiButton
              unstyled
              type="button"
              className={`${styles.trigger} ${styles.cancelButton}`}
              aria-label="取消生成"
              onClick={() => controller.current?.abort()}
            >
              <VscDebugStop size={16} aria-hidden="true" />
            </UiButton>
          </Tooltip>
        )}
      </div>
      {notice && (
        <div
          className={`${styles.notice} ${noticeError ? styles.error : ''}`}
          role={noticeError ? 'alert' : 'status'}
        >
          {notice}
        </div>
      )}
      <Popover
        open={open}
        anchorRef={anchor}
        placement="bottom"
        align="end"
        className={styles.enrichmentPopover}
        onClose={closePopover}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.popoverHeader}>
          <strong>AI 丰富人物</strong>
          <UiButton unstyled type="button" aria-label="关闭" onClick={closePopover}>
            ×
          </UiButton>
        </div>
        <div className={styles.content}>
          <div className={styles.historyToolbar}>
            <UiButton
              unstyled
              type="button"
              className={styles.historyToggle}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <VscHistory aria-hidden="true" /> 历史记录
            </UiButton>
            {historyOpen && history.items.length > 0 && (
              <UiButton
                unstyled
                type="button"
                className={styles.historyToggle}
                onClick={history.clear}
              >
                清空记录
              </UiButton>
            )}
          </div>
          {historyOpen && (
            <div className={styles.historyPanel} aria-label="补充方向历史记录">
              {history.items.length ? (
                <>
                  <span className={styles.hint}>最近 20 条已提交方向，点击填入。</span>
                  <ul>
                    {history.items.map((item) => (
                      <li key={item.text}>
                        <UiButton
                          unstyled
                          type="button"
                          onClick={() => {
                            setDirection(item.text);
                            setHistoryOpen(false);
                            input.current?.focus({ preventScroll: true });
                          }}
                        >
                          <span>{item.text}</span>
                          <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
                        </UiButton>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <span className={styles.hint}>暂无已提交的补充方向</span>
              )}
            </div>
          )}
          <label className={styles.field}>
            补充方向（选填）
            <UiTextArea
              unstyled
              ref={input}
              rows={2}
              maxLength={1000}
              disabled={busy}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              placeholder="例如：补齐人物、背景、能力和剧情设定"
            />
          </label>
          {busy && progress && (
            <div className={styles.progress} role="status">
              <GenerationStatus label={progressLabel} />
              <progress
                max={progress.total}
                value={progress.completed}
                aria-label="人物资料生成进度"
              />
            </div>
          )}
          <div className={styles.actions}>
            <span className={styles.hint}>填写方向只处理相关内容；留空则补全各页缺口。</span>
            <UiButton
              unstyled
              type="button"
              disabled={busy || disabled}
              onClick={() => void generate()}
            >
              {busy ? <GenerationStatus label="生成中…" /> : '生成并填入'}
            </UiButton>
          </div>
        </div>
      </Popover>
    </>
  );
}

export default React.forwardRef(CharacterProfileAssistant);
