import React, { useState, useCallback, useEffect } from 'react';
import styles from './styles.module.scss';
import type { LoreEntry, LoreCategory } from './types';
import { LORE_CATEGORY_LABELS } from './constants';
import { createLoreStorageKey } from './utils';
import { VerticalSplit } from './VerticalSplit';

export const LoreView: React.FC<{ folderPath: string | null; content: string }> = React.memo(
  ({ folderPath, content }) => {
    const [entries, setEntries] = useState<LoreEntry[]>([]);
    const [category, setCategory] = useState<LoreCategory>('world');
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditResult, setAuditResult] = useState('');

    useEffect(() => {
      const load = async () => {
        const key = createLoreStorageKey(folderPath);
        const ipc = window.electron?.ipcRenderer;
        if (!key || !ipc) {
          setEntries([]);
          return;
        }
        try {
          const raw = await ipc.invoke('db-settings-get', key);
          if (!raw) {
            setEntries([]);
            return;
          }
          setEntries(JSON.parse(raw as string) as LoreEntry[]);
        } catch {
          setEntries([]);
        }
      };
      load();
    }, [folderPath]);

    const persistEntries = useCallback(
      async (nextEntries: LoreEntry[]) => {
        const key = createLoreStorageKey(folderPath);
        const ipc = window.electron?.ipcRenderer;
        if (!key || !ipc) return;
        await ipc.invoke('db-settings-set', key, JSON.stringify(nextEntries));
      },
      [folderPath]
    );

    const handleAdd = useCallback(async () => {
      const nextTitle = title.trim();
      const nextSummary = summary.trim();
      if (!nextTitle) return;
      const nextEntry: LoreEntry = {
        id: `${Date.now()}`,
        title: nextTitle,
        summary: nextSummary,
        category,
      };
      const nextEntries = [nextEntry, ...entries];
      setEntries(nextEntries);
      setTitle('');
      setSummary('');
      await persistEntries(nextEntries);
    }, [title, summary, category, entries, persistEntries]);

    const filteredEntries = entries.filter((entry) => entry.category === category);
    const categoryCounts = (Object.keys(LORE_CATEGORY_LABELS) as LoreCategory[]).reduce(
      (result, item) => ({
        ...result,
        [item]: entries.filter((entry) => entry.category === item).length,
      }),
      {} as Record<LoreCategory, number>
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
          <input
            className={styles.formInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`新增${LORE_CATEGORY_LABELS[category]}条目标题`}
          />
          <textarea
            className={styles.formTextarea}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="记录规则、背景、约束、历史脉络、关键词等"
          />
          <button className={styles.submitButton} onClick={handleAdd}>
            添加条目
          </button>
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
        <div className={styles.loreList}>
          {filteredEntries.length === 0 ? (
            <div className={styles.emptyHint}>
              当前分类暂无条目
              <br />
              <span className={styles.hintSub}>建议先把世界规则、势力、等级体系结构化沉淀下来</span>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div key={entry.id} className={styles.loreEntryCard}>
                <div className={styles.loreEntryHeader}>
                  <span className={styles.loreEntryTitle}>{entry.title}</span>
                  <span className={styles.loreEntryTag}>
                    {LORE_CATEGORY_LABELS[entry.category]}
                  </span>
                </div>
                <div className={styles.loreEntrySummary}>{entry.summary || '暂无详细说明'}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );

    return <VerticalSplit top={topView} bottom={bottomView} initialTopHeight={270} />;
  }
);
