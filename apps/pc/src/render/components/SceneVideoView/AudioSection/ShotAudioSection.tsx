/**
 * 镜头检查器「对白 / 音效」分区：
 * - 对白：说话人（这一场的出场人物 + 旁白）、台词、情绪（可选）、开始时间（可选，默认紧接上一句），
 *   「生成配音」（单句 / 全部）与试听；改了台词后旧配音作废，需要重新生成
 * - 音效：描述（交给能生成声音的视频模型）或本地文件（复制到 资料/音效/，混进样片）、时间点、音量
 */
import React from 'react';
import { VscAdd, VscClose, VscTrash } from 'react-icons/vsc';
import {
  DIALOGUE_MAX_LINES,
  NARRATOR,
  SFX_MAX_CUES,
  VOICE_EMOTIONS,
  createLineId,
  speakerLabel,
  type DialogueLine,
  type SfxCue,
  type Shot,
} from '@novel-editor/video';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import Tooltip from '../../Tooltip';
import AudioPreview from './AudioPreview';
import styles from './styles.module.scss';

export interface ShotAudioSectionProps {
  shot: Shot;
  /** 「镜头 N」 */
  label: string;
  /** 这一场的出场人物（说话人候选） */
  speakers: readonly string[];
  onUpdateShot: (patch: Partial<Omit<Shot, 'id'>>) => void;
  /** 生成配音；lineIds 省略时为全部对白 */
  onSynthesize: (lineIds?: string[]) => void;
  /** 正在生成配音的对白 id */
  busyLineIds: ReadonlySet<string>;
  /** 已配置配音服务 */
  canSynthesize: boolean;
  /** 读取场景目录内的文件（配音） */
  readSceneFile: (fileName: string) => Promise<Uint8Array>;
  /** 读取作品内的音效文件 */
  loadWorkAudio: (relativePath: string) => Promise<Uint8Array>;
  onImportSfx: () => Promise<string | null>;
}

const NO_EMOTION = '__none__';

function emotionOptions(current: string | undefined) {
  const options = [
    { value: NO_EMOTION, label: '不指定情绪' },
    ...VOICE_EMOTIONS.map((item) => ({ value: item.value, label: item.label })),
  ];
  // AI 返回的其他情绪文字也保留为一个选项
  if (current && !VOICE_EMOTIONS.some((item) => item.value === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

const ShotAudioSection: React.FC<ShotAudioSectionProps> = ({
  shot,
  label,
  speakers,
  onUpdateShot,
  onSynthesize,
  busyLineIds,
  canSynthesize,
  readSceneFile,
  loadWorkAudio,
  onImportSfx,
}) => {
  const lines = shot.dialogue ?? [];
  const cues = shot.sfx ?? [];
  const speakerOptions = Array.from(
    new Set([...speakers, ...(shot.characters ?? []), ...lines.map((line) => line.speaker)])
  )
    .filter((name) => name !== NARRATOR)
    .map((name) => ({ value: name, label: name }))
    .concat([{ value: NARRATOR, label: speakerLabel(NARRATOR) }]);

  const setLines = (next: DialogueLine[]) =>
    onUpdateShot({ dialogue: next.length ? next : undefined });
  const updateLine = (id: string, patch: Partial<DialogueLine>, keepAudio = false) =>
    setLines(
      lines.map((line) => {
        if (line.id !== id) return line;
        const next: DialogueLine = { ...line, ...patch };
        // 台词 / 说话人 / 情绪变了：旧配音作废（文件保留在资料里，重新生成时覆盖）
        if (!keepAudio) {
          delete next.audioFile;
          delete next.audioDurationSec;
        }
        return next;
      })
    );
  const addLine = () => {
    const speaker = shot.characters?.[0] ?? speakers[0] ?? NARRATOR;
    setLines([...lines, { id: createLineId(lines.map((line) => line.id)), speaker, text: '' }]);
  };

  const setCues = (next: SfxCue[]) => onUpdateShot({ sfx: next.length ? next : undefined });
  const updateCue = (id: string, patch: Partial<SfxCue>) =>
    setCues(cues.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
  const chooseCueFile = async (id: string) => {
    const path = await onImportSfx();
    if (path) updateCue(id, { path });
  };

  const pending = lines.filter((line) => line.text.trim() && !line.audioFile).length;
  const anyBusy = busyLineIds.size > 0;

  return (
    <>
      <section className={styles.section} aria-label={`${label} 对白`} data-testid="shot-dialogue">
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>对白（{lines.length}）</h3>
          {lines.length > 0 && (
            <Tooltip
              content={
                canSynthesize
                  ? '为这个镜头还没有配音的对白生成配音（已有配音的保留）'
                  : '先在设置中心配置配音服务'
              }
            >
              <button
                type="button"
                className={styles.linkButton}
                disabled={!canSynthesize || anyBusy || pending === 0}
                onClick={() =>
                  onSynthesize(
                    lines
                      .filter((line) => line.text.trim() && !line.audioFile)
                      .map((line) => line.id)
                  )
                }
              >
                {anyBusy ? '配音中…' : `全部生成配音${pending ? `（${pending}）` : ''}`}
              </button>
            </Tooltip>
          )}
        </div>
        {lines.length === 0 && (
          <p className={styles.muted}>这个镜头没有对白。AI 拆分镜时会从正文里提取台词与说话人。</p>
        )}
        <ol className={styles.list}>
          {lines.map((line, index) => {
            const busy = busyLineIds.has(line.id);
            const lineLabel = `${label} 第 ${index + 1} 句`;
            return (
              <li key={line.id} className={styles.card} data-testid="dialogue-line">
                <div className={styles.cardHead}>
                  <Select
                    block
                    aria-label={`${lineLabel} 说话人`}
                    value={line.speaker}
                    options={speakerOptions}
                    onChange={(speaker) => updateLine(line.id, { speaker })}
                  />
                  <Select
                    aria-label={`${lineLabel} 情绪`}
                    value={line.emotion ?? NO_EMOTION}
                    options={emotionOptions(line.emotion)}
                    onChange={(emotion) =>
                      updateLine(line.id, { emotion: emotion === NO_EMOTION ? undefined : emotion })
                    }
                  />
                  <Tooltip content="删除这句对白">
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`删除${lineLabel}`}
                      onClick={() => setLines(lines.filter((item) => item.id !== line.id))}
                    >
                      <VscTrash />
                    </button>
                  </Tooltip>
                </div>
                <textarea
                  className={styles.textarea}
                  aria-label={`${lineLabel} 台词`}
                  rows={2}
                  value={line.text}
                  placeholder="台词"
                  onChange={(event) => updateLine(line.id, { text: event.target.value })}
                />
                <div className={styles.row}>
                  <NumberInput
                    aria-label={`${lineLabel} 开始时间（秒）`}
                    allowEmpty
                    min={0}
                    max={15}
                    step={0.5}
                    precision={1}
                    suffix="秒"
                    placeholder="自动"
                    value={line.startSec ?? null}
                    onChange={(startSec) => updateLine(line.id, { startSec }, true)}
                    onClear={() => updateLine(line.id, { startSec: undefined }, true)}
                  />
                  <Tooltip
                    content={
                      canSynthesize
                        ? '用配音服务朗读这句台词，保存到这一场的资料目录'
                        : '先在设置中心配置配音服务'
                    }
                  >
                    <button
                      type="button"
                      className={line.audioFile ? styles.button : styles.buttonPrimary}
                      aria-label={`为${lineLabel}生成配音`}
                      disabled={!canSynthesize || busy || !line.text.trim()}
                      onClick={() => onSynthesize([line.id])}
                    >
                      {busy ? '配音中…' : line.audioFile ? '重新配音' : '生成配音'}
                    </button>
                  </Tooltip>
                  {line.audioFile && (
                    <span className={styles.statusOk}>
                      已配音
                      {line.audioDurationSec ? ` · ${line.audioDurationSec.toFixed(1)}s` : ''}
                    </span>
                  )}
                </div>
                <AudioPreview
                  source={line.audioFile ?? null}
                  load={readSceneFile}
                  label={`试听${lineLabel}`}
                  testId="dialogue-audio"
                />
              </li>
            );
          })}
        </ol>
        {lines.length < DIALOGUE_MAX_LINES && (
          <button type="button" className={styles.button} onClick={addLine}>
            <VscAdd /> 添加对白
          </button>
        )}
      </section>

      <section className={styles.section} aria-label={`${label} 音效`} data-testid="shot-sfx">
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>音效（{cues.length}）</h3>
        </div>
        <ul className={styles.list}>
          {cues.map((cue, index) => {
            const cueLabel = `${label} 音效 ${index + 1}`;
            return (
              <li key={cue.id} className={styles.card} data-testid="sfx-cue">
                <div className={styles.cardHead}>
                  <input
                    className={styles.input}
                    aria-label={`${cueLabel} 描述`}
                    value={cue.prompt ?? ''}
                    placeholder="例如：木门吱呀声"
                    onChange={(event) =>
                      updateCue(cue.id, { prompt: event.target.value || undefined })
                    }
                  />
                  <Tooltip content="删除这个音效">
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`删除${cueLabel}`}
                      onClick={() => setCues(cues.filter((item) => item.id !== cue.id))}
                    >
                      <VscTrash />
                    </button>
                  </Tooltip>
                </div>
                <div className={styles.row}>
                  <span className={styles.fileName}>
                    {cue.path ? (cue.path.split('/').pop() ?? cue.path) : '没有音效文件'}
                  </span>
                  <Tooltip content="选择本地音效（混进样片），复制到 资料/音效/">
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => void chooseCueFile(cue.id)}
                    >
                      {cue.path ? '更换' : '选择文件'}
                    </button>
                  </Tooltip>
                  {cue.path && (
                    <Tooltip content="不用音效文件">
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`移除${cueLabel}的文件`}
                        onClick={() => updateCue(cue.id, { path: undefined })}
                      >
                        <VscClose />
                      </button>
                    </Tooltip>
                  )}
                </div>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span className={styles.label}>时间点</span>
                    <NumberInput
                      block
                      aria-label={`${cueLabel} 时间点（秒）`}
                      min={0}
                      max={15}
                      step={0.5}
                      precision={1}
                      suffix="秒"
                      value={cue.atSec}
                      onChange={(atSec) => updateCue(cue.id, { atSec })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>音量</span>
                    <NumberInput
                      block
                      aria-label={`${cueLabel} 音量`}
                      min={0}
                      max={100}
                      step={5}
                      suffix="%"
                      value={Math.round(cue.volume * 100)}
                      onChange={(value) => updateCue(cue.id, { volume: value / 100 })}
                    />
                  </label>
                </div>
                <AudioPreview
                  source={cue.path ?? null}
                  load={loadWorkAudio}
                  label={`试听${cueLabel}`}
                />
              </li>
            );
          })}
        </ul>
        {cues.length < SFX_MAX_CUES && (
          <button
            type="button"
            className={styles.button}
            onClick={() =>
              setCues([
                ...cues,
                {
                  id: createLineId(
                    cues.map((cue) => cue.id),
                    's'
                  ),
                  atSec: 0,
                  volume: 0.8,
                },
              ])
            }
          >
            <VscAdd /> 添加音效
          </button>
        )}
      </section>
    </>
  );
};

export default ShotAudioSection;
