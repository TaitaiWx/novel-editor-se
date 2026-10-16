import Checkbox from '@novel-editor/ui/Checkbox';
import UiButton from '@novel-editor/ui/Button';
import UiInput from '@novel-editor/ui/Input';
import {
  characterSyncPrompt,
  parseAiJson,
  parseProfileCandidates,
  normalizeCharacterName,
  type ProfileCandidate,
  type ProfileApplyRequest,
} from '@novel-editor/core/character-discovery';
import ProfileSuggestionCard, {
  type PendingProfileSuggestion,
} from '../CharacterProfileAssistant/ProfileSuggestionCard';
import { createPortal } from 'react-dom';
import React, { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  DEVELOPMENT_KINDS,
  DEVELOPMENT_STATUS_OPTIONS,
  developmentDisplayStatus,
  developmentStatusLabel,
  developmentEntries,
  parseDevelopmentCandidates,
  candidateEntry,
  parseDevelopmentEntry,
  type DevelopmentCandidate,
  type DevelopmentEntry,
  type DevelopmentChange,
} from '@novel-editor/core/character-development';
import type { Character } from '../RightPanel/types';
import { mapCharacterRows } from '../RightPanel/utils';
import Popover from '@novel-editor/ui/Popover';
import Select from '@novel-editor/ui/Select';
import {
  NOVEL_EDITOR_FILE_SAVED_EVENT,
  type NovelEditorFileSavedDetail,
} from '@/render/utils/editor-events';
import { isRendererPreparing } from '@/render/utils/rendererPreparation';
import styles from './styles.module.scss';

type Mode = 'manual' | 'review' | 'auto';
interface Suggestion {
  id: string;
  candidate: DevelopmentCandidate;
  character: Character;
  previous?: DevelopmentEntry;
  chapter: string;
  selected: boolean;
}
interface UndoItem {
  characterId: number;
  id: string;
  before: string;
  after: string;
}
interface Props {
  target: HTMLElement | null;
  workPath: string | null;
  filePath: string | null;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  enabled: boolean;
}
const keyFor = (work: string) => `novel-editor:setting-sync:${work}`;
const sameName = (a: string, b: string) =>
  a.trim().normalize('NFKC').toLowerCase() === b.trim().normalize('NFKC').toLowerCase();
const kindLabel = (kind: string) => DEVELOPMENT_KINDS.find((k) => k.id === kind)?.label ?? kind;
const statusLabel = developmentStatusLabel;

/** 显式启用后的保存监听；只分析已保存章节，手动识别则优先使用当前选区。 */
export default function CharacterSettingSync({
  target,
  workPath,
  filePath,
  editorViewRef,
  enabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('manual');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [notice, error]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [profiles, setProfiles] = useState<PendingProfileSuggestion[]>([]);
  const pendingCount = suggestions.length + profiles.length;
  const [undo, setUndo] = useState<UndoItem[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const generation = useRef(0);
  const lastScanned = useRef(new Map<string, string>());
  const latest = useRef({ workPath, filePath, enabled, mode });
  latest.current = { workPath, filePath, enabled, mode };
  useEffect(() => {
    const scopeToken = ++generation.current;
    setSuggestions([]);
    setProfiles([]);
    setUndo([]);
    setNotice('');
    setError('');
    let stored: string | null = null;
    try {
      stored = workPath ? localStorage.getItem(keyFor(workPath)) : null;
    } catch {
      /* 非持久化环境使用手动模式。 */
    }
    setMode(stored === 'review' || stored === 'auto' ? stored : 'manual');
    lastScanned.current.clear();
    return () => {
      generation.current = scopeToken + 1;
    };
  }, [workPath]);
  useEffect(() => {
    if (!target) setOpen(false);
  }, [target]);
  const loadCharacters = async (root: string): Promise<Character[]> => {
    const rows = await window.electron.ipcRenderer.invoke('db-character-list-by-folder', root);
    return mapCharacterRows(rows);
  };
  const apply = async (
    items: Suggestion[],
    root: string,
    token: number,
    sourceStillCurrent?: () => boolean
  ) => {
    const applied: UndoItem[] = [];
    const fresh = await loadCharacters(root);
    const complete = new Set<string>();
    try {
      // 同一人物在一次识别中可能获得多件物品；单个人物的修改原子提交。
      for (const characterId of [...new Set(items.map((s) => s.character.id))]) {
        if (generation.current !== token || latest.current.workPath !== root)
          throw new Error('作品已切换，已停止同步');
        if (sourceStillCurrent && !sourceStillCurrent())
          throw new Error('正文已变化，已暂停自动同步，请重新识别');
        const character = fresh.find((c) => c.id === characterId);
        if (!character) throw new Error('人物已删除，请重新识别');
        const changes: DevelopmentChange[] = [];
        const taken = new Map<string, { entry: DevelopmentEntry; expected: string }>();
        for (const suggestion of items.filter((s) => s.character.id === characterId)) {
          const previous = developmentEntries(character.development, character.design).find(
            (e) =>
              e.kind === suggestion.candidate.kind && sameName(e.name, suggestion.candidate.name)
          );
          if (
            previous?.events.some(
              (e) =>
                e.source === 'ai' &&
                e.chapter === suggestion.chapter &&
                e.quote === suggestion.candidate.quote &&
                e.status === suggestion.candidate.status
            )
          ) {
            complete.add(suggestion.id);
            continue;
          }
          // 候选生成后作者可能修改过同一条目，必须重新识别，而不是覆盖。
          if (
            previous &&
            (character.development?.[previous.id] ?? '') !==
              (suggestion.character.development?.[previous.id] ?? '')
          )
            throw new Error(`「${previous.name}」已被修改，请重新识别后确认`);
          const identity = `${suggestion.candidate.kind}:${suggestion.candidate.name.normalize('NFKC').toLowerCase()}`;
          const pending = taken.get(identity);
          const entry = candidateEntry(
            suggestion.candidate,
            pending?.entry ?? previous,
            suggestion.chapter,
            crypto.randomUUID(),
            new Date().toISOString()
          );
          taken.set(identity, {
            entry,
            expected: pending?.expected ?? character.development?.[entry.id] ?? '',
          });
        }
        for (const { entry, expected } of taken.values())
          changes.push({ id: entry.id, entry, expected });
        if (changes.length) {
          const result = await window.electron.ipcRenderer.invoke(
            'db-character-patch-development',
            root,
            characterId,
            changes
          );
          applied.push(
            ...changes.map((c) => ({
              characterId,
              id: c.id,
              before:
                c.expected ||
                (c.id.startsWith('legacy:')
                  ? JSON.stringify(
                      developmentEntries(character.development, character.design).find(
                        (e) => e.id === c.id
                      )
                    )
                  : ''),
              after: result[c.id],
            }))
          );
        }
        for (const s of items.filter((s) => s.character.id === characterId)) complete.add(s.id);
      }
    } finally {
      if (generation.current === token) {
        setUndo(applied);
        setSuggestions((current) => current.filter((s) => !complete.has(s.id)));
        if (applied.length) setNotice(`已同步 ${applied.length} 个设定条目，变化已加入人物档案。`);
      }
    }
    return applied.length;
  };
  const scan = async (automatic = false) => {
    const current = latest.current;
    if (
      running.current ||
      !current.workPath ||
      !current.filePath ||
      !current.enabled ||
      isRendererPreparing()
    )
      return;
    const root = current.workPath,
      file = current.filePath,
      token = generation.current;
    running.current = true;
    setBusy(true);
    setError('');
    if (!automatic) setOpen(true);
    try {
      let source = automatic
        ? await window.electron.ipcRenderer.invoke('read-file', file)
        : (editorViewRef.current?.state.doc.toString() ?? '');
      if (generation.current !== token || latest.current.filePath !== file) return;
      const whole = source;
      if (automatic && lastScanned.current.get(file) === whole) return;
      if (!automatic) {
        const selection = editorViewRef.current?.state.selection.main;
        if (selection && !selection.empty) source = source.slice(selection.from, selection.to);
      } else {
        const before = lastScanned.current.get(file);
        if (before !== undefined) {
          let from = 0,
            end = source.length,
            oldEnd = before.length;
          while (from < Math.min(before.length, source.length) && before[from] === source[from])
            from++;
          while (end > from && oldEnd > from && source[end - 1] === before[oldEnd - 1]) {
            end--;
            oldEnd--;
          }
          source = source.slice(Math.max(0, from - 1000), Math.min(source.length, end + 1000));
        }
      }
      if (!source.trim()) {
        setNotice('当前没有可识别的正文');
        return;
      }
      const characters = await loadCharacters(root);
      // 只传正文中能匹配的人物，避免大人物库占满模型上下文。
      const relevant = characters.filter((c) =>
        [c.name, ...(c.aliases ?? [])].some((name) => name && source.includes(name))
      );
      const found: DevelopmentCandidate[] = [];
      const discovered: ProfileCandidate[] = [];
      for (let offset = 0; offset < source.length; offset += 11000) {
        if (generation.current !== token || latest.current.filePath !== file) return;
        const excerpt = source.slice(offset, offset + 12000);
        const result = await window.electron.ipcRenderer.invoke('ai-complete', {
          prompt: characterSyncPrompt(
            excerpt,
            characters,
            relevant.map((c) => ({
              id: c.id,
              name: c.name,
              aliases: c.aliases,
              design: c.design,
              entries: developmentEntries(c.development, c.design).map((e) => ({
                ...e,
                events: e.events.slice(-5).map((event) => ({
                  ...event,
                  note: event.note.slice(0, 250),
                  quote: event.quote.slice(0, 500),
                })),
                description: e.description.slice(0, 600),
              })),
            }))
          ),
          temperature: 0.1,
          maxTokens: 6000,
        });
        if (!result.ok) throw new Error(result.error.message);
        const parsed = parseAiJson(result.data.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('AI 返回的设定建议格式不正确，请重试');
        const response = parsed as Record<string, unknown>;
        found.push(
          ...parseDevelopmentCandidates(
            JSON.stringify(response.developments ?? []),
            excerpt,
            relevant.map((c) => c.id)
          )
        );
        discovered.push(...parseProfileCandidates(response.characters ?? [], excerpt, characters));
      }
      if (generation.current !== token || latest.current.filePath !== file) return;
      if (editorViewRef.current?.state.doc.toString() !== whole) {
        setNotice('正文已变化，请重新识别；自动模式会在保存后再次检查。');
        return;
      }
      const seen = new Set<string>();
      const chapter = file.startsWith(`${root}/`)
        ? file.slice(root.length + 1)
        : file.split(/[\\/]/).pop()!;
      const next: Suggestion[] = found.flatMap((candidate) => {
        const key = `${candidate.characterId}:${candidate.kind}:${candidate.name}:${candidate.quote}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const character = relevant.find((c) => c.id === candidate.characterId)!;
        const previous = developmentEntries(character.development, character.design).find(
          (e) => e.kind === candidate.kind && sameName(e.name, candidate.name)
        );
        if (
          previous?.events.some(
            (e) =>
              e.source === 'ai' &&
              e.chapter === chapter &&
              e.quote === candidate.quote &&
              e.status === candidate.status
          )
        )
          return [];
        return [
          { id: crypto.randomUUID(), candidate, character, previous, chapter, selected: true },
        ];
      });
      const combined = new Map<string, ProfileCandidate>();
      for (const candidate of discovered) {
        const key =
          candidate.characterId === null
            ? `new:${normalizeCharacterName(candidate.name)}`
            : String(candidate.characterId);
        const previous = combined.get(key);
        if (previous) {
          const keys = new Set(previous.fields.map((f) => f.key));
          previous.fields.push(...candidate.fields.filter((f) => !keys.has(f.key)));
        } else combined.set(key, { ...candidate, fields: [...candidate.fields] });
      }
      const newProfiles = [...combined.values()].map(
        (candidate): PendingProfileSuggestion => ({
          id: crypto.randomUUID(),
          candidate,
          roster: characters,
          chapter,
          source: 'text',
        })
      );
      lastScanned.current.set(file, whole);
      setProfiles(newProfiles);
      setSuggestions(next);
      if (!next.length && !newProfiles.length) {
        setNotice('未发现需要新增或更新的设定。');
        return;
      }
      setNotice(`发现 ${newProfiles.length} 条人物建议、${next.length} 条设定变化，等待确认。`);
      // 自动模式也保留候选与撤销入口；只有用户选择了自动同步才写入。
      if (next.length && automatic && latest.current.mode === 'auto')
        await apply(
          next,
          root,
          token,
          () =>
            latest.current.mode === 'auto' &&
            latest.current.filePath === file &&
            editorViewRef.current?.state.doc.toString() === whole
        );
    } catch (e) {
      if (generation.current === token)
        setError(e instanceof Error ? e.message : '设定识别失败，请重试');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const scanRef = useRef(scan);
  scanRef.current = scan;
  useEffect(() => {
    if (!workPath || !filePath || mode === 'manual' || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<NovelEditorFileSavedDetail>).detail;
      if (detail?.filePath !== filePath) return;
      clearTimeout(timer);
      const runWhenIdle = () => {
        if (running.current) {
          timer = setTimeout(runWhenIdle, 2000);
          return;
        }
        if (!pendingCount) void scanRef.current(true);
      };
      timer = setTimeout(runWhenIdle, 4000);
    };
    document.addEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, listener);
    return () => {
      clearTimeout(timer);
      document.removeEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, listener);
    };
  }, [workPath, filePath, mode, enabled, pendingCount]);
  const adjustCandidate = (id: string, patch: Partial<DevelopmentCandidate>) => {
    setSuggestions((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const candidate = { ...item.candidate, ...patch };
        const previous = developmentEntries(item.character.development, item.character.design).find(
          (entry) => entry.kind === candidate.kind && sameName(entry.name, candidate.name)
        );
        return { ...item, candidate, previous };
      })
    );
  };
  const applySelected = async () => {
    if (!workPath || running.current) return;
    if (suggestions.some((s) => s.selected && !s.candidate.name.trim())) {
      setError('请填写选中条目的名称');
      return;
    }
    const token = generation.current;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await apply(
        suggestions.filter((s) => s.selected),
        workPath,
        token
      );
    } catch (e) {
      if (generation.current === token)
        setError(e instanceof Error ? e.message : '同步失败，请重试');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const applyProfile = async (id: string, request: ProfileApplyRequest) => {
    if (!workPath || running.current) return;
    const token = generation.current;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'db-character-apply-profile',
        workPath,
        request
      );
      if (generation.current === token) {
        setProfiles((items) => items.filter((s) => s.id !== id));
        setNotice(
          result.created
            ? `已创建临时配角「${request.name}」，可在人物库继续完善。`
            : `已更新「${request.name}」的人物资料。`
        );
      }
    } catch (e) {
      if (generation.current === token)
        setError(e instanceof Error ? e.message : '人物资料保存失败');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const undoLast = async () => {
    if (!workPath || running.current) return;
    const token = generation.current;
    running.current = true;
    setBusy(true);
    setError('');
    const remaining = [...undo];
    try {
      for (const characterId of [...new Set(undo.map((u) => u.characterId))]) {
        if (generation.current !== token || latest.current.workPath !== workPath)
          throw new Error('作品已切换，已停止撤销');
        const list = undo.filter((u) => u.characterId === characterId);
        await window.electron.ipcRenderer.invoke(
          'db-character-patch-development',
          workPath,
          characterId,
          list.map((u) => ({
            id: u.id,
            expected: u.after,
            entry: u.before ? parseDevelopmentEntry(JSON.parse(u.before)) : null,
          }))
        );
        for (const u of list) remaining.splice(remaining.indexOf(u), 1);
      }
      if (generation.current === token) setNotice('已撤销本次同步。');
    } catch (e) {
      if (generation.current === token)
        setError(e instanceof Error ? e.message : '撤销失败：条目可能已被修改');
    } finally {
      if (generation.current === token) setUndo(remaining);
      running.current = false;
      setBusy(false);
    }
  };
  if (!target) return null;
  return createPortal(
    <span className={styles.slot}>
      <UiButton
        unstyled
        type="button"
        ref={anchor}
        className={styles.pill}
        aria-label="设定同步"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setAcknowledged(true);
        }}
      >
        设定同步
        {busy
          ? ' · 识别中'
          : pendingCount
            ? ` · ${pendingCount} 待确认`
            : error
              ? ' · 失败'
              : undo.length
                ? ' · 已更新'
                : ''}
      </UiButton>
      {!open && !acknowledged && (pendingCount > 0 || undo.length > 0 || notice || error) && (
        <span role="status" className={styles.notice}>
          {error
            ? '设定同步失败，点击查看'
            : pendingCount
              ? `发现 ${pendingCount} 条人物与设定建议`
              : notice}
        </span>
      )}
      <Popover
        open={open}
        anchorRef={anchor}
        placement="bottom"
        align="end"
        className={styles.panel}
        closeOnOutsideClick
        closeOnEscape
        onClose={() => setOpen(false)}
        zIndex={1600}
      >
        <div className={styles.heading}>
          <strong>正文 → 人物设定</strong>
          <UiButton unstyled type="button" onClick={() => setOpen(false)}>
            关闭
          </UiButton>
        </div>
        <p className={styles.hint}>
          发现新人物、补充旧角色，并识别能力、物品和剧情变化。新人物可创建为临时配角，也可关联已有角色。人物资料始终确认后采用；手动识别优先使用选区。
        </p>
        <Select
          aria-label="设定同步方式"
          value={mode}
          onChange={(value) => {
            setMode(value);
            if (workPath)
              try {
                localStorage.setItem(keyFor(workPath), value);
              } catch {
                /* 当前会话仍有效。 */
              }
          }}
          options={[
            { value: 'manual', label: '手动识别，确认后同步' },
            { value: 'review', label: '保存后识别，确认后同步' },
            { value: 'auto', label: '保存后自动识别并同步' },
          ]}
        />
        <div className={styles.actions}>
          <UiButton
            unstyled
            type="button"
            disabled={busy || !enabled || !workPath || pendingCount > 0}
            onClick={() => void scan()}
          >
            识别当前正文 / 选区
          </UiButton>
          {undo.length > 0 && (
            <UiButton unstyled type="button" disabled={busy} onClick={() => void undoLast()}>
              撤销能力 / 剧情同步
            </UiButton>
          )}
        </div>
        {pendingCount > 0 && <p className={styles.hint}>先采用或忽略当前建议，再识别新的内容。</p>}
        {!enabled && <p className={styles.hint}>打开作品中的正文文件后即可识别。</p>}
        {notice && (
          <p role="status" className={styles.hint}>
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {profiles.map((s) => (
          <ProfileSuggestionCard
            key={s.id}
            suggestion={s}
            busy={busy}
            onApply={(request) => applyProfile(s.id, request)}
            onDismiss={() => {
              setProfiles((items) => items.filter((item) => item.id !== s.id));
              setNotice('已忽略此条人物建议。');
            }}
          />
        ))}
        {suggestions.map((s) => (
          <article key={s.id} className={styles.suggestion}>
            <Checkbox
              checked={s.selected}
              disabled={busy}
              onChange={(checked) =>
                setSuggestions((items) =>
                  items.map((item) => (item.id === s.id ? { ...item, selected: checked } : item))
                )
              }
            >
              <strong>
                {s.character.name} · {s.candidate.name}
              </strong>
              <span>{s.previous ? '更新' : '新增'}</span>
            </Checkbox>
            <p className={styles.hint}>
              {kindLabel(s.candidate.kind)} · {s.candidate.stage || s.previous?.stage || '未分期'} ·{' '}
              {statusLabel(s.candidate.status)}
            </p>
            <details className={styles.adjust}>
              <summary>调整归类与阶段</summary>
              <label>
                名称
                <UiInput
                  unstyled
                  disabled={busy}
                  maxLength={100}
                  value={s.candidate.name}
                  onChange={(event) => adjustCandidate(s.id, { name: event.target.value })}
                />
              </label>
              <label>
                类型
                <Select
                  value={s.candidate.kind}
                  disabled={busy}
                  onChange={(kind) => adjustCandidate(s.id, { kind })}
                  options={DEVELOPMENT_KINDS.map((kind) => ({ value: kind.id, label: kind.label }))}
                />
              </label>
              <label>
                阶段
                <UiInput
                  unstyled
                  disabled={busy}
                  maxLength={60}
                  value={s.candidate.stage}
                  placeholder="自由命名，也可留空"
                  onChange={(event) => adjustCandidate(s.id, { stage: event.target.value })}
                />
              </label>
              <label>
                状态
                <Select
                  value={developmentDisplayStatus(s.candidate.status)}
                  disabled={busy}
                  onChange={(status) => adjustCandidate(s.id, { status })}
                  options={DEVELOPMENT_STATUS_OPTIONS}
                />
              </label>
            </details>
            {s.previous && (
              <details>
                <summary>已有设定</summary>
                <p className={styles.copy}>{s.previous.description}</p>
              </details>
            )}
            <p className={styles.copy}>{s.candidate.detail}</p>
            <blockquote className={styles.copy}>{s.candidate.quote}</blockquote>
            <div className={styles.hint}>{s.chapter}</div>
          </article>
        ))}
        {suggestions.length > 0 && (
          <div className={styles.actions}>
            <UiButton
              unstyled
              type="button"
              disabled={busy}
              onClick={() => {
                setSuggestions([]);
                setNotice('已忽略本次候选，未修改人物设定。');
              }}
            >
              忽略本次
            </UiButton>
            <UiButton
              unstyled
              type="button"
              disabled={busy || !suggestions.some((s) => s.selected)}
              onClick={() => void applySelected()}
            >
              同步选中（{suggestions.filter((s) => s.selected).length}）
            </UiButton>
          </div>
        )}
      </Popover>
    </span>,
    target
  );
}
