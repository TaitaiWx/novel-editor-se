import { useState, useCallback, useEffect, useRef } from 'react';
import type { LoreEntry } from './types';
import { createLoreStorageKey } from './utils';
import type { HistoryRecord } from './useAiHistory';
import { preciseReplaceWithReport, formatPreciseReplaceReport } from '../../utils/preciseReplace';
import { isLargeText } from '../../utils/chapterSplitter';
import { getOrBuildIndex, hybridRetrieve } from '../../utils/contentRetriever';

type WorkflowKey = 'consistency' | 'lore' | 'characters' | 'plot';

// ─── JSON schema for AI structured output ──────────────────────────────────
export interface AIResultItem {
  title: string;
  type?: string;
  severity?: string;
  description: string;
  impact?: string;
  suggestion?: string;
}

interface AIResultJSON {
  summary?: string;
  items: AIResultItem[];
  conclusion?: string;
}

const JSON_SYSTEM_PROMPT = `你是小说策划与写作辅助系统。请基于给定正文、设定和人物资料进行分析。
你必须以 JSON 格式输出结果，严格遵守以下 schema：
{
  "summary": "一句话概述分析结论",
  "items": [
    {
      "title": "问题/建议标题",
      "type": "issue | suggestion | warning",
      "severity": "high | medium | low",
      "description": "详细描述",
      "impact": "影响范围",
      "suggestion": "具体建议"
    }
  ],
  "conclusion": "总结与后续步骤建议"
}
只输出合法 JSON，不要输出任何多余文字、markdown 标记或代码块标记。`;

const JSON_PROMPT_SUFFIX = '\n\n请严格以上述 JSON schema 输出结果。';

// ─── Fix result structure ───────────────────────────────────────────────────
export interface FixResult {
  text: string; // display text
  original?: string; // original text snippet to find in source
  modified?: string; // replacement text
  applied?: boolean; // whether the fix has been applied
}

export function tryParseJSON(text: string): AIResultJSON | null {
  try {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    const parsed = JSON.parse(cleaned) as AIResultJSON;
    if (parsed && Array.isArray(parsed.items)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export const SEVERITY_LABELS: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'aiSeverityHigh' },
  medium: { label: '中', cls: 'aiSeverityMedium' },
  low: { label: '低', cls: 'aiSeverityLow' },
};

export const TYPE_LABELS: Record<string, string> = {
  issue: '问题',
  suggestion: '建议',
  warning: '警告',
};

export const WORKFLOW_DEFS: Record<WorkflowKey, { title: string; prompt: string; desc: string }> = {
  consistency: {
    title: '一致性诊断',
    prompt: '检查当前作品中可能存在的世界观、称谓、时间线或规则冲突，并按问题清单输出。',
    desc: '世界观 · 称谓 · 时间线 · 规则冲突',
  },
  lore: {
    title: '设定补全',
    prompt:
      '基于已有设定集和正文内容，补充缺失的势力、等级、地理、术语结构，并给出建议条目。请先自动导入并分析正文中出现的大纲和设定信息，然后给出补全建议。',
    desc: '自动导入分析 · 势力 · 等级 · 地理 · 术语补全',
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

export const WORKFLOW_KEYS = Object.keys(WORKFLOW_DEFS) as WorkflowKey[];

export type { WorkflowKey };

// ─── Convert JSON result to readable markdown for copy/save ─────────────────
export function resultToMarkdown(text: string, workflowTitle: string): string {
  const parsed = tryParseJSON(text);
  if (!parsed) return text;

  const lines: string[] = [];
  lines.push(`# ${workflowTitle} 分析报告\n`);
  if (parsed.summary) lines.push(`> ${parsed.summary}\n`);

  parsed.items.forEach((item, i) => {
    const sevLabel = item.severity
      ? ` [${item.severity === 'high' ? '高' : item.severity === 'medium' ? '中' : '低'}]`
      : '';
    const typeLabel = item.type ? TYPE_LABELS[item.type] || item.type : '';
    lines.push(`## ${i + 1}. ${item.title}${sevLabel}`);
    if (typeLabel) lines.push(`**类型**: ${typeLabel}`);
    lines.push(`\n${item.description}`);
    if (item.impact) lines.push(`\n**影响**: ${item.impact}`);
    if (item.suggestion) lines.push(`\n**建议**: ${item.suggestion}`);
    lines.push('');
  });

  if (parsed.conclusion) {
    lines.push('---');
    lines.push(`## 总结\n\n${parsed.conclusion}`);
  }

  return lines.join('\n');
}

// ─── Compute severity counts from parsed result ────────────────────────────
export function getSeverityCounts(
  text: string
): { high: number; medium: number; low: number } | null {
  const parsed = tryParseJSON(text);
  if (!parsed) return null;
  const counts = { high: 0, medium: 0, low: 0 };
  for (const item of parsed.items) {
    if (item.severity === 'high') counts.high++;
    else if (item.severity === 'medium') counts.medium++;
    else if (item.severity === 'low') counts.low++;
  }
  return counts;
}

export function getHistorySummary(text: string): string {
  const parsed = tryParseJSON(text);
  if (!parsed) return text.slice(0, 80);
  return parsed.summary || parsed.conclusion || parsed.items[0]?.title || '分析完成';
}

// ─── AI Workflow Hook ─────────────────────────────────────────────────────
interface UseAiWorkflowOptions {
  folderPath: string | null;
  content: string;
  filePath?: string | null;
  onApplyFix?: (
    original: string,
    modified: string,
    targetPath?: string,
    targetLine?: number
  ) => void;
  onOpenFile?: (filePath: string) => void;
  addRecord: (record: HistoryRecord) => void;
  /** 跳过本地磁盘写入（独立窗口模式，修复委托给主窗口） */
  skipDiskWrite?: boolean;
  /** 独立窗口模式下，将修复数据发到主窗口展示 diff（替代直接写盘） */
  onDelegateFix?: (payload: {
    filePath: string;
    original: string;
    modified: string;
    explanation?: string;
    proposedFullContent?: string;
    targetLine?: number;
  }) => void;
  /** 在编辑器中展示内联 diff 预览（fix 生成后立即标注修改区域） */
  onPreviewDiff?: (original: string, modified: string) => void;
}

export function useAiWorkflow({
  folderPath,
  content,
  filePath,
  onApplyFix,
  onOpenFile,
  addRecord,
  skipDiskWrite,
  onDelegateFix,
  onPreviewDiff,
}: UseAiWorkflowOptions) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowKey>('consistency');
  const [contextCounts, setContextCounts] = useState({ lore: 0, characters: 0 });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const [contentSnapshot, setContentSnapshot] = useState('');
  const [snapshotFilePath, setSnapshotFilePath] = useState<string | null>(null);
  const [fixResults, setFixResults] = useState<Record<number, FixResult>>({});

  // Cleanup timers on unmount
  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    []
  );

  // Load context counts
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

  // Copy all result as markdown
  const handleCopy = useCallback(() => {
    if (!result) return;
    const md = resultToMarkdown(result, WORKFLOW_DEFS[workflow].title);
    void navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    });
  }, [result, workflow]);

  // Save to project ai-reports/ directory
  const handleSave = useCallback(async () => {
    if (!result || !folderPath) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const md = resultToMarkdown(result, WORKFLOW_DEFS[workflow].title);
    const ts = new Date();
    const fileName = `AI分析_${WORKFLOW_DEFS[workflow].title}_${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}.md`;
    try {
      const res = (await ipc.invoke('save-analysis-file', folderPath, fileName, md)) as {
        success: boolean;
        filePath?: string;
      };
      if (!res.success) return;
      setSaved(true);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => setSaved(false), 3000);
    } catch {
      // Fallback: copy to clipboard if save fails
      void navigator.clipboard.writeText(md);
      setSaved(true);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => setSaved(false), 3000);
    }
  }, [result, folderPath, workflow]);

  // Auto-fix: send suggestion back to AI for rewriting
  const handleAutoFix = useCallback(
    async (item: AIResultItem): Promise<FixResult> => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return { text: '无法连接 IPC' };

      // Resolve target file: snapshotFilePath (set by runAI/restoreRecord) > filePath prop
      const targetPath = snapshotFilePath || filePath || null;

      // Data-driven: read from disk first (authoritative source)
      let effectiveContent = '';
      if (targetPath && !targetPath.startsWith('__') && ipc) {
        try {
          effectiveContent = (await ipc.invoke('read-file', targetPath)) as string;
        } catch {
          // File may have been deleted or moved
        }
      }
      // Fallback: current editor content or snapshot (for untitled files)
      if (!effectiveContent || effectiveContent.trim().length === 0) {
        effectiveContent = content && content.trim().length > 0 ? content : contentSnapshot;
      }

      if (!effectiveContent || effectiveContent.trim().length === 0) {
        return { text: '未找到关联文件内容，请在编辑器中打开需要修改的文件后重试。' };
      }

      // Auto-open and focus on the target file in editor
      if (targetPath && onOpenFile) {
        onOpenFile(targetPath);
      }

      const fixPrompt = `请根据以下问题和建议，对正文进行修改。

问题：${item.title}
描述：${item.description}
建议：${item.suggestion || ''}

你必须以 JSON 格式输出，严格遵守以下 schema：
{
  "original": "从正文中精确摘录需要修改的原文片段（必须与正文完全一致）",
  "modified": "修改后的完整文本",
  "explanation": "简要说明修改内容"
}
只输出合法 JSON，不要输出任何多余文字或代码块标记。`;

      try {
        const contentSlice = effectiveContent.slice(0, 4000);
        const response = (await ipc.invoke('ai-request', {
          prompt: fixPrompt,
          systemPrompt:
            '你是小说修改助手。根据给出的问题和建议，直接修改正文中对应的内容。必须以 JSON 格式输出 { original, modified, explanation } 三个字段。original 必须是正文中可以精确匹配到的原文片段。',
          context: `正文:\n${contentSlice}`,
        })) as { ok: boolean; text?: string; error?: string };

        if (response.ok && response.text) {
          let cleaned = response.text.trim();
          if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          }
          try {
            const parsed = JSON.parse(cleaned) as {
              original?: string;
              modified?: string;
              explanation?: string;
            };
            if (parsed.original && parsed.modified) {
              // 在编辑器中展示内联 diff 预览（片段级：只传 original/modified）
              if (onPreviewDiff && effectiveContent) {
                // 先验证 original 能在文档中命中
                const previewResult = preciseReplaceWithReport(
                  effectiveContent,
                  parsed.original,
                  parsed.modified
                );
                if (previewResult.content) {
                  onPreviewDiff(parsed.original, parsed.modified);
                }
              }
              const displayText = parsed.explanation
                ? `${parsed.explanation}\n\n修改后：\n${parsed.modified}`
                : parsed.modified;
              return { text: displayText, original: parsed.original, modified: parsed.modified };
            }
          } catch {
            // fallback: treat as plain text
          }
          return { text: response.text };
        }
        return { text: response.error || '自动修改失败' };
      } catch (error) {
        return { text: error instanceof Error ? error.message : '自动修改异常' };
      }
    },
    [content, contentSnapshot, snapshotFilePath, filePath, onOpenFile, onPreviewDiff]
  );

  const saveFixResult = useCallback((idx: number, fix: FixResult) => {
    setFixResults((prev) => ({ ...prev, [idx]: fix }));
  }, []);

  const removeFixResult = useCallback((idx: number) => {
    setFixResults((prev) => {
      if (!(idx in prev)) return prev;
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }, []);

  // Apply fix to source file
  const handleApplyFixToSource = useCallback(
    async (fix: FixResult) => {
      if (!fix.original || !fix.modified) return;
      const ipc = window.electron?.ipcRenderer;
      const targetPath = snapshotFilePath || filePath || null;

      // Data-driven: read latest content from disk to verify match
      let effectiveContent = '';
      if (targetPath && !targetPath.startsWith('__') && ipc) {
        try {
          effectiveContent = (await ipc.invoke('read-file', targetPath)) as string;
        } catch {
          // ignore
        }
      }
      if (!effectiveContent || effectiveContent.trim().length === 0) {
        effectiveContent = content && content.trim().length > 0 ? content : contentSnapshot;
      }
      if (!effectiveContent) return;

      // 验证 original 能在 source 中命中（快速失败）
      const replaceResult = preciseReplaceWithReport(effectiveContent, fix.original, fix.modified);
      if (!replaceResult.content) {
        throw new Error(formatPreciseReplaceReport(replaceResult.report));
      }

      // 计算 targetLine
      const matchIndex = effectiveContent.indexOf(fix.original);
      const targetLine =
        matchIndex >= 0 ? effectiveContent.slice(0, matchIndex).split('\n').length : 1;

      // 独立窗口模式：委托给主窗口处理
      if (skipDiskWrite && onDelegateFix && targetPath) {
        onDelegateFix({
          filePath: targetPath,
          original: fix.original,
          modified: fix.modified,
          explanation: fix.text !== fix.modified ? fix.text.split('\n\n修改后：')[0] : undefined,
          proposedFullContent: replaceResult.content,
          targetLine,
        });
        return;
      }

      // 主窗口模式：传递片段级 original+modified，由 App.tsx 负责精确替换 + 写盘
      if (targetPath && onOpenFile) {
        onOpenFile(targetPath);
      }
      if (onApplyFix) {
        onApplyFix(fix.original, fix.modified, targetPath || undefined, targetLine);
      }
    },
    [
      content,
      contentSnapshot,
      filePath,
      snapshotFilePath,
      onApplyFix,
      onOpenFile,
      skipDiskWrite,
      onDelegateFix,
    ]
  );

  // Run AI analysis
  const runAI = useCallback(
    async (presetPrompt?: string) => {
      const finalPrompt = (presetPrompt || prompt).trim();
      if (!finalPrompt) return;
      setLoading(true);
      setResult('');
      setFixResults({});
      if (content) setContentSnapshot(content);
      if (filePath) setSnapshotFilePath(filePath);
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

        const contentSlice = workflow === 'lore' ? content.slice(0, 8000) : content.slice(0, 2000);

        // 大文件混合检索：用章节索引 + 关键词匹配替代截断式上下文
        let contentContext: string;
        if (isLargeText(content)) {
          const idx = getOrBuildIndex(content);
          const maxChars = workflow === 'lore' ? 12000 : 8000;
          const { context: retrieved } = hybridRetrieve(idx, finalPrompt, 5, maxChars);
          contentContext = retrieved;
        } else {
          contentContext = contentSlice;
        }

        const context = [
          content ? `正文片段:\n${contentContext}` : '',
          loreEntries.length > 0
            ? `设定集:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
            : '',
          charactersContext ? `人物资料:\n${charactersContext}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        const response = (await ipc.invoke('ai-request', {
          prompt: finalPrompt + JSON_PROMPT_SUFFIX,
          systemPrompt: JSON_SYSTEM_PROMPT,
          context,
        })) as { ok: boolean; text?: string; error?: string };

        const resultText = response.ok
          ? response.text || 'AI 未返回内容'
          : response.error || 'AI 请求失败';
        setResult(resultText);

        if (response.ok && resultText) {
          const record: HistoryRecord = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            workflow,
            prompt: finalPrompt,
            result: resultText,
            timestamp: Date.now(),
            filePath: filePath || undefined,
          };
          addRecord(record);
        }
      } catch (error) {
        setResult(error instanceof Error ? error.message : 'AI 请求异常');
      } finally {
        setLoading(false);
      }
    },
    [prompt, folderPath, content, filePath, workflow, addRecord]
  );

  return {
    prompt,
    setPrompt,
    result,
    setResult,
    loading,
    workflow,
    setWorkflow,
    contextCounts,
    copied,
    saved,
    snapshotFilePath,
    setSnapshotFilePath,
    fixResults,
    setFixResults,
    saveFixResult,
    removeFixResult,
    handleCopy,
    handleSave,
    handleAutoFix,
    handleApplyFixToSource,
    runAI,
  };
}
