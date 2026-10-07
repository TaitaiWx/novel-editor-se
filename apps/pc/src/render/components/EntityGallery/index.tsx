/**
 * 人物 / 设定的图集（多视图、多背景、服装…）：本地上传或 AI 生成，从中选一张作为封面（形象图）。
 *
 * 封面在详情页显示为大图，在列表 / 悬停卡片 / 场景视频里裁成小圆头像。
 * AI 生成时自动带上已有的形象图 / 三视图作参考图（服务支持时），新图与原人物保持一致。
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  VscClose,
  VscCloudUpload,
  VscSparkle,
  VscStarEmpty,
  VscStarFull,
  VscTrash,
} from 'react-icons/vsc';
import {
  addMediaItems,
  groupMediaItems,
  removeMediaItem,
  resolveCover,
  type EntityKind,
  type MediaItem,
  type MediaKind,
  type MediaKindOption,
} from '@novel-editor/core/entity-media';
import Tooltip from '../Tooltip';
import AiImagePanel, { CANDIDATE_COUNT, type AiImageRequest } from './AiImagePanel';
import { MediaImage } from './MediaTile';
import { dataUrlToBytes, deleteImage, saveImage } from './mediaActions';
import { useImageServices } from './useImageServices';
import styles from './styles.module.scss';

export interface GalleryChange {
  media: MediaItem[];
  cover?: string;
}

export interface EntityGalleryProps {
  entity: EntityKind;
  /** 人物名 / 设定标题（决定保存目录） */
  name: string;
  workPath: string | null;
  items: readonly MediaItem[];
  cover?: string;
  /** 旧版单张头像（图集为空时显示为封面） */
  legacyCover?: string;
  kinds: readonly MediaKindOption[];
  /** 拼出 AI 提示词（由人物设计 / 设定内容决定，作者不用写） */
  buildPrompt: (request: { kind: MediaKind; style: string; extra: string }) => string;
  /** 参考图选择：默认取已有的三视图 / 形象图 / 概念图（最多 4 张） */
  referenceKinds?: readonly MediaKind[];
  onChange: (change: GalleryChange) => Promise<void> | void;
}

const DEFAULT_REFERENCE_KINDS: readonly MediaKind[] = ['turnaround', 'portrait', 'concept'];

const EntityGallery: React.FC<EntityGalleryProps> = ({
  entity,
  name,
  workPath,
  items,
  cover,
  legacyCover,
  kinds,
  buildPrompt,
  referenceKinds = DEFAULT_REFERENCE_KINDS,
  onChange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<MediaKind>(kinds[0]?.kind ?? 'other');
  const [aiOpen, setAiOpen] = useState(false);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const services = useImageServices();
  const currentCover = resolveCover(items, cover, legacyCover);
  const groups = useMemo(() => groupMediaItems(items, kinds), [items, kinds]);
  const references = useMemo(
    () =>
      referenceKinds
        .flatMap((kind) => items.filter((item) => item.kind === kind))
        .map((item) => item.path)
        .slice(0, 4),
    [items, referenceKinds]
  );

  const commit = async (media: MediaItem[], nextCover?: string) => {
    await onChange({ media, cover: resolveCover(media, nextCover ?? cover) });
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || !workPath) return;
    setBusy(true);
    setError('');
    try {
      const added: MediaItem[] = [];
      for (const file of Array.from(files)) {
        added.push(
          await saveImage({
            workPath,
            entity,
            name,
            kind: uploadKind,
            data: new Uint8Array(await file.arrayBuffer()),
            source: 'upload',
          })
        );
      }
      // 第一次上传且还没有封面时，第一张自动成为封面
      await commit(addMediaItems(items, added), items.length === 0 ? added[0]?.path : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const generate = async (request: AiImageRequest) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) throw new Error('没有打开项目');
    const option = kinds.find((item) => item.kind === request.kind);
    const result = await ipc.invoke('ai-image-generate', {
      workPath: workPath ?? undefined,
      providerId: request.providerId || undefined,
      prompt: buildPrompt(request),
      aspectRatio: option?.aspectRatio,
      count: CANDIDATE_COUNT,
      references,
    });
    if (!result.ok) throw new Error(result.error.message);
    lastModelRef.current = { providerId: result.data.providerId, model: result.data.model };
    return result.data.images.map((image) => ({ dataUrl: image.dataUrl }));
  };
  const lastModelRef = useRef<{ providerId: string; model: string } | null>(null);

  const saveCandidates = async (request: AiImageRequest, picked: Array<{ dataUrl: string }>) => {
    if (!workPath) throw new Error('没有打开项目');
    const prompt = buildPrompt(request);
    const added: MediaItem[] = [];
    for (const candidate of picked) {
      added.push(
        await saveImage({
          workPath,
          entity,
          name,
          kind: request.kind,
          data: dataUrlToBytes(candidate.dataUrl),
          source: 'ai',
          prompt,
          providerId: lastModelRef.current?.providerId,
          model: lastModelRef.current?.model,
        })
      );
    }
    await commit(addMediaItems(items, added), items.length === 0 ? added[0]?.path : undefined);
  };

  const remove = async (item: MediaItem) => {
    if (!workPath) return;
    setError('');
    try {
      await deleteImage(workPath, item.path).catch(() => undefined);
      const media = removeMediaItem(items, item.id);
      await commit(media, item.path === currentCover ? undefined : currentCover);
      if (viewing?.id === item.id) setViewing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const aiReady = services.providers.length > 0;
  const aiTip = !services.loaded
    ? '正在读取图片服务…'
    : aiReady
      ? `AI 生成：按${entity === 'character' ? '人物设计' : '设定内容'}自动出 ${CANDIDATE_COUNT} 张，挑喜欢的保存`
      : '还没有配置图片服务：在设置中心「AI → 更多 AI 服务」填写 Seedream / MiniMax / Grok 图片的 Key';

  return (
    <section className={styles.gallery} aria-label={`${name} 的图集`} data-testid="entity-gallery">
      <header className={styles.toolbar}>
        <span className={styles.count}>{items.length} 张</span>
        <span className={styles.spacer} />
        <select
          className={styles.select}
          aria-label="上传为"
          value={uploadKind}
          onChange={(event) => setUploadKind(event.target.value as MediaKind)}
        >
          {kinds.map((item) => (
            <option key={item.kind} value={item.kind}>
              上传为{item.label}
            </option>
          ))}
        </select>
        <Tooltip content="从本地选择图片（可多选），保存到 资料/图集/">
          <button
            type="button"
            className={styles.button}
            disabled={!workPath || busy}
            onClick={() => inputRef.current?.click()}
          >
            <VscCloudUpload aria-hidden="true" />
            {busy ? '上传中…' : '本地上传'}
          </button>
        </Tooltip>
        <Tooltip content={aiTip}>
          <button
            type="button"
            className={styles.primary}
            aria-expanded={aiOpen}
            disabled={!workPath}
            onClick={() => {
              if (!aiReady) {
                window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }));
                return;
              }
              setAiOpen((value) => !value);
            }}
          >
            <VscSparkle aria-hidden="true" />
            AI 生成
          </button>
        </Tooltip>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          data-testid="entity-gallery-input"
          onChange={(event) => {
            const files = event.target.files;
            void upload(files).finally(() => {
              event.target.value = '';
            });
          }}
        />
      </header>

      {aiOpen && aiReady && (
        <AiImagePanel
          kinds={kinds}
          providers={services.providers}
          previewPrompt={buildPrompt}
          referenceCount={references.length}
          generate={generate}
          save={saveCandidates}
          onClose={() => setAiOpen(false)}
        />
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className={styles.empty}>
          <p>还没有图片。</p>
          <p className={styles.muted}>
            {entity === 'character'
              ? '建议先生成一张「三视图」：之后的形象图、服装和场景视频都会参考它，人物不容易崩。'
              : '加一张概念图，写作和做场景视频时都能直接参考。'}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.option.kind} className={styles.group}>
            <h4 className={styles.groupTitle}>
              {group.option.label}
              <span className={styles.muted}>{group.items.length}</span>
            </h4>
            <ul className={styles.grid} role="list">
              {group.items.map((item) => {
                const isCover = item.path === currentCover;
                return (
                  <li key={item.id} className={styles.tile} data-kind={item.kind}>
                    <button
                      type="button"
                      className={styles.tileImage}
                      aria-label={`查看 ${group.option.label}`}
                      onClick={() => setViewing(item)}
                    >
                      <MediaImage path={item.path} workPath={workPath} alt={group.option.label} />
                    </button>
                    {isCover && <span className={styles.coverBadge}>封面</span>}
                    {item.source === 'ai' && <span className={styles.aiBadge}>AI</span>}
                    <span className={styles.tileActions}>
                      <Tooltip content={isCover ? '当前封面（形象图）' : '设为封面（形象图）'}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={isCover ? '当前封面' : '设为封面'}
                          aria-pressed={isCover}
                          onClick={() => void commit([...items], item.path)}
                        >
                          {isCover ? <VscStarFull /> : <VscStarEmpty />}
                        </button>
                      </Tooltip>
                      <Tooltip content="删除这张图（同时删除文件）">
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label="删除图片"
                          onClick={() => void remove(item)}
                        >
                          <VscTrash />
                        </button>
                      </Tooltip>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {viewing && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-label="查看图片"
          onClick={() => setViewing(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setViewing(null);
          }}
          tabIndex={-1}
        >
          <MediaImage
            path={viewing.path}
            workPath={workPath}
            alt="大图"
            className={styles.lightboxImage}
          />
          {viewing.prompt && <p className={styles.lightboxPrompt}>{viewing.prompt}</p>}
          <Tooltip content="关闭（Esc）">
            <button
              type="button"
              className={styles.lightboxClose}
              aria-label="关闭大图"
              onClick={() => setViewing(null)}
            >
              <VscClose />
            </button>
          </Tooltip>
        </div>
      )}
    </section>
  );
};

export default EntityGallery;
