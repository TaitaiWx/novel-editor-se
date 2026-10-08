/**
 * 设置中心的版式骨架：每个分区（通用 / 正文结构 / AI / 数据与缓存 / 快捷键 / 关于）都用同一套
 *
 * - SettingsSection：分区头（图标 + 标题 + 一行说明）
 * - SettingsGroup：一组设置（可选小标题 / 说明 / 右侧附注），组与组之间只用一条 1px 分隔线，不画卡片边框
 * - SettingsRow：一行设置（左侧标签与说明，右侧控件），行与行之间是更淡的分隔线
 *
 * 结构上带 data-settings-section / -group / -row 标记，测试与 E2E 用它定位，不依赖 CSS Module 类名。
 */
import React, { useId } from 'react';
import styles from './styles.module.scss';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

// ─── 分区 ────────────────────────────────────────────────────────────

interface SettingsSectionProps {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** 内容较宽的分区（AI 模型列表等）放宽最大宽度 */
  wide?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  icon,
  title,
  description,
  wide = false,
  className,
  children,
}) => (
  <div className={cx(styles.section, wide && styles.sectionWide, className)} data-settings-section>
    <header className={styles.sectionHeader}>
      <h4 className={styles.sectionTitle}>
        <span className={styles.sectionIcon} aria-hidden="true">
          {icon}
        </span>
        <span>{title}</span>
      </h4>
      {description && <p className={styles.sectionDesc}>{description}</p>}
    </header>
    {children}
  </div>
);

// ─── 分组 ────────────────────────────────────────────────────────────

interface SettingsGroupProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** 标题右侧的附注（例如「默认：xxx」） */
  meta?: React.ReactNode;
  /** 有标题时默认用标题作为区域名称；没有标题时可直接给 aria-label */
  'aria-label'?: string;
  /** 标题元素的 id（外部需要引用时指定） */
  titleId?: string;
  'data-testid'?: string;
  className?: string;
  children?: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  meta,
  'aria-label': ariaLabel,
  titleId,
  'data-testid': testId,
  className,
  children,
}) => {
  const fallbackId = useId();
  const headingId = titleId ?? `${fallbackId}-title`;
  const labelled = Boolean(title) || Boolean(ariaLabel);
  const Tag = labelled ? 'section' : 'div';
  return (
    <Tag
      className={cx(styles.group, className)}
      aria-labelledby={title ? headingId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      data-settings-group
      data-testid={testId}
    >
      {(title || description) && (
        <div className={styles.groupHeader}>
          {title && (
            <div className={styles.groupTitleLine}>
              <h5 id={headingId} className={styles.groupTitle}>
                {title}
              </h5>
              {meta && <span className={styles.groupMeta}>{meta}</span>}
            </div>
          )}
          {description && <p className={styles.groupDesc}>{description}</p>}
        </div>
      )}
      {children}
    </Tag>
  );
};

// ─── 行 ──────────────────────────────────────────────────────────────

export type SettingsRowTone = 'default' | 'emphasis' | 'attention' | 'danger';

interface SettingsRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** 说明下方的补充内容（示例、设备 ID、状态文字等） */
  extra?: React.ReactNode;
  /** 标签左侧的图标 / 头像 */
  leading?: React.ReactNode;
  /** 右侧控件；没有控件的行只显示文字 */
  children?: React.ReactNode;
  /** 控件列宽：auto 按内容（开关 / 按钮），field 固定宽度（输入框 / 下拉） */
  control?: 'auto' | 'field';
  /** 控件与标签顶部对齐（多行控件）还是垂直居中 */
  align?: 'center' | 'start';
  /**
   * emphasis：强调（带强调色底纹与强调色标签，用于总开关）；
   * attention：提醒（强调色描边，用于总开关关闭时）；danger：危险操作（标签为警示色）
   */
  tone?: SettingsRowTone;
  className?: string;
  'data-testid'?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  description,
  extra,
  leading,
  children,
  control = 'auto',
  align = 'center',
  tone = 'default',
  className,
  'data-testid': testId,
}) => (
  <div
    className={cx(
      styles.row,
      control === 'field' && styles.rowField,
      align === 'start' && styles.rowStart,
      tone === 'emphasis' && styles.rowEmphasis,
      tone === 'attention' && styles.rowAttention,
      tone === 'danger' && styles.rowDanger,
      className
    )}
    data-settings-row
    data-tone={tone}
    data-testid={testId}
  >
    <div className={styles.rowMain}>
      {leading && <div className={styles.rowLeading}>{leading}</div>}
      <div className={styles.rowMeta}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
        {extra}
      </div>
    </div>
    {children !== undefined && children !== null && (
      <div className={styles.rowControl}>{children}</div>
    )}
  </div>
);
