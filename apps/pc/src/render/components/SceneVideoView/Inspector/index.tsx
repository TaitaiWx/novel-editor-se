/**
 * 画布右侧的检查器：编辑选中的节点（场景 / 人物 / 镜头 / 样片）。没有选中节点时不显示。
 */
import React, { useId, useMemo, useState } from 'react';
import { VscArrowLeft, VscArrowRight, VscClose, VscTrash } from 'react-icons/vsc';
import {
  SHOT_DURATION_MAX,
  SHOT_DURATION_MIN,
  SHOT_SIZES,
  type Shot,
  type ShotSize,
} from '@novel-editor/video';
import type { VideoTask } from '@/render/types/ai-api';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import Tooltip from '../../Tooltip';
import CharacterAvatar from '../../CharacterAvatar';
import { MediaImage } from '../../EntityGallery/MediaTile';
import MediaPlayer, { type ReadSceneFile } from '../media/MediaPlayer';
import TaskList from '../media/TaskList';
import KeyframeSection, { type KeyframeSectionProps } from './KeyframeSection';
import {
  SCENE_VIDEO_STYLES,
  animaticFiles,
  chosenVersionFor,
  shotNumber,
  shotVersionsFromFiles,
  type SceneVideoState,
} from '../sceneVideoState';
import styles from './styles.module.scss';

type Update = (updater: (prev: SceneVideoState) => SceneVideoState) => void;

const Panel: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <aside className={styles.panel} aria-label={`检查器：${title}`} data-testid="scene-inspector">
    <header className={styles.head}>
      <h2 className={styles.title}>{title}</h2>
      <Tooltip content="关闭（Esc）">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="关闭检查器"
          onClick={onClose}
        >
          <VscClose />
        </button>
      </Tooltip>
    </header>
    <div className={styles.scroll}>{children}</div>
  </aside>
);

// ─── 场景 ───────────────────────────────────────────────────────────────

export interface SceneInspectorProps {
  state: SceneVideoState;
  onChange: Update;
  characters: readonly { name: string; avatar?: string }[];
  loreTitles: readonly string[];
  pendingSeed: string | null;
  onApplySeed: () => void;
  onDismissSeed: () => void;
  onClose: () => void;
}

export const SceneInspector: React.FC<SceneInspectorProps> = ({
  state,
  onChange,
  characters,
  loreTitles,
  pendingSeed,
  onApplySeed,
  onDismissSeed,
  onClose,
}) => {
  const idPrefix = `scene-inspector-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const avatarByName = useMemo(
    () => new Map(characters.map((item) => [item.name, item.avatar])),
    [characters]
  );
  const addable = characters.filter((item) => !state.characters.includes(item.name));
  const isCustomStyle = !(SCENE_VIDEO_STYLES as readonly string[]).includes(state.style);
  return (
    <Panel title="场景" onClose={onClose}>
      {pendingSeed !== null && (
        <div className={styles.seedHint} role="status">
          <span>已载入上次保存的分镜。这次选中的文字与保存的场景正文不同。</span>
          <span className={styles.inlineActions}>
            <button type="button" className={styles.linkButton} onClick={onApplySeed}>
              用选中的文字替换
            </button>
            <button type="button" className={styles.linkButton} onClick={onDismissSeed}>
              保持不变
            </button>
          </span>
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-source`}>
          场景正文
          <span className={styles.labelMeta}>
            {state.chapter} · {state.scene}
          </span>
        </label>
        <textarea
          id={`${idPrefix}-source`}
          className={styles.textarea}
          rows={12}
          value={state.sourceText}
          placeholder="粘贴或改写这一场的正文，分镜按它来拆"
          onChange={(event) => {
            const sourceText = event.target.value;
            onChange((prev) => ({ ...prev, sourceText }));
          }}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-location`}>
          地点
        </label>
        <input
          id={`${idPrefix}-location`}
          className={styles.input}
          list={`${idPrefix}-lore`}
          value={state.location}
          placeholder={loreTitles.length ? '从设定中选择，或直接输入' : '例如：青石镇 · 镇口老槐树'}
          onChange={(event) => {
            const location = event.target.value;
            onChange((prev) => ({ ...prev, location }));
          }}
        />
        <datalist id={`${idPrefix}-lore`}>
          {loreTitles.map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>出场人物</span>
        <div className={styles.chips}>
          {state.characters.map((name) => (
            <span key={name} className={styles.chip}>
              <CharacterAvatar name={name} src={avatarByName.get(name) ?? null} size={20} />
              {name}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`移除人物 ${name}`}
                onClick={() =>
                  onChange((prev) => ({
                    ...prev,
                    characters: prev.characters.filter((item) => item !== name),
                  }))
                }
              >
                <VscClose />
              </button>
            </span>
          ))}
          {state.characters.length === 0 && (
            <span className={styles.muted}>正文里没有识别到人物库中的人物</span>
          )}
        </div>
        {addable.length > 0 && (
          <Select
            block
            size="lg"
            aria-label="添加人物"
            placeholder="＋ 添加人物"
            value=""
            options={addable.map((item) => ({ value: item.name, label: item.name }))}
            onChange={(name) => {
              if (!name) return;
              onChange((prev) => ({ ...prev, characters: [...prev.characters, name] }));
            }}
          />
        )}
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-style`}>
          自定义风格
        </label>
        <input
          id={`${idPrefix}-style`}
          className={styles.input}
          value={isCustomStyle ? state.style : ''}
          placeholder="例如：赛璐璐动画、胶片颗粒（留空用上方预设）"
          onChange={(event) => {
            const style = event.target.value;
            onChange((prev) => ({ ...prev, style: style || SCENE_VIDEO_STYLES[0] }));
          }}
        />
      </div>
    </Panel>
  );
};

// ─── 人物 ───────────────────────────────────────────────────────────────

export const CharacterInspector: React.FC<{
  name: string;
  avatar?: string;
  turnaround?: string;
  referenceCount: number;
  workPath: string | null;
  onRemove: () => void;
  onClose: () => void;
}> = ({ name, avatar, turnaround, referenceCount, workPath, onRemove, onClose }) => (
  <Panel title="人物" onClose={onClose}>
    <div className={styles.characterHead}>
      <CharacterAvatar name={name} src={avatar ?? null} size={40} />
      <strong>{name}</strong>
    </div>
    {turnaround && (
      <div className={styles.turnaround}>
        <MediaImage path={turnaround} workPath={workPath} alt={`${name} 的三视图`} />
      </div>
    )}
    <p className={styles.muted}>
      {referenceCount > 0
        ? `生成这一场的镜头时，自动带上 ${name} 的 ${referenceCount} 张参考图（三视图优先），外貌、服装等人物设计也会自动写进提示词。`
        : `${name} 还没有三视图或形象图。在人物详情 → 图集里上传或生成一张三视图，生成的画面更容易保持一致。`}
    </p>
    <button type="button" className={styles.button} onClick={onRemove}>
      从这一场移除
    </button>
  </Panel>
);

// ─── 镜头 ───────────────────────────────────────────────────────────────

export interface ShotInspectorProps {
  state: SceneVideoState;
  shot: Shot;
  index: number;
  files: readonly string[];
  tasks: readonly VideoTask[];
  readFile: ReadSceneFile;
  onChange: Update;
  onUpdateShot: (patch: Partial<Omit<Shot, 'id'>>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onCancelTask: (id: string) => void;
  onRetryTask: (id: string) => void;
  /** 在参考窗格（编辑器旁边）打开某个成片 */
  onOpenBeside?: (fileName: string) => void;
  /** 首帧 / 预演（可选步骤） */
  keyframe?: Omit<KeyframeSectionProps, 'label'>;
  onClose: () => void;
}

export const ShotInspector: React.FC<ShotInspectorProps> = ({
  state,
  shot,
  index,
  files,
  tasks,
  readFile,
  onChange,
  onUpdateShot,
  onMove,
  onRemove,
  onCancelTask,
  onRetryTask,
  onOpenBeside,
  keyframe,
  onClose,
}) => {
  const label = `镜头 ${index + 1}`;
  const total = state.storyboard.shots.length;
  const number = shotNumber(shot);
  const versions = number === null ? [] : shotVersionsFromFiles(files, number);
  const chosen = chosenVersionFor(state, shot, files);
  const [preview, setPreview] = useState<string | null>(null);
  const previewFile =
    preview && versions.some((item) => item.fileName === preview) ? preview : chosen;
  const shotTasks = useMemo(
    () => (number === null ? [] : tasks.filter((task) => task.shotIndex === number)),
    [number, tasks]
  );
  const positionByNumber = useMemo(
    () => new Map(number === null ? [] : [[number, index + 1] as const]),
    [index, number]
  );
  return (
    <Panel title={label} onClose={onClose}>
      <div className={styles.inlineActions}>
        <Tooltip content="前移（与上一个镜头交换）">
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`前移${label}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <VscArrowLeft />
          </button>
        </Tooltip>
        <Tooltip content="后移（与下一个镜头交换）">
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`后移${label}`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <VscArrowRight />
          </button>
        </Tooltip>
        <span className={styles.spacer} />
        <Tooltip content="删除镜头（已生成的成片仍保留在资料里）">
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`删除${label}`}
            onClick={onRemove}
          >
            <VscTrash />
          </button>
        </Tooltip>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>景别</span>
          <Select<ShotSize>
            block
            size="lg"
            aria-label={`${label} 景别`}
            value={shot.shotSize}
            options={SHOT_SIZES.map((size) => ({ value: size, label: size }))}
            onChange={(shotSize) => onUpdateShot({ shotSize })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>时长（秒）</span>
          <NumberInput
            block
            size="lg"
            aria-label={`${label} 时长（秒）`}
            min={SHOT_DURATION_MIN}
            max={SHOT_DURATION_MAX}
            step={1}
            suffix="秒"
            value={shot.durationSec}
            onChange={(durationSec) => onUpdateShot({ durationSec })}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面描述</span>
        <textarea
          className={styles.textarea}
          aria-label={`${label} 画面描述`}
          rows={5}
          value={shot.description}
          placeholder="主体 + 动作 + 环境 + 光线"
          onChange={(event) => onUpdateShot({ description: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>运镜</span>
        <input
          className={styles.input}
          aria-label={`${label} 运镜`}
          value={shot.camera ?? ''}
          placeholder="例如：缓慢推近"
          onChange={(event) => onUpdateShot({ camera: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>台词 / 旁白</span>
        <input
          className={styles.input}
          aria-label={`${label} 台词`}
          value={shot.dialogue ?? ''}
          placeholder="可选，仅供剪辑参考"
          onChange={(event) => onUpdateShot({ dialogue: event.target.value || undefined })}
        />
      </label>

      {keyframe && <KeyframeSection label={label} {...keyframe} />}

      {versions.length > 0 && (
        <div className={styles.field}>
          <span className={styles.labelRow}>
            <span className={styles.label}>版本（样片使用「选用」的版本）</span>
            {onOpenBeside && previewFile && (
              <Tooltip content="在编辑器旁边打开，边看边写">
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onOpenBeside(previewFile)}
                >
                  在旁边看
                </button>
              </Tooltip>
            )}
          </span>
          <MediaPlayer
            readFile={readFile}
            fileName={previewFile}
            caption={previewFile ?? undefined}
            testId="scene-video-preview"
          />
          <div className={styles.versionChips} role="list" aria-label={`${label} 的版本`}>
            {versions.map((version) => {
              const isChosen = version.fileName === chosen;
              return (
                <span
                  key={version.fileName}
                  role="listitem"
                  className={`${styles.versionChip} ${previewFile === version.fileName ? styles.versionChipActive : ''}`}
                >
                  <button
                    type="button"
                    className={styles.versionButton}
                    aria-label={`预览 ${label} v${version.version}`}
                    onClick={() => setPreview(version.fileName)}
                  >
                    v{version.version}
                    {isChosen && <span className={styles.chosenMark}>选用</span>}
                  </button>
                  {!isChosen && (
                    <button
                      type="button"
                      className={styles.versionButton}
                      aria-label={`选用 ${label} v${version.version}`}
                      onClick={() =>
                        onChange((prev) => ({
                          ...prev,
                          chosenVersions: { ...prev.chosenVersions, [shot.id]: version.fileName },
                        }))
                      }
                    >
                      选用
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {shotTasks.length > 0 && (
        <div className={styles.field}>
          <span className={styles.label}>生成记录</span>
          <TaskList
            tasks={shotTasks}
            positionByNumber={positionByNumber}
            onCancel={onCancelTask}
            onRetry={onRetryTask}
          />
        </div>
      )}
    </Panel>
  );
};

// ─── 样片 ───────────────────────────────────────────────────────────────

export const OutputInspector: React.FC<{
  files: readonly string[];
  readFile: ReadSceneFile;
  stitchSupported: boolean;
  stitchProgress: number | null;
  canStitch: boolean;
  outlineLinked: boolean;
  onStitch: () => void;
  onRevealFile: (fileName: string) => void;
  /** 在参考窗格（编辑器旁边）打开 */
  onOpenBeside?: (fileName: string) => void;
  onClose: () => void;
}> = ({
  files,
  readFile,
  stitchSupported,
  stitchProgress,
  canStitch,
  outlineLinked,
  onStitch,
  onRevealFile,
  onOpenBeside,
  onClose,
}) => {
  const animatics = animaticFiles(files);
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked && animatics.includes(picked) ? picked : (animatics[0] ?? null);
  return (
    <Panel title="样片" onClose={onClose}>
      <MediaPlayer
        readFile={readFile}
        fileName={current}
        caption={current ?? undefined}
        emptyText="全部镜头生成后会自动合成样片"
      />
      <p className={styles.muted}>
        全部镜头都有成片后自动合成（用每个镜头「选用」的版本）；想先看节奏，可以现在合成，还没有成片的镜头用占位卡代替。
      </p>
      <Tooltip
        content={
          stitchSupported ? '用当前选用的版本合成一条样片，保存到资料' : '当前环境不支持 WebCodecs'
        }
      >
        <button
          type="button"
          className={styles.button}
          disabled={!stitchSupported || !canStitch || stitchProgress !== null}
          onClick={onStitch}
        >
          {stitchProgress !== null ? `合成中 ${Math.round(stitchProgress)}%` : '现在合成样片'}
        </button>
      </Tooltip>
      {animatics.length > 0 && (
        <ul className={styles.fileList} aria-label="样片">
          {animatics.map((fileName) => (
            <li key={fileName}>
              <button
                type="button"
                className={`${styles.linkButton} ${current === fileName ? styles.linkButtonActive : ''}`}
                onClick={() => setPicked(fileName)}
              >
                {fileName}
              </button>
              <Tooltip content="在左侧资料中定位这个文件">
                <button
                  type="button"
                  className={styles.linkButton}
                  aria-label={`在资料中定位 ${fileName}`}
                  onClick={() => onRevealFile(fileName)}
                >
                  定位
                </button>
              </Tooltip>
              {onOpenBeside && (
                <Tooltip content="在编辑器旁边打开，边看边写">
                  <button
                    type="button"
                    className={styles.linkButton}
                    aria-label={`在旁边看 ${fileName}`}
                    onClick={() => onOpenBeside(fileName)}
                  >
                    在旁边看
                  </button>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.muted}>
        {outlineLinked
          ? '已在本章章纲里记录这一场的视频（分镜表与成片路径）。'
          : '第一个镜头生成后，会自动在本章章纲里记录这一场的视频。'}
      </p>
    </Panel>
  );
};
