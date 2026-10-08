/**
 * 设置中心「正文结构」：章 / 幕 / 场的识别规则（中文 / English / 数字序号预设 + 自定义正则）
 *
 * 规则保存在当前项目（`ne init` 项目写 .novel-editor/config.json 的 structure 字段，普通文件夹写
 * .novel-editor/structure.json），CLI `ne structure` 读写同一份；保存后打开的编辑器、目录、卷纲立即按新规则刷新。
 */
import React, { useMemo, useState } from 'react';
import { VscAdd, VscListTree, VscTrash } from 'react-icons/vsc';
import {
  matchStructureLine,
  STRUCTURE_PRESET_IDS,
  STRUCTURE_PRESET_INFO,
  type StructureLineKind,
} from '@novel-editor/core/structure-rules';
import Checkbox from '../../Checkbox';
import Select from '../../Select';
import Switch from '../../Switch';
import Tooltip from '../../Tooltip';
import { SettingsGroup, SettingsRow, SettingsSection } from '../layout';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';
import { useStructureSettings } from './useStructureSettings';

const KIND_LABELS: Record<StructureLineKind, string> = { chapter: '章', act: '幕', scene: '场' };

const KIND_OPTIONS = [
  { value: 'chapter' as const, label: '章' },
  { value: 'act' as const, label: '幕' },
  { value: 'scene' as const, label: '场' },
];

const SAMPLE_TEST = [
  '第一章 离港',
  'Chapter 1: The Harbor',
  'Act II',
  '=== Dawn ===',
  '清晨，林舟背起行囊。',
].join('\n');

interface StructureSectionProps {
  folderPath: string | null;
}

const StructureSection: React.FC<StructureSectionProps> = ({ folderPath }) => {
  const api = useStructureSettings(folderPath);
  const [testText, setTestText] = useState(SAMPLE_TEST);
  const { draft } = api;

  const testResults = useMemo(
    () =>
      testText
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(0, 50)
        .map((line) => ({ line, match: matchStructureLine(line, api.previewRules) })),
    [api.previewRules, testText]
  );

  return (
    <SettingsSection
      icon={<VscListTree />}
      title="正文结构"
      description={
        <>
          不用 # 标题时，编辑器、目录、卷纲与场景视频按这些规则识别 章 / 幕 /
          场。规则跟随项目自动保存（软件内部数据，不需要手动处理），命令行 <code>ne structure</code>{' '}
          读写同一份。
        </>
      }
    >
      {!folderPath && (
        <div className={sharedStyles.notice}>先打开一个项目文件夹，再设置它的正文结构规则。</div>
      )}
      {folderPath && api.loading && <div className={sharedStyles.notice}>正在读取…</div>}
      {folderPath && api.loadError && (
        <div className={styles.error} role="alert">
          读取失败：{api.loadError}
        </div>
      )}

      {draft && (
        <>
          <SettingsGroup title="预设" aria-label="预设">
            {STRUCTURE_PRESET_IDS.map((id) => {
              const preset = STRUCTURE_PRESET_INFO[id];
              return (
                <SettingsRow
                  key={id}
                  label={preset.label}
                  description={preset.description}
                  extra={
                    <div className={styles.examples}>
                      {preset.examples.map((example) => (
                        <code key={example}>{example}</code>
                      ))}
                    </div>
                  }
                >
                  <Switch
                    checked={draft.presets.includes(id)}
                    onChange={(checked) => api.togglePreset(id, checked)}
                    aria-label={`${preset.label} 规则`}
                  />
                </SettingsRow>
              );
            })}
          </SettingsGroup>

          <SettingsGroup
            title="自定义规则"
            description={
              <>
                正则匹配去掉首尾空白后的整行，例如 <code>^=== (.+) ===$</code>{' '}
                识别为场。自定义规则优先于预设。
              </>
            }
          >
            <div className={styles.rules}>
              {draft.custom.length === 0 && <div className={styles.muted}>还没有自定义规则</div>}
              {draft.custom.map((rule, index) => (
                <div key={`${rule.id}-${index}`} className={styles.ruleRow}>
                  <div className={styles.ruleFields}>
                    <Select
                      size="sm"
                      value={rule.kind}
                      options={KIND_OPTIONS}
                      onChange={(kind) => api.updateRule(index, { kind })}
                      aria-label={`规则 ${index + 1} 类型`}
                    />
                    <input
                      className={`${sharedStyles.input} ${styles.patternInput}`}
                      value={rule.pattern}
                      spellCheck={false}
                      placeholder="^=== (.+) ===$"
                      aria-label={`规则 ${index + 1} 正则`}
                      aria-invalid={Boolean(api.ruleErrors[index]) || undefined}
                      onChange={(event) => api.updateRule(index, { pattern: event.target.value })}
                    />
                    <Checkbox
                      size="sm"
                      checked={rule.flags === 'i'}
                      onChange={(checked) =>
                        api.updateRule(index, { flags: checked ? 'i' : undefined })
                      }
                      label="忽略大小写"
                    />
                    <Tooltip content="删除规则">
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => api.removeRule(index)}
                        aria-label={`删除规则 ${index + 1}`}
                      >
                        <VscTrash />
                      </button>
                    </Tooltip>
                  </div>
                  {api.ruleErrors[index] && rule.pattern && (
                    <div className={styles.error}>{api.ruleErrors[index]}</div>
                  )}
                </div>
              ))}
              <button type="button" className={styles.addButton} onClick={api.addRule}>
                <VscAdd />
                <span>添加规则</span>
              </button>
            </div>
          </SettingsGroup>

          <SettingsGroup title="试一试" description="输入几行正文，右侧即时显示识别结果。">
            <div className={styles.testBox}>
              <textarea
                className={styles.testInput}
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                aria-label="测试文本"
                spellCheck={false}
                rows={5}
              />
              <ul className={styles.testResults} aria-label="识别结果">
                {testResults.map((item, index) => (
                  <li key={`${index}-${item.line}`}>
                    <span
                      className={`${styles.kindBadge} ${item.match ? styles[item.match.kind] : ''}`}
                    >
                      {item.match ? KIND_LABELS[item.match.kind] : '正文'}
                    </span>
                    <span className={styles.testLine}>{item.line.trim()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </SettingsGroup>

          <div className={sharedStyles.actions}>
            <button
              type="button"
              className={sharedStyles.primaryButton}
              onClick={() => void api.save()}
              disabled={!api.canSave || api.status.kind === 'saving'}
            >
              {api.status.kind === 'saving' ? '保存中…' : '保存'}
            </button>
            {api.dirty && (
              <button type="button" className={sharedStyles.secondaryButton} onClick={api.reset}>
                还原
              </button>
            )}
            {api.status.kind === 'saved' && !api.dirty && (
              <span className={styles.saved} role="status">
                已保存，打开的文件已按新规则显示
              </span>
            )}
            {api.status.kind === 'error' && (
              <span className={styles.error} role="alert">
                {api.status.message}
              </span>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
};

export default StructureSection;
