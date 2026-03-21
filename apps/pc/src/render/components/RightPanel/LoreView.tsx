import React, { useState, useCallback, useMemo } from 'react';
import styles from './styles.module.scss';
import type { LoreEntry, LoreCategory } from './types';
import { LORE_CATEGORY_LABELS } from './constants';
import { VerticalSplit } from './VerticalSplit';
import { useLoreEntries } from './useLoreEntries';
import { parseLoreDraftsFromImport } from './lore-import';

export const LoreView: React.FC<{ folderPath: string | null; content: string }> = React.memo(
  ({ folderPath, content }) => {
    const [category, setCategory] = useState<LoreCategory>('world');
    const [query, setQuery] = useState('');
    const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditResult, setAuditResult] = useState('');
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
            content ? `正文抽样:\n${content.slice(0, 2200)}` : '',
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
    }, [content, entries]);

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
            <button className={styles.addButton} onClick={runLoreAudit} disabled={auditLoading}>
              {auditLoading ? '诊断中...' : '诊断设定缺口'}
            </button>
          </div>
          <div className={styles.loreReferenceText}>
            设定集不只是资料箱，它会被人物生成、情节诊断、一致性检查直接引用。
          </div>
          <div className={styles.aiInlineResult}>
            {auditResult || '可以先让 AI 检查设定缺口与潜在冲突。'}
          </div>
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

    return <VerticalSplit top={topView} bottom={bottomView} initialTopHeight={310} />;
  }
);
