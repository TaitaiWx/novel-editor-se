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
  COVER_LABEL,
  addMediaItems,
  groupMediaItems,
  removeMediaItem,
  resolveCover,
  setMediaKind,
  type EntityKind,
  type MediaItem,
  type MediaKind,
  type MediaKindOption,
} from '@novel-editor/core/entity-media';
import Tooltip from '../Tooltip';
import ContextMenu from '../ContextMenu';
import { joinWorkPath, requestOpenReference } from '../../utils/referencePane';
import { IMAGE_EXPORT_FORMATS, exportMediaWithToast } from '../../utils/mediaExport';
import { useOptionalToast } from '../Toast';
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
  const uploadKind: MediaKind = kinds[0]?.kind ?? 'other';
  const [menu, setMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null);
  const toast = useOptionalToast();
  const [dragging, setDragging] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const services = useImageServices();
  const currentCover = resolveCover(items, cover, legacyCover);
  const groups = useMemo(() => groupMediaItems(items, kinds), [items, kinds]);
  const groupKindOf = (item: MediaItem): MediaKind =>
    kinds.some((option) => option.kind === item.kind) ? item.kind : uploadKind;
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

  const upload = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files).filter((file) => /^image\//.test(file.type)) : [];
    if (list.length === 0 || !workPath) return;
    setBusy(true);
    setError('');
    try {
      const added: MediaItem[] = [];
      for (const file of list) {
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
      : '还没有配置图片服务：在设置中心「AI → 图片」填写 Seedream / MiniMax / Grok 图片的 Key';

  return (
    <section
      className={styles.gallery}
      aria-label={`${name} 的图集`}
      data-testid="entity-gallery"
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (!event.dataTransfer?.files?.length) return;
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
    >
      <header className={styles.toolbar}>
        <span className={styles.count}>{items.length} 张</span>
        <span className={styles.spacer} />
        <Tooltip content="从本地选择图片（可多选，也可以直接拖进来），上传后右键可以设为三视图 / 主要形象图">
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
        <button
          type="button"
          className={`${styles.empty} ${dragging ? styles.emptyDragging : ''}`}
          disabled={!workPath || busy}
          onClick={() => inputRef.current?.click()}
          data-testid="entity-gallery-dropzone"
        >
          <span className={styles.emptyTitle}>点击上传图片，或把图片拖到这里</span>
          <span className={styles.muted}>
            {entity === 'character'
              ? '上传后右键可以设为「三视图」或「主要形象图」。建议准备一张三视图：生成视频时人物不容易崩。'
              : '上传后右键可以设为封面，写作和做场景视频时都能直接参考。'}
          </span>
        </button>
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
                  <li
                    key={item.id}
                    className={styles.tile}
                    data-kind={group.option.kind}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, item });
                    }}
                  >
                    <button
                      type="button"
                      className={styles.tileImage}
                      aria-label={`查看 ${group.option.label}`}
                      onClick={() => setViewing(item)}
                    >
                      <MediaImage path={item.path} workPath={workPath} alt={group.option.label} />
                    </button>
                    {isCover && <span className={styles.coverBadge}>{COVER_LABEL[entity]}</span>}
                    {item.source === 'ai' && <span className={styles.aiBadge}>AI</span>}
                    <span className={styles.tileActions}>
                      <Tooltip
                        content={
                          isCover
                            ? `当前${COVER_LABEL[entity]}`
                            : `设为${COVER_LABEL[entity]}（右键还有更多）`
                        }
                      >
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={
                            isCover ? `当前${COVER_LABEL[entity]}` : `设为${COVER_LABEL[entity]}`
                          }
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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: `设为${COVER_LABEL[entity]}`,
              disabled: menu.item.path === currentCover,
              onClick: () => void commit([...items], menu.item.path),
            },
            ...(kinds.length > 1
              ? kinds.map((option) => ({
                  label: `设为${option.label}`,
                  disabled: groupKindOf(menu.item) === option.kind,
                  onClick: () =>
                    void commit(setMediaKind(items, menu.item.id, option.kind), currentCover),
                }))
              : []),
            { label: '', onClick: () => undefined, separator: true },
            {
              label: '在编辑器旁边打开',
              disabled: !workPath,
              onClick: () => {
                if (!workPath) return;
                requestOpenReference({
                  items: items.map((entry) => ({
                    path: joinWorkPath(workPath, entry.path),
                    title: `${name} · ${kinds.find((option) => option.kind === groupKindOf(entry))?.label ?? '图片'}`,
                    kind: 'image' as const,
                  })),
                  index: items.findIndex((entry) => entry.id === menu.item.id),
                });
              },
            },
            { label: '查看大图', onClick: () => setViewing(menu.item) },
            { label: '', onClick: () => undefined, separator: true },
            // 单独导出：PNG / JPEG / WebP（与原格式相同时原样复制）
            ...IMAGE_EXPORT_FORMATS.map(({ format, label }) => ({
              label: `导出为 ${label}…`,
              disabled: !workPath || /^data:/i.test(menu.item.path),
              onClick: () => {
                if (!workPath) return;
                void exportMediaWithToast(
                  {
                    sourcePath: joinWorkPath(workPath, menu.item.path),
                    format,
                    title: `${name}-${kinds.find((option) => option.kind === groupKindOf(menu.item))?.label ?? '图片'}`,
                  },
                  toast
                );
              },
            })),
            { label: '', onClick: () => undefined, separator: true },
            { label: '删除', danger: true, onClick: () => void remove(menu.item) },
          ]}
        />
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
