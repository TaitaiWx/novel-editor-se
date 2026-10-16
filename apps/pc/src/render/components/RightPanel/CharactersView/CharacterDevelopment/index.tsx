import UiButton from '@novel-editor/ui/Button';
import UiInput from '@novel-editor/ui/Input';
import DiffTextInput from '@novel-editor/ui/DiffTextInput';
import DiffText from '@novel-editor/ui/DiffTextInput/DiffText';
import GenerationStatus, { type GenerationPhase } from '@novel-editor/ui/GenerationStatus';
import { LuPin, LuPinOff } from 'react-icons/lu';
import Tooltip from '@novel-editor/ui/Tooltip';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEVELOPMENT_KINDS,
  DEVELOPMENT_STATUS_OPTIONS,
  developmentDisplayStatus,
  developmentStatusLabel,
  developmentEntries,
  developmentHistory,
  developmentPlaceholder,
  isPsychologyKind,
  isTagDevelopmentKind,
  type DevelopmentEntry,
  type DevelopmentKind,
  type DevelopmentSection,
  type DevelopmentMap,
} from '@novel-editor/core/character-development';
import type { Character } from '../../types';
import Select from '@novel-editor/ui/Select';
import Tabs from '@novel-editor/ui/Tabs';
import Popover from '@novel-editor/ui/Popover';
import { useUnsavedChangesGuard } from '@/render/hooks/useUnsavedChangesGuard';
import SearchMultiSelect from '@novel-editor/ui/SearchMultiSelect';
import type { EnrichmentChapter } from '@novel-editor/core/character-enrichment';
import { cancelEntryMetadata, enrichSavedEntry, resolveEntryMetadata } from './entryMetadata';
import DevelopmentHistory from './DevelopmentHistory';
import { usePinnedEntries } from './usePinnedEntries';
import styles from './styles.module.scss';

const kindLabel = (kind: DevelopmentKind) => DEVELOPMENT_KINDS.find((k) => k.id === kind)!.label;
const statusLabel = developmentStatusLabel;
function entryTone(status: DevelopmentEntry['status']) {
  // 时间分组由状态决定，自定义故事篇章不能覆盖状态。
  return status === 'planned' ? 'future' : developmentDisplayStatus(status);
}
function EntryCard({
  entry,
  onEdit,
  onTogglePin,
  pinDisabled,
  compact = false,
  original,
}: {
  entry: DevelopmentEntry;
  onEdit: () => void;
  onTogglePin: () => void;
  pinDisabled: boolean;
  compact?: boolean;
  original?: DevelopmentEntry | null;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const show = () => {
    cancel();
    timer.current = setTimeout(() => setHover(true), 250);
  };
  const hide = () => {
    cancel();
    timer.current = setTimeout(() => setHover(false), 150);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const latest = entry.events.at(-1);
  const shownStatus = entry.status;
  const tone = entryTone(shownStatus);
  return (
    <>
      <div
        className={compact ? styles.compactFrame : styles.cardFrame}
        data-pinned={!!entry.pinned}
      >
        <UiButton
          unstyled
          type="button"
          ref={anchor}
          className={
            compact
              ? `${styles.identityTag} ${entry.kind === 'identity' ? styles.identityBadge : ''}`
              : styles.card
          }
          aria-label={compact ? entry.name : undefined}
          data-tone={tone}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={() => {
            cancel();
            setHover(false);
            onEdit();
          }}
        >
          {compact ? (
            entry.kind === 'identity' ? (
              <span className={styles.tagName}>{entry.name}</span>
            ) : (
              <span>
                <DiffText
                  before={original === undefined ? undefined : (original?.name ?? '')}
                  value={entry.name}
                />
                <small className={styles.tagStage}>{statusLabel(shownStatus)}</small>
              </span>
            )
          ) : (
            <>
              <span className={styles.cardHeader}>
                <strong>
                  <DiffText
                    before={original === undefined ? undefined : (original?.name ?? '')}
                    value={entry.name}
                  />
                </strong>
                <span className={styles.badge} data-kind={entry.kind}>
                  {kindLabel(entry.kind)}
                </span>
              </span>
              <span className={styles.preview}>
                <DiffText
                  before={original === undefined ? undefined : (original?.description ?? '')}
                  value={entry.description || latest?.note || '点击补充详情'}
                />
              </span>
              <span className={styles.meta}>
                {statusLabel(shownStatus)}
                {entry.events.length > 0 ? ` · ${entry.events.length} 次记录` : ''}
              </span>
            </>
          )}
        </UiButton>
        {!compact && (
          <Tooltip
            className={styles.pinAction}
            content={
              pinDisabled
                ? '正在读取或保存'
                : entry.pinned
                  ? '取消常驻'
                  : '设为常驻，切换筛选时仍显示'
            }
          >
            <UiButton
              unstyled
              type="button"
              className={styles.pinButton}
              aria-label={`${entry.pinned ? '取消固定' : '固定'}：${entry.name}`}
              aria-pressed={!!entry.pinned}
              disabled={pinDisabled}
              onMouseEnter={() => {
                cancel();
                setHover(false);
              }}
              onClick={() => {
                cancel();
                setHover(false);
                onTogglePin();
              }}
            >
              {entry.pinned ? <LuPinOff aria-hidden="true" /> : <LuPin aria-hidden="true" />}
            </UiButton>
          </Tooltip>
        )}
      </div>
      <Popover
        open={hover}
        anchorRef={anchor}
        className={styles.popover}
        onMouseEnter={cancel}
        onMouseLeave={hide}
        onClose={() => setHover(false)}
        closeOnEscape
      >
        <header className={styles.popoverHeader}>
          <strong>
            <DiffText
              before={original === undefined ? undefined : (original?.name ?? '')}
              value={entry.name}
            />
          </strong>
          <div className={styles.popoverMeta}>
            <span className={styles.badge} data-kind={entry.kind}>
              {kindLabel(entry.kind)}
            </span>
            <span>{statusLabel(shownStatus)}</span>
            {entry.pinned && (
              <span className={styles.pinnedLabel}>
                <LuPin aria-hidden="true" />
                已固定
              </span>
            )}
          </div>
        </header>
        <div className={styles.popoverBody}>
          <p className={styles.copy}>
            <DiffText
              before={original === undefined ? undefined : (original?.description ?? '')}
              value={entry.description || '暂无说明'}
            />
          </p>
          {latest && latest.note !== entry.description && (
            <>
              <strong>最近变化</strong>
              <p className={styles.copy}>{latest.note}</p>
            </>
          )}
          {entry.chapter && <p className={styles.meta}>来源：{entry.chapter}</p>}
          {entry.quote && <blockquote className={styles.copy}>{entry.quote}</blockquote>}
        </div>
      </Popover>
    </>
  );
}
interface Props {
  character: Character;
  originalCharacter?: Character;
  draftBaseline?: DevelopmentMap;
  workPath: string | null;
  section: DevelopmentSection;
  chapters?: EnrichmentChapter[];
  onOpenGrowth: () => void;
  onOpenChapter?: (path: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  generationPhase?: GenerationPhase;
  onDraftSave?: (patch: DevelopmentMap) => void;
}
export default function CharacterDevelopment({
  character,
  originalCharacter,
  draftBaseline,
  workPath,
  section,
  chapters = [],
  onOpenGrowth,
  onOpenChapter,
  onDirtyChange,
  disabled,
  generationPhase,
  onDraftSave,
}: Props) {
  const originals = originalCharacter
    ? developmentEntries(
        { ...originalCharacter.development, ...draftBaseline },
        originalCharacter.design
      )
    : undefined;
  const originalEntry = (id: string) => originals?.find((entry) => entry.id === id);
  const [map, setMap] = useState<DevelopmentMap>(character.development ?? {});
  useEffect(() => setMap(character.development ?? {}), [character.development]);
  const pinning = usePinnedEntries(workPath, character.id);
  const all = useMemo(
    () =>
      developmentEntries(map, character.design).map((entry) => ({
        ...entry,
        pinned: pinning.pins[entry.id] ?? entry.pinned,
      })),
    [map, character.design, pinning.pins]
  );
  const kinds = DEVELOPMENT_KINDS.filter((k) => k.section === section);
  const entries = all.filter((e) => kinds.some((k) => k.id === e.kind));
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [kind, setKind] = useState<string>('*');
  const [statusFilter, setStatusFilter] = useState<'all' | 'planned' | 'active' | 'resolved'>(
    'all'
  );
  const [draft, setDraft] = useState<DevelopmentEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [metadataPending, setMetadataPending] = useState(false);
  const metadataController = useRef<AbortController | null>(null);
  useEffect(() => () => metadataController.current?.abort(), []);
  const [base, setBase] = useState('');
  const [initial, setInitial] = useState('');
  const [savingBusy, setBusy] = useState(false);
  const busy = savingBusy || pinning.saving || !!disabled;
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = !!draft && JSON.stringify(draft) !== initial;
  useUnsavedChangesGuard(dirty || busy);
  useEffect(() => {
    onDirtyChange?.(dirty || savingBusy || pinning.saving);
    return () => onDirtyChange?.(false);
  }, [dirty, savingBusy, pinning.saving, onDirtyChange]);
  const chapterOptions = chapters.map((chapter) => ({ value: chapter.path, label: chapter.label }));
  const beginEdit = (entry?: DevelopmentEntry, newKind?: DevelopmentKind) => {
    if (saving.current || disabled) return;
    if (dirty) {
      setError('请先保存或取消当前条目的修改');
      return;
    }
    if (entry && workPath) cancelEntryMetadata(workPath, character.id, entry.id);
    setEditing(!!entry);
    const next: DevelopmentEntry = entry
      ? structuredClone(entry)
      : {
          id: crypto.randomUUID(),
          kind: newKind ?? (kind === '*' ? kinds[0].id : (kind as DevelopmentKind)),
          name: '',
          description: '',
          stage: '',
          status: statusFilter === 'all' ? 'planned' : statusFilter,
          chapter: '',
          quote: '',
          relatedIds: [],
          growthEventId: '',
          events: [],
        };
    if (!next.chapterPaths && next.chapter) {
      const chapter = chapters.find(
        (item) => item.path === next.chapter || item.label === next.chapter
      );
      if (chapter) next.chapterPaths = [chapter.path];
    }
    setDraft(next);
    setBase(map[next.id] ?? '');
    setInitial(JSON.stringify(next));
    setError('');
    setConfirmDelete(false);
    setNotice('');
  };
  const save = async (remove = false) => {
    if (!draft || !workPath || saving.current || disabled) return;
    if (!remove && !draft.name.trim()) {
      setError('请填写条目名称');
      return;
    }
    if (!remove && !kinds.some((item) => item.id === draft.kind)) {
      setError('请选择当前页面的条目类型');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    let metadataWarning = '';
    try {
      const original = JSON.parse(initial) as DevelopmentEntry;
      const next = { ...draft, name: draft.name.trim(), stage: draft.stage.trim() };
      if (
        !remove &&
        editing &&
        (next.name !== original.name ||
          next.description !== original.description ||
          next.status !== original.status ||
          (!next.stage && !next.relatedIds.length && !next.chapterPaths?.length))
      ) {
        setMetadataPending(true);
        const controller = new AbortController();
        metadataController.current = controller;
        try {
          const metadata = await resolveEntryMetadata(
            next,
            { ...character, development: map, chapters },
            controller.signal
          );
          controller.signal.throwIfAborted();
          next.stage = metadata.stage;
          // 本次作者明确修改的关联优先，不能被 AI 加回或替换。
          if (JSON.stringify(next.relatedIds) === JSON.stringify(original.relatedIds))
            next.relatedIds = metadata.relatedIds;
          if (JSON.stringify(next.chapterPaths) === JSON.stringify(original.chapterPaths))
            next.chapterPaths = metadata.chapterPaths;
          setDraft(next);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          metadataWarning = `自动关联未完成：${error instanceof Error ? error.message : '请稍后重试'}。手动修改已保留。`;
        }
        setMetadataPending(false);
      }
      if (!remove && JSON.stringify(next) !== initial) {
        next.events = [
          ...developmentHistory(original, crypto.randomUUID(), new Date().toISOString()),
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            stage: next.stage,
            status: next.status,
            note:
              next.description ||
              (base
                ? `更新「${next.name}」：${statusLabel(original.status)} → ${statusLabel(next.status)}`
                : `添加「${next.name}」`),
            chapter: next.chapter,
            quote: next.quote,
            source: 'manual',
            growthEventId: next.growthEventId,
          },
        ];
      }
      let result: DevelopmentMap;
      if (onDraftSave) {
        const patch = { [draft.id]: remove ? '' : JSON.stringify(next) };
        onDraftSave(patch);
        result = { ...map, ...patch };
      } else {
        result = await window.electron.ipcRenderer.invoke(
          'db-character-patch-development',
          workPath,
          character.id,
          [{ id: draft.id, expected: base, entry: remove ? null : next }]
        );
      }
      setMap(result);
      if (!remove && !editing && !onDraftSave && result[next.id])
        enrichSavedEntry(
          workPath,
          { ...character, development: result, chapters },
          result[next.id]
        );
      setDraft(null);
      if (!remove) {
        if (statusFilter !== 'all') setStatusFilter(developmentDisplayStatus(next.status));
      }
      setConfirmDelete(false);
      setNotice(
        onDraftSave
          ? '已更新草稿，可在上方保存修改'
          : remove
            ? '已删除条目'
            : '已保存条目与变化记录'
      );
      if (metadataWarning) setError(metadataWarning);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      saving.current = false;
      setBusy(false);
      setMetadataPending(false);
      metadataController.current = null;
    }
  };
  const togglePin = (entry: DevelopmentEntry) => {
    setNotice('');
    return pinning.update(entry.id, !entry.pinned);
  };
  const pinnedEntries = entries.filter((entry) => entry.pinned);
  const typedEntries = entries.filter((e) => !e.pinned && (kind === '*' || e.kind === kind));
  const visibleEntries = typedEntries.filter(
    (entry) => statusFilter === 'all' || developmentDisplayStatus(entry.status) === statusFilter
  );
  return (
    <section
      className={styles.root}
      aria-label={
        section === 'identity'
          ? '身份职业条目'
          : section === 'power'
            ? '能力体系条目'
            : '剧情定位条目'
      }
    >
      {section !== 'identity' && (
        <>
          <div className={styles.toolbar}>
            <span className={styles.meta}>{entries.length} 个条目</span>
            <UiButton
              unstyled
              type="button"
              className={styles.button}
              disabled={busy || !workPath || dirty}
              onClick={() => beginEdit()}
            >
              ＋ 添加条目
            </UiButton>
          </div>
        </>
      )}
      {pinnedEntries.length > 0 && (
        <section className={styles.pinnedSection} aria-label="常驻设定">
          <header className={styles.sectionHeading}>
            <LuPin aria-hidden="true" />
            <strong>常驻设定</strong>
            <span>{pinnedEntries.length}</span>
            <small className={styles.sectionHint}>始终显示，不受下方筛选影响</small>
          </header>
          <div className={styles.cards}>
            {pinnedEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                original={originals ? (originalEntry(entry.id) ?? null) : undefined}
                onEdit={() => beginEdit(entry)}
                onTogglePin={() => void togglePin(entry)}
                pinDisabled={busy || !pinning.ready}
              />
            ))}
          </div>
        </section>
      )}
      <div className={styles.filterBar} data-divided={pinnedEntries.length > 0 || undefined}>
        {pinnedEntries.length > 0 && (
          <header className={styles.sectionHeading}>
            <strong>其他条目</strong>
          </header>
        )}
        <div className={styles.filters}>
          <Tabs
            label="条目状态"
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              { id: 'all', label: '全部', badge: typedEntries.length },
              ...DEVELOPMENT_STATUS_OPTIONS.map((item) => ({
                id: item.value,
                label: item.label,
                badge: typedEntries.filter(
                  (entry) => developmentDisplayStatus(entry.status) === item.value
                ).length,
              })),
            ]}
          />
          {section !== 'identity' && (
            <Select
              aria-label="条目类型筛选"
              size="lg"
              value={kind}
              onChange={setKind}
              options={[
                { value: '*', label: '全部类型' },
                ...kinds.map((k) => ({ value: k.id, label: k.label })),
              ]}
            />
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className={styles.meta}>
          {notice}
        </p>
      )}
      {(error || pinning.error) && (
        <p role="alert" className={styles.error}>
          {error || pinning.error}
        </p>
      )}
      {section === 'identity' && (
        <section className={styles.identitySection} aria-label="身份职业">
          <strong>身份职业</strong>
          {(['future', 'active', 'resolved'] as const).map((tone) => {
            const group = visibleEntries.filter(
              (entry) =>
                !entry.pinned && entry.kind === 'identity' && entryTone(entry.status) === tone
            );
            if (!group.length) return null;
            const expanded = expandedGroups.includes(tone);
            const groupLabel = {
              active: '持有',
              future: '计划',
              resolved: '完成',
            }[tone];
            return (
              <div
                key={tone}
                className={styles.identityGroup}
                aria-label={
                  {
                    active: '持有身份',
                    future: '计划身份',
                    resolved: '完成身份',
                  }[tone]
                }
              >
                <span className={styles.groupLabel}>
                  {groupLabel} <small>{group.length}</small>
                </span>
                <div className={styles.identityTags}>
                  {(expanded ? group : group.slice(0, 6)).map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      original={originals ? (originalEntry(entry.id) ?? null) : undefined}
                      compact
                      onEdit={() => beginEdit(entry)}
                      onTogglePin={() => void togglePin(entry)}
                      pinDisabled={busy || !pinning.ready}
                    />
                  ))}
                  {group.length > 6 && (
                    <UiButton
                      unstyled
                      type="button"
                      className={styles.moreTags}
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedGroups((groups) =>
                          expanded ? groups.filter((item) => item !== tone) : [...groups, tone]
                        )
                      }
                    >
                      {expanded ? '收起' : `展开其余 ${group.length - 6} 项`}
                    </UiButton>
                  )}
                </div>
              </div>
            );
          })}
          <div className={styles.identityTags}>
            <UiButton
              unstyled
              type="button"
              className={styles.button}
              disabled={busy || dirty || !workPath}
              onClick={() => beginEdit(undefined, 'identity')}
            >
              ＋ 添加
            </UiButton>
          </div>
        </section>
      )}
      {section === 'plot' &&
        kinds.some((item) => isPsychologyKind(item.id) && (kind === '*' || kind === item.id)) && (
          <section className={styles.psychologySection} aria-label="内心与行为变化">
            <strong>内心与行为变化</strong>
            {kinds
              .filter((item) => isPsychologyKind(item.id) && (kind === '*' || kind === item.id))
              .map((item) => (
                <div key={item.id} className={styles.tagRow}>
                  <span className={styles.meta}>
                    {item.label}{' '}
                    {generationPhase && <GenerationStatus phase={generationPhase} compact />}
                  </span>
                  <div className={styles.identityTags}>
                    {visibleEntries
                      .filter((entry) => !entry.pinned && entry.kind === item.id)
                      .map((entry) => (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          original={originals ? (originalEntry(entry.id) ?? null) : undefined}
                          compact
                          onEdit={() => beginEdit(entry)}
                          onTogglePin={() => void togglePin(entry)}
                          pinDisabled={busy || !pinning.ready}
                        />
                      ))}
                    <UiButton
                      unstyled
                      type="button"
                      className={styles.button}
                      disabled={busy || dirty || !workPath}
                      onClick={() => beginEdit(undefined, item.id)}
                      aria-label={`添加${item.label}`}
                    >
                      ＋ 添加
                    </UiButton>
                  </div>
                </div>
              ))}
          </section>
        )}
      {draft && (
        <div className={styles.editor} aria-label="编辑设定条目">
          <div className={styles.cardHeader}>
            <strong>{editing ? '编辑条目' : '新增条目'}</strong>
            <UiButton
              unstyled
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError('');
              }}
            >
              取消
            </UiButton>
          </div>
          <fieldset disabled={busy} className={styles.fields}>
            <label className={styles.field}>
              <span>{draft.kind === 'identity' ? '身份职业' : '名称'}</span>
              <UiInput
                unstyled
                value={draft.name}
                maxLength={100}
                autoFocus
                placeholder={draft.kind === 'identity' ? '例如：青石镇铁匠学徒' : '条目的简短名称'}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>详细描述</span>
              <DiffTextInput
                aria-label="详细描述"
                disabled={busy}
                baseline={originals ? (originalEntry(draft.id)?.description ?? '') : undefined}
                rows={3}
                maxLength={8000}
                value={draft.description}
                placeholder={
                  draft.kind === 'identity'
                    ? '选填：跟随秦伯学艺，替师父接零活维持生计。'
                    : developmentPlaceholder(draft.kind)
                }
                onChange={(value) => setDraft({ ...draft, description: value })}
              />
            </label>
            {section !== 'identity' && (
              <label className={styles.field}>
                <span>类型</span>
                <Select
                  value={draft.kind}
                  disabled={busy}
                  onChange={(value) => setDraft({ ...draft, kind: value })}
                  options={kinds.map((item) => ({ value: item.id, label: item.label }))}
                />
              </label>
            )}
            <label className={styles.field}>
              <span>状态</span>
              <Select
                value={developmentDisplayStatus(draft.status)}
                disabled={busy}
                onChange={(value) => setDraft({ ...draft, status: value })}
                options={DEVELOPMENT_STATUS_OPTIONS}
              />
            </label>
            {editing && (
              <>
                {metadataPending && <GenerationStatus label="正在整理关联…" />}
                <div className={styles.field}>
                  <span>关联章节</span>
                  <SearchMultiSelect
                    label="关联章节"
                    value={draft.chapterPaths ?? []}
                    options={chapterOptions}
                    disabled={busy}
                    placeholder="AI 自动关联，也可输入搜索章节"
                    emptyText={chapters.length ? '没有匹配的章节' : '暂无可关联的章节'}
                    onChange={(chapterPaths) => setDraft({ ...draft, chapterPaths })}
                  />
                </div>
                <div className={styles.field}>
                  <span>关联条目</span>
                  <SearchMultiSelect
                    label="关联条目"
                    value={draft.relatedIds}
                    options={all
                      .filter((entry) => entry.id !== draft.id)
                      .map((entry) => ({
                        value: entry.id,
                        label: `${kindLabel(entry.kind)} · ${entry.name}`,
                      }))}
                    disabled={busy}
                    placeholder="AI 自动关联，也可输入搜索条目"
                    onChange={(relatedIds) => setDraft({ ...draft, relatedIds })}
                  />
                </div>
              </>
            )}
          </fieldset>
          <div className={styles.toolbar}>
            {editing && (
              <UiButton
                unstyled
                type="button"
                className={styles.button}
                disabled={busy || dirty}
                onClick={onOpenGrowth}
              >
                打开成长档案
              </UiButton>
            )}
            <div className={styles.actions}>
              {(base || draft.id.startsWith('legacy:')) && (
                <UiButton
                  unstyled
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => (confirmDelete ? void save(true) : setConfirmDelete(true))}
                >
                  {confirmDelete ? '确认删除此条目' : '删除'}
                </UiButton>
              )}
              <UiButton
                unstyled
                type="button"
                className={styles.primary}
                disabled={busy || !workPath}
                onClick={() => void save()}
              >
                {metadataPending
                  ? '正在整理关联…'
                  : busy
                    ? '保存中…'
                    : onDraftSave
                      ? '更新草稿'
                      : '保存条目'}
              </UiButton>
            </div>
          </div>
          {draft.events.length > 0 && (
            <DevelopmentHistory
              key={draft.id}
              events={draft.events}
              disabled={busy}
              chapters={chapters}
              onOpenChapter={onOpenChapter}
              onUseDescription={(description) => {
                setDraft({ ...draft, description });
                setNotice('已填入详细描述，可继续修改后保存。');
              }}
            />
          )}
        </div>
      )}
      <div className={styles.cards}>
        {visibleEntries
          .filter((e) => !e.pinned && !isTagDevelopmentKind(e.kind))
          .map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              original={originals ? (originalEntry(e.id) ?? null) : undefined}
              onEdit={() => beginEdit(e)}
              onTogglePin={() => void togglePin(e)}
              pinDisabled={busy || !pinning.ready}
            />
          ))}
      </div>
      {visibleEntries.length === 0 && (
        <p className={styles.meta}>
          {statusFilter !== 'all'
            ? '该分类下暂无此状态的其他条目。'
            : pinnedEntries.length > 0
              ? '其余条目为空，可添加新的设定。'
              : '此分类还没有条目。可手动添加，也可在正文工具栏使用「设定同步」识别。'}
        </p>
      )}
    </section>
  );
}
