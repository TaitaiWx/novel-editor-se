import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VscClose, VscRefresh } from 'react-icons/vsc';
import { isImeComposing } from '@/render/utils/ime';
import { useAiConfig } from '../RightPanel/useAiConfig';
import type { StoryIdeaGenerationScope } from '../RightPanel/story-idea';
import { InspirationAdvanced } from './InspirationAdvanced';
import { useInspirationData } from './useInspirationData';
import {
  INSPIRATION_SLOTS,
  INSPIRATION_SLOT_HINTS,
  INSPIRATION_SLOT_LABELS,
  buildInspirationExpandPrompt,
  buildInspirationPools,
  drawInspiration,
  formatInspiration,
  rerollInspirationSlot,
  storyIdeaCardToInspiration,
  type InspirationDraw,
  type InspirationSlot,
  type InspirationSource,
  type RandomSource,
} from './inspiration';
import styles from './styles.module.scss';

export interface InspirationDialogProps {
  visible: boolean;
  onClose: () => void;
  /** 当前作品目录（词池与历史按作品保存） */
  folderPath: string | null;
  dbReady: boolean;
  /** 当前正文：AI 扩写时取结尾作衔接 */
  content: string;
  /** 插入到编辑器光标处；返回 false 表示当前没有可写入的正文 */
  onInsert: (text: string) => boolean;
  /** 打开后回填的三签卡（大纲版本「回到来源」） */
  initialCardId?: number | null;
  /** 测试注入的随机数 */
  random?: RandomSource;
}

type AiState = { status: 'idle' | 'loading' | 'done' | 'error'; text: string };

const AI_IDLE: AiState = { status: 'idle', text: '' };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 灵感：一键抽出 人物 / 地点 / 冲突 三张签，零输入。
 * 可单张换签、插入到光标处、复制、交给 AI 扩写；词源 / 词池 / 历史收在「更多选项」。
 */
const InspirationDialog: React.FC<InspirationDialogProps> = ({
  visible,
  onClose,
  folderPath,
  dbReady,
  content,
  onInsert,
  initialCardId = null,
  random,
}) => {
  const aiConfig = useAiConfig();
  const { cards, termPool, addCustomTerm, saveToHistory } = useInspirationData(
    folderPath,
    dbReady,
    visible
  );
  const [draw, setDraw] = useState<InspirationDraw | null>(null);
  const [source, setSource] = useState<InspirationSource>('mixed');
  const [scope, setScope] = useState<StoryIdeaGenerationScope>('hybrid');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notice, setNotice] = useState('');
  const [ai, setAi] = useState<AiState>(AI_IDLE);
  const savedRef = useRef<InspirationDraw | null>(null);
  const drawButtonRef = useRef<HTMLButtonElement>(null);
  const appliedCardRef = useRef<number | null>(null);
  const pools = useMemo(() => buildInspirationPools(source, termPool), [source, termPool]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    drawButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  // 来源追溯：回填指定的三签卡并展开更多选项（每张卡只回填一次）
  useEffect(() => {
    if (!visible || initialCardId === null || appliedCardRef.current === initialCardId) return;
    const card = cards.find((item) => item.id === initialCardId);
    const restored = card ? storyIdeaCardToInspiration(card) : null;
    if (!restored) return;
    appliedCardRef.current = initialCardId;
    setDraw(restored);
    setShowAdvanced(true);
    setAi(AI_IDLE);
  }, [cards, initialCardId, visible]);

  const updateDraw = useCallback((next: InspirationDraw) => {
    setDraw(next);
    setAi(AI_IDLE);
    setNotice('');
  }, []);

  const handleDrawAll = () => updateDraw(drawInspiration(pools, random));
  const handleReroll = (slot: InspirationSlot) => {
    if (draw) updateDraw(rerollInspirationSlot(draw, slot, pools, random));
  };

  /** 同一次抽签只记一次历史 */
  const rememberDraw = (current: InspirationDraw) => {
    if (savedRef.current === current) return;
    savedRef.current = current;
    void saveToHistory(current);
  };

  const handleInsert = (text: string) => {
    if (!draw) return;
    if (!onInsert(text)) {
      setNotice('先打开一个章节，再把灵感插入到光标处');
      return;
    }
    rememberDraw(draw);
    onClose();
  };

  const handleCopy = async (text: string) => {
    if (!draw) return;
    const ok = await copyText(text);
    setNotice(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本');
    if (ok) rememberDraw(draw);
  };

  const handleExpand = async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!draw || !ipc) return;
    rememberDraw(draw);
    setAi({ status: 'loading', text: '' });
    try {
      const response = (await ipc.invoke('ai-request', {
        prompt: buildInspirationExpandPrompt(draw, content, scope),
        systemPrompt: '你是小说写作助手，擅长把零散的灵感扩写成有画面感的场景。',
        maxTokens: 1024,
        temperature: 0.9,
      })) as { ok: boolean; text?: string; error?: string };
      if (response.ok && response.text?.trim()) {
        setAi({ status: 'done', text: response.text.trim() });
      } else {
        setAi({ status: 'error', text: response.error || 'AI 扩写失败' });
      }
    } catch (error) {
      setAi({ status: 'error', text: error instanceof Error ? error.message : 'AI 扩写失败' });
    }
  };

  if (!visible) return null;

  const drawnText = draw ? formatInspiration(draw) : '';
  const aiReady = aiConfig.loaded && aiConfig.ready;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="灵感"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>灵感</h2>
            <p className={styles.subtitle}>卡文时抽一签：人物、地点、冲突各来一张。</p>
          </div>
          <button type="button" className={styles.iconButton} aria-label="关闭" onClick={onClose}>
            <VscClose />
          </button>
        </div>

        {draw ? (
          <div className={styles.slots}>
            {INSPIRATION_SLOTS.map((slot) => (
              <div key={slot} className={styles.slot} data-slot={slot}>
                <div className={styles.slotHead}>
                  <span className={styles.slotLabel}>{INSPIRATION_SLOT_LABELS[slot]}</span>
                  <span className={styles.slotHint}>{INSPIRATION_SLOT_HINTS[slot]}</span>
                </div>
                <div className={styles.slotTerm} data-testid={`inspiration-${slot}`}>
                  {draw[slot]}
                </div>
                <button
                  type="button"
                  className={styles.rerollButton}
                  aria-label={`换一张${INSPIRATION_SLOT_LABELS[slot]}签`}
                  onClick={() => handleReroll(slot)}
                >
                  <VscRefresh />
                  换一签
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>不用填任何东西，点下面的按钮就行。</div>
        )}

        <div className={styles.actions}>
          <button
            ref={drawButtonRef}
            type="button"
            className={draw ? styles.secondaryButton : styles.drawButton}
            onClick={handleDrawAll}
          >
            {draw ? '全部重抽' : '抽一签'}
          </button>
          {draw && (
            <>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => handleInsert(drawnText)}
              >
                插入到光标处
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleCopy(drawnText)}
              >
                复制
              </button>
              {aiConfig.enabled && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!aiReady || ai.status === 'loading'}
                  title={aiReady ? undefined : '请先在设置中完成 AI 配置'}
                  onClick={() => void handleExpand()}
                >
                  {ai.status === 'loading' ? '扩写中…' : '交给 AI 扩写'}
                </button>
              )}
            </>
          )}
        </div>

        {ai.status === 'done' && (
          <div className={styles.aiResult} aria-label="AI 扩写结果">
            <div className={styles.aiText}>{ai.text}</div>
            <div className={styles.aiActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => handleInsert(ai.text)}
              >
                插入扩写
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleCopy(ai.text)}
              >
                复制扩写
              </button>
            </div>
          </div>
        )}
        {ai.status === 'error' && <div className={styles.error}>{ai.text}</div>}
        {notice && (
          <div className={styles.notice} role="status">
            {notice}
          </div>
        )}

        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((value) => !value)}
        >
          <span className={styles.disclosureCaret} aria-hidden="true">
            {showAdvanced ? '▾' : '▸'}
          </span>
          更多选项
        </button>
        {showAdvanced && (
          <InspirationAdvanced
            source={source}
            onSourceChange={setSource}
            scope={scope}
            onScopeChange={setScope}
            showScope={aiConfig.enabled}
            canPersist={Boolean(folderPath && dbReady)}
            cards={cards}
            onAddTerm={addCustomTerm}
            onPickHistory={updateDraw}
          />
        )}
      </div>
    </div>,
    document.body
  );
};

export default InspirationDialog;
