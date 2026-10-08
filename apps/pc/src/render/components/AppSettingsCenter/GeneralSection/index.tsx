import React from 'react';
import { AiOutlineSetting } from 'react-icons/ai';
import { type SettingsDraft, THOUSAND_CHAR_MARKER_STEP_OPTIONS } from '../../../utils/appSettings';
import Select from '../../Select';
import Switch from '../../Switch';
import type { SystemProfileInfo } from '../constants';
import type { SettingsFormApi } from '../useSettingsForm';
import { SettingsGroup, SettingsRow, SettingsSection } from '../layout';
import styles from './styles.module.scss';

interface GeneralSectionProps {
  settings: SettingsDraft;
  setGeneral: SettingsFormApi['setGeneral'];
  systemProfile: SystemProfileInfo | null;
}

type BooleanGeneralKey =
  | 'collapseRightPanelOnStartup'
  | 'showStatusBar'
  | 'showThousandCharMarkers'
  | 'showFileSizes'
  | 'openChangelogAfterUpdate';

interface SwitchRowDef {
  key: BooleanGeneralKey;
  label: string;
  description: string;
}

const LAYOUT_ROWS: readonly SwitchRowDef[] = [
  {
    key: 'collapseRightPanelOnStartup',
    label: '启动时默认折叠右侧辅助面板',
    description: '启动时先收起右侧辅助区，需要时再展开。',
  },
  {
    key: 'showStatusBar',
    label: '显示状态栏',
    description: '在窗口底部显示字数、编码和版本入口等信息。',
  },
  {
    key: 'showFileSizes',
    label: '显示文件大小',
    description: '在资源树中显示文件大小。关闭后可减轻大目录的加载压力。',
  },
  {
    key: 'openChangelogAfterUpdate',
    label: '更新后自动打开更新日志',
    description: '应用更新完成后，自动打开本次版本说明。',
  },
];

/** 通用设置分区 */
const GeneralSection: React.FC<GeneralSectionProps> = ({ settings, setGeneral, systemProfile }) => {
  const switchRow = (row: SwitchRowDef) => (
    <SettingsRow key={row.key} label={row.label} description={row.description}>
      <Switch
        aria-label={row.label}
        checked={settings.general[row.key]}
        onChange={(next) => setGeneral(row.key, next)}
      />
    </SettingsRow>
  );

  return (
    <SettingsSection
      icon={<AiOutlineSetting />}
      title="通用设置"
      description="调整启动方式与界面显示。设置会保存在当前设备上。"
    >
      <SettingsGroup title="界面">{LAYOUT_ROWS.map(switchRow)}</SettingsGroup>

      <SettingsGroup title="千字进度标记">
        {switchRow({
          key: 'showThousandCharMarkers',
          label: '显示千字进度标记',
          description: '在编辑器正文左侧贴边显示每千字进度，不额外占用行号栏宽度。',
        })}
        <SettingsRow
          label="千字进度标记阈值"
          description="控制正文里每隔多少字显示一个进度标记。推荐 1000，长章节可调到 2000。"
          control="field"
          align="start"
        >
          <Select
            block
            size="lg"
            aria-label="千字进度标记阈值"
            value={String(settings.general.thousandCharMarkerStep)}
            options={THOUSAND_CHAR_MARKER_STEP_OPTIONS.map((value) => ({
              value: String(value),
              label: `每 ${value} 字显示一个标记`,
            }))}
            onChange={(value) => setGeneral('thousandCharMarkerStep', Number(value))}
          />
        </SettingsRow>
      </SettingsGroup>

      {systemProfile && (
        <SettingsGroup
          title="运行性能"
          meta={
            <span
              className={`${styles.statusBadge} ${systemProfile.isLowSpec ? styles.lowSpec : styles.standard}`}
            >
              {systemProfile.isLowSpec ? '低配模式' : '标准'}
            </span>
          }
        >
          <SettingsRow
            label={`运行性能模式${systemProfile.isLowSpec ? '：低配自动适配中' : '：标准模式'}`}
            description={
              systemProfile.isLowSpec
                ? '已自动关闭硬件加速、延后非关键任务，让老电脑也能流畅启动。无需手动设置。'
                : '当前设备性能充足，按标准模式运行。'
            }
          />
          <SettingsRow label="CPU">
            <span className={styles.specValue}>
              {systemProfile.cpuCount} 逻辑核
              {systemProfile.cpuSpeedMHz > 0
                ? ` · ${(systemProfile.cpuSpeedMHz / 1000).toFixed(1)}GHz`
                : ''}
            </span>
          </SettingsRow>
          <SettingsRow label="内存">
            <span className={styles.specValue}>
              {systemProfile.totalMemoryGB > 0 ? `${systemProfile.totalMemoryGB} GB` : '未知'}
            </span>
          </SettingsRow>
          {systemProfile.isLowSpec && systemProfile.reasons.length > 0 && (
            <SettingsRow label="触发原因">
              <span className={styles.specValue}>{systemProfile.reasons.join('；')}</span>
            </SettingsRow>
          )}
        </SettingsGroup>
      )}
    </SettingsSection>
  );
};

export default GeneralSection;
