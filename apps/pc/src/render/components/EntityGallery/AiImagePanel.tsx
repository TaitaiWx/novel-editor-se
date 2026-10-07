import React, { useState } from 'react';
import { VscCheck, VscLoading } from 'react-icons/vsc';
import {
  IMAGE_STYLES,
  type MediaKind,
  type MediaKindOption,
} from '@novel-editor/core/entity-media';
import type { AIProviderInfo } from '@/render/types/ai-api';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

export const CANDIDATE_COUNT = 4;

export interface AiImageRequest {
  kind: MediaKind;
  style: string;
  extra: string;
  providerId: string;
}

export interface ImageCandidate {
  dataUrl: string;
}

interface AiImagePanelProps {
  kinds: readonly MediaKindOption[];
  providers: readonly AIProviderInfo[];
  /** 根据类型 / 画风 / 补充说明预览将要发送的提示词（只读展示，作者不用写专业提示词） */
  previewPrompt: (request: Omit<AiImageRequest, 'providerId'>) => string;
  /** 参考图数量（已有形象图 / 三视图时自动带上，保持人物一致） */
  referenceCount: number;
  generate: (request: AiImageRequest) => Promise<ImageCandidate[]>;
  save: (request: AiImageRequest, picked: ImageCandidate[]) => Promise<void>;
  onClose: () => void;
}

/**
 * AI 出图：选类型（形象图 / 三视图 / 服装…）+ 画风，可补一句话，一次出 4 张，挑中的保存进图集。
 * 提示词由人物设计 / 设定内容自动拼好，作者不需要写专业描述。
 */
const AiImagePanel: React.FC<AiImagePanelProps> = ({
  kinds,
  providers,
  previewPrompt,
  referenceCount,
  generate,
  save,
  onClose,
}) => {
  const [kind, setKind] = useState<MediaKind>(kinds[0]?.kind ?? 'portrait');
  const [style, setStyle] = useState<string>(IMAGE_STYLES[0]);
  const [extra, setExtra] = useState('');
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const option = kinds.find((item) => item.kind === kind);
  const request: AiImageRequest = { kind, style, extra, providerId };

  const run = async () => {
    setBusy('generate');
    setError('');
    setCandidates([]);
    setPicked(new Set());
    try {
      const result = await generate(request);
      setCandidates(result);
      // 只有一张时默认选中
      if (result.length === 1) setPicked(new Set([0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const savePicked = async () => {
    setBusy('save');
    setError('');
    try {
      await save(
        request,
        candidates.filter((_, index) => picked.has(index))
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.aiPanel} aria-label="AI 生成图片">
      {kinds.length > 1 && (
        <div className={styles.kindRow} role="radiogroup" aria-label="图片类型">
          {kinds.map((item) => (
            <Tooltip key={item.kind} content={item.hint}>
              <button
                type="button"
                role="radio"
                aria-checked={kind === item.kind}
                className={kind === item.kind ? styles.kindActive : styles.kind}
                onClick={() => setKind(item.kind)}
              >
                {item.label}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
      <div className={styles.aiOptions}>
        <select
          className={styles.select}
          aria-label="画风"
          value={style}
          onChange={(event) => setStyle(event.target.value)}
        >
          {IMAGE_STYLES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        {providers.length > 1 && (
          <select
            className={styles.select}
            aria-label="图片服务"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        <input
          className={styles.input}
          aria-label="补充一句（可不填）"
          value={extra}
          placeholder="补充一句（可不填），例如：雪夜，披着斗篷"
          onChange={(event) => setExtra(event.target.value)}
        />
        <button
          type="button"
          className={styles.primary}
          disabled={busy !== null}
          onClick={() => void run()}
        >
          {busy === 'generate' ? (
            <>
              <VscLoading className={styles.spin} aria-hidden="true" /> 生成中…
            </>
          ) : candidates.length ? (
            '再生成一组'
          ) : (
            `生成 ${CANDIDATE_COUNT} 张${option ? option.label : ''}`
          )}
        </button>
      </div>
      <details className={styles.promptPreview}>
        <summary>
          将使用的描述
          {referenceCount > 0 ? ` · 带 ${referenceCount} 张参考图保持一致` : ''}
        </summary>
        <p>{previewPrompt({ kind, style, extra })}</p>
      </details>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {candidates.length > 0 && (
        <>
          <div
            className={styles.candidates}
            role="listbox"
            aria-label="候选图"
            aria-multiselectable
          >
            {candidates.map((candidate, index) => {
              const selected = picked.has(index);
              return (
                <button
                  key={index}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={`候选图 ${index + 1}`}
                  className={`${styles.candidate} ${selected ? styles.candidateSelected : ''}`}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                >
                  <img src={candidate.dataUrl} alt="" draggable={false} />
                  {selected && (
                    <span className={styles.check} aria-hidden="true">
                      <VscCheck />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className={styles.aiFooter}>
            <span className={styles.muted}>点选喜欢的图（可多选），保存进图集</span>
            <button
              type="button"
              className={styles.primary}
              disabled={picked.size === 0 || busy !== null}
              onClick={() => void savePicked()}
            >
              {busy === 'save' ? '保存中…' : `保存 ${picked.size} 张`}
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default AiImagePanel;
