import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import styles from './styles.module.scss';
import type { LoreEntry, LoreCategory } from './types';
import { LORE_CATEGORY_LABELS } from './constants';
import { parseLoreAuditSections, parseLoreDraftFromAuditItem } from './lore-data';
import { useLoreEntries } from './useLoreEntries';
import { parseLoreDraftsFromImport } from './lore-import';

export const LoreView: React.FC<{
  folderPath: string | null;
  content: string;
  initialEntryId?: number | null;
  onEntriesChange?: (entries: LoreEntry[]) => void;
}> = React.memo(
  ({ folderPath, content, initialEntryId = null, onEntriesChange }) => {
    const contentRef = useRef(content);
    contentRef.current = content;
    const [category, setCategory] = useState<LoreCategory>('world');
    const [query, setQuery] = useState('');
    const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditResult, setAuditResult] = useState('');
    const [copiedAuditKey, setCopiedAuditKey] = useState<string | null>(null);
    const [importResult, setImportResult] = useState('');
    const { entries, loading, createEntry, updateEntry, deleteEntry, importEntries } =
      useLoreEntries(folderPath);

    const clearComposer = useCallback(() => {
      setEditingEntryId(null);
      setTitle('');
      setSummary('');
    }, []);

    const handleSave = useCallback(async () => {
      const nextTitle = title.trim();
      const nextSummary = summary.trim();
      if (!nextTitle) return;

      if (editingEntryId !== null) {
        await updateEntry(editingEntryId, {
          category,
          title: nextTitle,
          summary: nextSummary,
        });
      } else {
        await createEntry({
          category,
          title: nextTitle,
          summary: nextSummary,
        });
      }

      clearComposer();
      setImportResult('');
    }, [title, summary, category, editingEntryId, updateEntry, createEntry, clearComposer]);

    const handleStartEdit = useCallback((entry: LoreEntry) => {
      setEditingEntryId(entry.id);
      setCategory(entry.category);
      setTitle(entry.title);
      setSummary(entry.summary);
      setImportResult('');
    }, []);

    const handleDelete = useCallback(
      async (entry: LoreEntry) => {
        await deleteEntry(entry.id);
        if (editingEntryId === entry.id) {
          clearComposer();
        }
      },
      [deleteEntry, editingEntryId, clearComposer]
    );

    const handleImport = useCallback(async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const result = (await ipc.invoke('import-structured-file')) as {
        previews: Array<{ fileName: string; content: string; sourcePath: string }>;
        errors: Array<{ filePath: string; error: string }>;
      } | null;
      if (!result) return;

      const drafts = result.previews.flatMap((preview) =>
        parseLoreDraftsFromImport(preview.content, preview.fileName, category)
      );
      const summaryResult = await importEntries(drafts);
      const errorText = result.errors.length > 0 ? `，${result.errors.length} 个文件失败` : '';
      setImportResult(
        `已导入 ${summaryResult.imported} 条，跳过 ${summaryResult.skipped} 条${errorText}`
      );
    }, [category, importEntries]);

    const filteredEntries = useMemo(
      () =>
        entries
          .filter((entry) => entry.category === category)
          .filter((entry) => {
            const keyword = query.trim().toLowerCase();
            if (!keyword) return true;
            return `${entry.title} ${entry.summary}`.toLowerCase().includes(keyword);
          }),
      [entries, category, query]
    );

    const categoryCounts = useMemo(
      () =>
        (Object.keys(LORE_CATEGORY_LABELS) as LoreCategory[]).reduce(
          (result, item) => ({
            ...result,
            [item]: entries.filter((entry) => entry.category === item).length,
          }),
          {} as Record<LoreCategory, number>
        ),
      [entries]
    );

    useEffect(() => {
      if (loading) return;
      onEntriesChange?.(entries);
    }, [entries, loading, onEntriesChange]);

    useEffect(() => {
      if (!initialEntryId) return;
      const target = entries.find((entry) => entry.id === initialEntryId);
      if (!target) return;
      setEditingEntryId(target.id);
      setCategory(target.category);
      setTitle(target.title);
      setSummary(target.summary);
    }, [entries, initialEntryId]);

    const auditSections = useMemo(() => parseLoreAuditSections(auditResult), [auditResult]);
    const detailMode = initialEntryId !== null;
    const focusedEntry =
      entries.find((entry) => entry.id === editingEntryId) ||
      entries.find((entry) => entry.id === initialEntryId) ||
      null;

    const handleCopyAuditText = useCallback((key: string, text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      void navigator.clipboard.writeText(normalized).then(() => {
        setCopiedAuditKey(key);
        window.setTimeout(() => {
          setCopiedAuditKey((current) => (current === key ? null : current));
        }, 1600);
      });
    }, []);

    const handleApplyAuditTemplate = useCallback(
      (item: string) => {
        const draft = parseLoreDraftFromAuditItem(item, category);
        if (!draft) return;
        setEditingEntryId(null);
        setCategory(draft.category);
        setTitle(draft.title);
        setSummary(draft.summary);
        setImportResult('已写入草稿区，可继续补充后保存');
      },
      [category]
    );

    const runLoreAudit = useCallback(async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || entries.length === 0) {
        setAuditResult('先积累一些设定条目，再做 AI 诊断。');
        return;
      }
      setAuditLoading(true);
      setAuditResult('AI 正在检查设定缺口与可引用性...');
      try {
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请分析当前设定集是否足够支撑写作与 AI 引用。输出三部分：1) 缺失设定 2) 可能冲突 3) 建议补充的条目模板。要求中文、结构清晰、可直接执行。',
          systemPrompt: '你是小说世界观设计顾问，需要识别设定缺口、冲突和复用机会。',
          context: [
            `设定集:\n${entries.map((item) => `[${LORE_CATEGORY_LABELS[item.category]}] ${item.title}: ${item.summary}`).join('\n')}`,
            contentRef.current ? `正文抽样:\n${contentRef.current.slice(0, 2200)}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        })) as { ok: boolean; text?: string; error?: string };
        setAuditResult(
          response.ok ? response.text || 'AI 未返回诊断结果' : response.error || 'AI 请求失败'
        );
      } catch (error) {
        setAuditResult(error instanceof Error ? error.message : '设定诊断失败');
      } finally {
        setAuditLoading(false);
      }
    }, [entries]);

    if (!folderPath) {
      return <div className={styles.emptyHint}>打开项目后管理设定集</div>;
    }

    const topView = (
      <div className={styles.loreView}>
        <div className={styles.sectionHeader}>
          <span>设定中枢</span>
          <span className={styles.sectionSubtle}>AI 会默认把这里当作长期引用池</span>
        </div>
        <div className={styles.loreSummaryGrid}>
          {(Object.keys(LORE_CATEGORY_LABELS) as LoreCategory[]).map((item) => (
            <button
              key={item}
              className={`${styles.loreSummaryCard} ${category === item ? styles.loreSummaryCardActive : ''}`}
              onClick={() => setCategory(item)}
            >
              <span className={styles.loreSummaryLabel}>{LORE_CATEGORY_LABELS[item]}</span>
              <span className={styles.loreSummaryValue}>{categoryCounts[item]}</span>
            </button>
          ))}
        </div>
        <div className={styles.lorePanelCard}>
          <div className={styles.sectionHeader}>
            <span>{LORE_CATEGORY_LABELS[category]}</span>
            <span className={styles.sectionSubtle}>写进这里，后续 AI 诊断和建议都会引用</span>
          </div>
          <div className={styles.loreActionRow}>
            <button className={styles.addButton} onClick={handleImport}>
              导入设定 / 大纲
            </button>
            {editingEntryId !== null && (
              <button className={styles.deleteInlineButton} onClick={clearComposer}>
                取消编辑
              </button>
            )}
          </div>
          <input
            className={styles.formInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`${editingEntryId !== null ? '编辑' : '新增'}${LORE_CATEGORY_LABELS[category]}条目标题`}
          />
          <textarea
            className={styles.formTextarea}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="记录规则、背景、约束、历史脉络、关键词等"
          />
          <button className={styles.submitButton} onClick={handleSave}>
            {editingEntryId !== null ? '保存修改' : '添加条目'}
          </button>
          {importResult && <div className={styles.loreImportResult}>{importResult}</div>}
        </div>
      </div>
    );

    const bottomView = (
      <div className={styles.loreWorkbench}>
        <div className={styles.loreReferenceCard}>
          <div className={styles.loreReferenceHeader}>
            <span>AI 引用与诊断</span>
            <div className={styles.loreAuditToolbar}>
              {auditResult && (
                <button
                  className={styles.deleteInlineButton}
                  onClick={() => handleCopyAuditText('all', auditResult)}
                >
                  {copiedAuditKey === 'all' ? '已复制全部' : '复制全部'}
                </button>
              )}
              <button className={styles.addButton} onClick={runLoreAudit} disabled={auditLoading}>
                {auditLoading ? '诊断中...' : '诊断设定缺口'}
              </button>
            </div>
          </div>
          <div className={styles.loreReferenceText}>
            设定集不只是资料箱，它会被人物生成、情节诊断、一致性检查直接引用。
          </div>
          {auditSections.length > 0 ? (
            <div className={styles.loreAuditSections}>
              {auditSections.map((section) => (
                <div key={section.key} className={styles.loreAuditSectionCard}>
                  <div className={styles.loreAuditSectionHeader}>
                    <span>{section.title}</span>
                    <button
                      className={styles.deleteInlineButton}
                      onClick={() => handleCopyAuditText(section.key, section.body)}
                    >
                      {copiedAuditKey === section.key ? '已复制' : '复制本段'}
                    </button>
                  </div>
                  {section.items.length > 0 ? (
                    <div className={styles.loreAuditSectionItems}>
                      {section.items.map((item, index) => {
                        const itemKey = `${section.key}-${index}`;
                        return (
                          <div key={itemKey} className={styles.loreAuditSectionItem}>
                            <span>{item}</span>
                            <div className={styles.inlineActions}>
                              {section.key === 'template' && (
                                <button
                                  className={styles.deleteInlineButton}
                                  onClick={() => handleApplyAuditTemplate(item)}
                                >
                                  写入草稿
                                </button>
                              )}
                              <button
                                className={styles.deleteInlineButton}
                                onClick={() => handleCopyAuditText(itemKey, item)}
                              >
                                {copiedAuditKey === itemKey ? '已复制' : '复制'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.aiInlineResult}>{section.body}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.aiInlineResult}>
              {auditResult || '可以先让 AI 检查设定缺口与潜在冲突。'}
            </div>
          )}
        </div>
        <div className={styles.loreCategoryTabs}>
          {(Object.keys(LORE_CATEGORY_LABELS) as LoreCategory[]).map((item) => (
            <button
              key={item}
              className={`${styles.loreCategoryButton} ${category === item ? styles.loreCategoryActive : ''}`}
              onClick={() => setCategory(item)}
            >
              {LORE_CATEGORY_LABELS[item]}
            </button>
          ))}
        </div>
        <input
          className={styles.formInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`搜索${LORE_CATEGORY_LABELS[category]}条目标题或内容`}
        />
        <div className={styles.loreList}>
          {loading ? (
            <div className={styles.emptyHint}>正在加载设定条目...</div>
          ) : filteredEntries.length === 0 ? (
            <div className={styles.emptyHint}>
              {query.trim() ? '没有匹配的条目' : '当前分类暂无条目'}
              <br />
              <span className={styles.hintSub}>建议先把世界规则、势力、等级体系结构化沉淀下来</span>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className={`${styles.loreEntryCard} ${editingEntryId === entry.id ? styles.loreEntryCardActive : ''}`}
                onClick={() => handleStartEdit(entry)}
              >
                <div className={styles.loreEntryHeader}>
                  <span className={styles.loreEntryTitle}>{entry.title}</span>
                  <div className={styles.inlineActions}>
                    <span className={styles.loreEntryTag}>
                      {LORE_CATEGORY_LABELS[entry.category]}
                    </span>
                    <button
                      className={styles.deleteInlineButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleStartEdit(entry);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className={styles.deleteInlineButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(entry);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className={styles.loreEntrySummary}>{entry.summary || '暂无详细说明'}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );

    if (detailMode) {
      const siblingEntries = focusedEntry
        ? entries
            .filter(
              (entry) => entry.category === focusedEntry.category && entry.id !== focusedEntry.id
            )
            .slice(0, 8)
        : [];

      return (
        <div className={styles.objectWorkspace}>
          {focusedEntry ? (
            <>
              <section className={styles.workspaceHero}>
                <div className={styles.workspaceEyebrow}>设定资料</div>
                <h2 className={styles.workspaceTitle}>{focusedEntry.title}</h2>
                <p className={styles.workspaceDesc}>
                  {focusedEntry.summary || '这个设定条目还没有详细说明。'}
                </p>
                <div className={styles.workspaceMetaRow}>
                  <span className={styles.workspaceChip}>
                    分类 {LORE_CATEGORY_LABELS[focusedEntry.category]}
                  </span>
                  <span className={styles.workspaceChip}>
                    更新时间 {new Date(focusedEntry.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </section>

              <div className={styles.workspaceGrid}>
                <section className={styles.workspaceCardShell}>
                  <div className={styles.workspaceCardHeader}>
                    <span className={styles.workspaceSectionTitle}>编辑条目</span>
                    <span className={styles.workspaceListHint}>直接维护当前设定</span>
                  </div>
                  <input
                    className={styles.formInput}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="设定条目标题"
                  />
                  <textarea
                    className={styles.formTextarea}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    rows={8}
                    placeholder="记录规则、背景、约束、历史脉络、关键词等"
                  />
                  <div className={styles.inlineActions}>
                    <button className={styles.submitButton} onClick={handleSave}>
                      保存修改
                    </button>
                    <button
                      className={styles.deleteInlineButton}
                      onClick={() => void handleDelete(focusedEntry)}
                    >
                      删除条目
                    </button>
                  </div>
                </section>

                <section className={styles.workspaceCardShell}>
                  <div className={styles.workspaceCardHeader}>
                    <span className={styles.workspaceSectionTitle}>同类设定</span>
                    <span className={styles.workspaceListHint}>
                      {LORE_CATEGORY_LABELS[focusedEntry.category]}中的其他条目
                    </span>
                  </div>
                  {siblingEntries.length > 0 ? (
                    <div className={styles.workspaceList}>
                      {siblingEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className={styles.workspaceListButton}
                          onClick={() => handleStartEdit(entry)}
                        >
                          <div className={styles.workspaceListTitle}>{entry.title}</div>
                          <div className={styles.workspaceListDesc}>
                            {entry.summary || '暂无说明'}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.emptyHint}>这个分类里暂时没有其他条目。</div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className={styles.emptyHint}>没有找到对应设定，可能已经被删除。</div>
          )}
        </div>
      );
    }

    return (
      <div className={styles.objectWorkspace}>
        <section className={styles.workspaceHero}>
          <div className={styles.workspaceEyebrow}>设定中枢</div>
          <h2 className={styles.workspaceTitle}>设定与规则</h2>
          <p className={styles.workspaceDesc}>
            这里负责整理世界观、规则、地点和势力，让章节、人物和 AI 都能引用同一套设定基础。
          </p>
          <div className={styles.workspaceMetaRow}>
            <span className={styles.workspaceChip}>条目 {entries.length}</span>
            <span className={styles.workspaceChip}>当前分类 {LORE_CATEGORY_LABELS[category]}</span>
            <span className={styles.workspaceChip}>检索结果 {filteredEntries.length}</span>
          </div>
        </section>
        <div className={styles.workspaceWideGrid}>
          <section className={styles.workspaceCardShell}>{topView}</section>
          <section className={styles.workspaceCardShell}>{bottomView}</section>
        </div>
      </div>
    );
  },
  (prev, next) => prev.folderPath === next.folderPath && prev.initialEntryId === next.initialEntryId
);
