import React from 'react';
import { AiOutlineSetting } from 'react-icons/ai';
import { type SettingsDraft, THOUSAND_CHAR_MARKER_STEP_OPTIONS } from '../../../utils/appSettings';
import type { SystemProfileInfo } from '../constants';
import type { SettingsFormApi } from '../useSettingsForm';
import UpdateGroup from '../UpdateGroup';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface GeneralSectionProps {
  settings: SettingsDraft;
  setGeneral: SettingsFormApi['setGeneral'];
  systemProfile: SystemProfileInfo | null;
}

/** 通用设置分区 */
const GeneralSection: React.FC<GeneralSectionProps> = ({ settings, setGeneral, systemProfile }) => (
  <div className={sharedStyles.panel}>
    <h4>
      <AiOutlineSetting />
      <span>通用设置</span>
    </h4>
    <p>调整启动方式与界面显示。设置会保存在当前设备上。</p>

    <div className={sharedStyles.formSection}>
      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>启动时默认折叠右侧辅助面板</div>
          <div className={sharedStyles.formDesc}>启动时先收起右侧辅助区，需要时再展开。</div>
        </div>
        <button
          className={`${sharedStyles.switchButton} ${settings.general.collapseRightPanelOnStartup ? sharedStyles.enabled : ''}`}
          onClick={() =>
            setGeneral('collapseRightPanelOnStartup', !settings.general.collapseRightPanelOnStartup)
          }
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>显示状态栏</div>
          <div className={sharedStyles.formDesc}>在窗口底部显示字数、编码和版本入口等信息。</div>
        </div>
        <button
          className={`${sharedStyles.switchButton} ${settings.general.showStatusBar ? sharedStyles.enabled : ''}`}
          onClick={() => setGeneral('showStatusBar', !settings.general.showStatusBar)}
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>显示千字进度标记</div>
          <div className={sharedStyles.formDesc}>
            在编辑器正文左侧贴边显示每千字进度，不额外占用行号栏宽度。
          </div>
        </div>
        <button
          className={`${sharedStyles.switchButton} ${settings.general.showThousandCharMarkers ? sharedStyles.enabled : ''}`}
          onClick={() =>
            setGeneral('showThousandCharMarkers', !settings.general.showThousandCharMarkers)
          }
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>

      <div className={sharedStyles.formRowTopAligned}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>千字进度标记阈值</div>
          <div className={sharedStyles.formDesc}>
            控制正文里每隔多少字显示一个进度标记。推荐 1000，长章节可调到 2000。
          </div>
        </div>
        <select
          className={sharedStyles.select}
          value={settings.general.thousandCharMarkerStep}
          onChange={(e) => setGeneral('thousandCharMarkerStep', Number(e.target.value))}
        >
          {THOUSAND_CHAR_MARKER_STEP_OPTIONS.map((value) => (
            <option key={value} value={value}>
              每 {value} 字显示一个标记
            </option>
          ))}
        </select>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>显示文件大小</div>
          <div className={sharedStyles.formDesc}>
            在资源树中显示文件大小。关闭后可减轻大目录的加载压力。
          </div>
        </div>
        <button
          className={`${sharedStyles.switchButton} ${settings.general.showFileSizes ? sharedStyles.enabled : ''}`}
          onClick={() => setGeneral('showFileSizes', !settings.general.showFileSizes)}
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>更新后自动打开更新日志</div>
          <div className={sharedStyles.formDesc}>应用更新完成后，自动打开本次版本说明。</div>
        </div>
        <button
          className={`${sharedStyles.switchButton} ${settings.general.openChangelogAfterUpdate ? sharedStyles.enabled : ''}`}
          onClick={() =>
            setGeneral('openChangelogAfterUpdate', !settings.general.openChangelogAfterUpdate)
          }
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>
    </div>

    <UpdateGroup />

    {systemProfile && (
      <div className={sharedStyles.statusCard}>
        <div>
          <div className={styles.statusTitle}>
            运行性能模式
            {systemProfile.isLowSpec ? '：低配自动适配中' : '：标准模式'}
          </div>
          <div className={styles.statusSubtext}>
            {systemProfile.isLowSpec
              ? '已自动关闭硬件加速、延后非关键任务，让老电脑也能流畅启动。无需手动设置。'
              : '当前设备性能充足，按标准模式运行。'}
          </div>
          <div className={sharedStyles.specRow} style={{ marginTop: 8 }}>
            <span className={sharedStyles.specLabel}>CPU</span>
            <span className={sharedStyles.specValue}>
              {systemProfile.cpuCount} 逻辑核
              {systemProfile.cpuSpeedMHz > 0
                ? ` · ${(systemProfile.cpuSpeedMHz / 1000).toFixed(1)}GHz`
                : ''}
            </span>
          </div>
          <div className={sharedStyles.specRow}>
            <span className={sharedStyles.specLabel}>内存</span>
            <span className={sharedStyles.specValue}>
              {systemProfile.totalMemoryGB > 0 ? `${systemProfile.totalMemoryGB} GB` : '未知'}
            </span>
          </div>
          {systemProfile.isLowSpec && systemProfile.reasons.length > 0 && (
            <div className={sharedStyles.specRow}>
              <span className={sharedStyles.specLabel}>触发原因</span>
              <span className={sharedStyles.specValue}>{systemProfile.reasons.join('；')}</span>
            </div>
          )}
        </div>
        <span
          className={`${styles.statusBadge} ${systemProfile.isLowSpec ? styles.expired : styles['signed-in']}`}
        >
          {systemProfile.isLowSpec ? '低配模式' : '标准'}
        </span>
      </div>
    )}
  </div>
);

export default GeneralSection;
