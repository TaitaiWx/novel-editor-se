import React, { useState, useCallback, useEffect } from 'react';
import styles from './styles.module.scss';
import type { LoreEntry } from './types';
import { createLoreStorageKey } from './utils';
import { VerticalSplit } from './VerticalSplit';

export const AIView: React.FC<{ folderPath: string | null; content: string }> = React.memo(
  ({ folderPath, content }) => {
    const [prompt, setPrompt] = useState('');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [workflow, setWorkflow] = useState<'consistency' | 'lore' | 'characters' | 'plot'>(
      'consistency'
    );
    const [contextCounts, setContextCounts] = useState({ lore: 0, characters: 0 });

    useEffect(() => {
      const loadContextCounts = async () => {
        const ipc = window.electron?.ipcRenderer;
        if (!ipc || !folderPath) {
          setContextCounts({ lore: 0, characters: 0 });
          return;
        }
        const loreKey = createLoreStorageKey(folderPath);
        const loreRaw = loreKey ? await ipc.invoke('db-settings-get', loreKey) : null;
        const loreEntries = loreRaw ? (JSON.parse(loreRaw as string) as LoreEntry[]) : [];
        const novel = (await ipc.invoke('db-novel-get-by-folder', folderPath)) as {
          id: number;
        } | null;
        const characters = novel
          ? ((await ipc.invoke('db-character-list', novel.id)) as Array<{ id: number }>)
          : [];
        setContextCounts({ lore: loreEntries.length, characters: characters.length });
      };
      void loadContextCounts();
    }, [folderPath]);

    const workflowPrompts: Record<
      typeof workflow,
      { title: string; prompt: string; desc: string }
    > = {
      consistency: {
        title: '一致性诊断',
        prompt: '检查当前作品中可能存在的世界观、称谓、时间线或规则冲突，并按问题清单输出。',
        desc: '查找世界观、称谓、时间线、能力规则前后冲突。',
      },
      lore: {
        title: '设定补全',
        prompt: '基于已有设定集，补充缺失的势力、等级、地理、术语结构，并给出建议条目。',
        desc: '根据设定集补足势力、等级、地理、术语说明。',
      },
      characters: {
        title: '人物诊断',
        prompt: '根据人物资料和正文片段，指出人物弧光、关系张力和出场分配的薄弱点。',
        desc: '识别主次角色失衡、关系张力不足与角色功能重叠。',
      },
      plot: {
        title: '情节漏洞提示',
        prompt: '分析当前情节结构，指出伏笔未回收、因果断裂、节奏失衡或转折不足之处。',
        desc: '识别伏笔未回收、因果断裂、节奏失衡等问题。',
      },
    };

    const runAI = useCallback(
      async (presetPrompt?: string) => {
        const finalPrompt = (presetPrompt || prompt).trim();
        if (!finalPrompt) return;
        setLoading(true);
        setStatusText('AI 正在分析项目结构...');
        try {
          const ipc = window.electron?.ipcRenderer;
          if (!ipc) return;
          const loreKey = createLoreStorageKey(folderPath);
          const loreRaw = loreKey ? await ipc.invoke('db-settings-get', loreKey) : null;
          const loreEntries = loreRaw ? (JSON.parse(loreRaw as string) as LoreEntry[]) : [];
          let charactersContext = '';
          if (folderPath) {
            const novel = (await ipc.invoke('db-novel-get-by-folder', folderPath)) as {
              id: number;
            } | null;
            if (novel) {
              const rows = (await ipc.invoke('db-character-list', novel.id)) as Array<{
                name: string;
                role: string;
                description: string;
              }>;
              charactersContext = rows
                .map(
                  (row) => `${row.name}(${row.role || '未设定'}): ${row.description || '无描述'}`
                )
                .join('\n');
            }
          }
          const context = [
            content ? `正文片段:\n${content.slice(0, 2000)}` : '',
            loreEntries.length > 0
              ? `设定集:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
              : '',
            charactersContext ? `人物资料:\n${charactersContext}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          const response = (await ipc.invoke('ai-request', {
            prompt: finalPrompt,
            systemPrompt:
              '你是小说策划与写作辅助系统。请基于给定正文、设定和人物资料，输出结构化、可执行的建议。',
            context,
          })) as { ok: boolean; text?: string; error?: string };
          setResult(
            response.ok ? response.text || 'AI 未返回内容' : response.error || 'AI 请求失败'
          );
        } catch (error) {
          setResult(error instanceof Error ? error.message : 'AI 请求异常');
        } finally {
          setLoading(false);
          setStatusText('');
        }
      },
      [prompt, folderPath, content]
    );

    const actionGrid = (
      <>
        <div className={styles.aiTitle}>AI 写作工作台</div>
        <div className={styles.aiSubTitle}>
          {folderPath
            ? '围绕正文、人物、设定、情节进行分工式诊断与建议'
            : '打开项目后启用 AI 结构化能力'}
        </div>
        <div className={styles.metricRow}>
          <span className={styles.metricChip}>
            正文 {Math.max(1, Math.ceil(content.length / 1000))}k 字符
          </span>
          <span className={styles.metricChip}>人物 {contextCounts.characters}</span>
          <span className={styles.metricChip}>设定 {contextCounts.lore}</span>
        </div>
        <div className={styles.aiActionGrid}>
          {(Object.keys(workflowPrompts) as Array<keyof typeof workflowPrompts>).map((key) => (
            <button
              key={key}
              className={`${styles.aiActionCard} ${workflow === key ? styles.aiActionCardActive : ''}`}
              onClick={() => {
                setWorkflow(key);
                setPrompt(workflowPrompts[key].prompt);
              }}
            >
              <div className={styles.aiActionTitle}>{workflowPrompts[key].title}</div>
              <div className={styles.aiActionDesc}>{workflowPrompts[key].desc}</div>
            </button>
          ))}
        </div>
        <div className={styles.aiWorkflowSummary}>
          <div className={styles.aiWorkflowTitle}>{workflowPrompts[workflow].title}</div>
          <div className={styles.aiWorkflowText}>{workflowPrompts[workflow].prompt}</div>
        </div>
      </>
    );

    const assistantView = (
      <div className={styles.aiAssistantPanel}>
        <div className={styles.aiAssistantHeader}>AI 助手</div>
        <textarea
          className={styles.aiPromptInput}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="例如：请基于当前设定集检查本章是否有逻辑冲突，并给出修正建议"
        />
        <div className={styles.aiActionBar}>
          <button className={styles.submitButton} onClick={() => runAI()} disabled={loading}>
            {loading ? '分析中...' : '发送给 AI'}
          </button>
          {statusText && <span className={styles.aiStatus}>{statusText}</span>}
        </div>
        <div className={styles.aiResultPanel}>{result ? result : 'AI 返回结果会显示在这里。'}</div>
      </div>
    );

    return <VerticalSplit top={actionGrid} bottom={assistantView} initialTopHeight={220} />;
  }
);
