import React, { useState, useCallback, useEffect } from 'react';
import styles from './styles.module.scss';
import type { LoreEntry } from './types';
import { createLoreStorageKey } from './utils';
import { useAiConfig } from './useAiConfig';

type WorkflowKey = 'consistency' | 'lore' | 'characters' | 'plot';

const WORKFLOW_DEFS: Record<WorkflowKey, { title: string; prompt: string; desc: string }> = {
  consistency: {
    title: '一致性诊断',
    prompt: '检查当前作品中可能存在的世界观、称谓、时间线或规则冲突，并按问题清单输出。',
    desc: '世界观 · 称谓 · 时间线 · 规则冲突',
  },
  lore: {
    title: '设定补全',
    prompt: '基于已有设定集，补充缺失的势力、等级、地理、术语结构，并给出建议条目。',
    desc: '势力 · 等级 · 地理 · 术语补全',
  },
  characters: {
    title: '人物诊断',
    prompt: '根据人物资料和正文片段，指出人物弧光、关系张力和出场分配的薄弱点。',
    desc: '角色弧光 · 关系张力 · 出场分配',
  },
  plot: {
    title: '情节漏洞',
    prompt: '分析当前情节结构，指出伏笔未回收、因果断裂、节奏失衡或转折不足之处。',
    desc: '伏笔回收 · 因果链 · 节奏分析',
  },
};

const WORKFLOW_KEYS = Object.keys(WORKFLOW_DEFS) as WorkflowKey[];

const SETUP_STEPS = [
  { step: 1, title: '打开设置中心', desc: '点击下方按钮，进入「AI」配置页面' },
  { step: 2, title: '选择服务商', desc: '支持 OpenAI、DeepSeek、OpenRouter 等兼容接口' },
  { step: 3, title: '填写 API Key', desc: '从服务商后台获取密钥，粘贴即可' },
];

export const AIView: React.FC<{
  folderPath: string | null;
  content: string;
  onOpenSettings?: () => void;
}> = React.memo(({ folderPath, content, onOpenSettings }) => {
  const aiConfig = useAiConfig();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowKey>('consistency');
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

  const runAI = useCallback(
    async (presetPrompt?: string) => {
      const finalPrompt = (presetPrompt || prompt).trim();
      if (!finalPrompt) return;
      setLoading(true);
      setResult('');
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
              .map((row) => `${row.name}(${row.role || '未设定'}): ${row.description || '无描述'}`)
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
        setResult(response.ok ? response.text || 'AI 未返回内容' : response.error || 'AI 请求失败');
      } catch (error) {
        setResult(error instanceof Error ? error.message : 'AI 请求异常');
      } finally {
        setLoading(false);
      }
    },
    [prompt, folderPath, content]
  );

  // ─── 配置加载中 ───
  if (!aiConfig.loaded) {
    return null;
  }

  // ─── AI 未配置：显示引导 ───
  if (!aiConfig.ready) {
    return (
      <div className={styles.aiSetupGuide}>
        <div className={styles.aiSetupIcon}>AI</div>
        <div className={styles.aiSetupTitle}>开启 AI 写作助手</div>
        <div className={styles.aiSetupDesc}>
          配置 API Key 后，即可使用一致性诊断、设定补全、人物诊断、情节分析等 AI 辅助功能。
        </div>
        <div className={styles.aiSetupSteps}>
          {SETUP_STEPS.map((item) => (
            <div key={item.step} className={styles.aiSetupStep}>
              <span className={styles.aiSetupStepNum}>{item.step}</span>
              <div>
                <div className={styles.aiSetupStepTitle}>{item.title}</div>
                <div className={styles.aiSetupStepDesc}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
        {onOpenSettings && (
          <button className={styles.aiSetupButton} onClick={onOpenSettings}>
            前往设置
          </button>
        )}
      </div>
    );
  }

  // ─── AI 已配置：写作工作台 ───
  const contentLen = content.length;
  const contentLabel =
    contentLen >= 10000
      ? `${(contentLen / 10000).toFixed(1)} 万字`
      : `${Math.max(1, Math.ceil(contentLen / 1000))}k 字`;

  return (
    <div className={styles.aiWorkbench}>
      {/* 上下文概览 */}
      <div className={styles.aiContextBar}>
        <span className={styles.aiContextChip}>正文 {contentLabel}</span>
        <span className={styles.aiContextChip}>人物 {contextCounts.characters}</span>
        <span className={styles.aiContextChip}>设定 {contextCounts.lore}</span>
      </div>

      {/* 工作流选择 */}
      <div className={styles.aiWorkflowBar}>
        {WORKFLOW_KEYS.map((key) => (
          <button
            key={key}
            className={`${styles.aiWorkflowChip} ${workflow === key ? styles.aiWorkflowChipActive : ''}`}
            onClick={() => {
              setWorkflow(key);
              setPrompt(WORKFLOW_DEFS[key].prompt);
            }}
          >
            {WORKFLOW_DEFS[key].title}
          </button>
        ))}
      </div>

      {/* 当前工作流提示 */}
      <div className={styles.aiWorkflowHint}>{WORKFLOW_DEFS[workflow].desc}</div>

      {/* 输入区 */}
      <textarea
        className={styles.aiPromptInput}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="输入自定义指令，或点击上方工作流自动填充..."
      />

      {/* 操作栏 */}
      <div className={styles.aiActionBar}>
        <button
          className={styles.aiRunButton}
          onClick={() => runAI()}
          disabled={loading || !prompt.trim()}
        >
          {loading ? '分析中...' : '发送'}
        </button>
        {!aiConfig.ready && onOpenSettings && (
          <button className={styles.aiSettingsLink} onClick={onOpenSettings}>
            配置 AI
          </button>
        )}
      </div>

      {/* 结果区 */}
      {(result || loading) && (
        <div className={styles.aiResultBox}>
          {loading ? <span className={styles.aiResultLoading}>正在分析...</span> : result}
        </div>
      )}
    </div>
  );
});
