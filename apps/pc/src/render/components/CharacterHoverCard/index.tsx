import React from 'react';
import { VscAccount, VscAdd, VscSymbolColor } from 'react-icons/vsc';
import { formatLastAppearance, type CharacterCardModel, type LastAppearance } from './model';
import styles from './styles.module.scss';

export interface CharacterHoverCardProps {
  model: CharacterCardModel;
  /** 头像（data URL / http），null 表示没有头像，显示首字圆标 */
  avatarSrc?: string | null;
  /** undefined：读取中；null：此前没有出场 */
  lastAppearance?: LastAppearance | null;
  /** 当前作品已有记忆库时才能「记一笔」 */
  canRecord?: boolean;
  onOpen?: () => void;
  onRecord?: (anchor: DOMRect) => void;
  onHighlightAll?: () => void;
}

/** 按钮按下时不抢编辑器焦点（卡片不打断写作） */
const keepEditorFocus = (event: React.MouseEvent) => event.preventDefault();

/**
 * 人物悬停卡片：头像 / 名字与别名 / 分类阵营 / 一句话简介 / 当前状态 / 成长等级 / 上次出场 + 轻量操作。
 * 只负责展示，数据由 model.ts 组装，动作由调用方提供。
 */
const CharacterHoverCard: React.FC<CharacterHoverCardProps> = ({
  model,
  avatarSrc = null,
  lastAppearance,
  canRecord = false,
  onOpen,
  onRecord,
  onHighlightAll,
}) => {
  const accent = { '--card-accent': model.color } as React.CSSProperties;
  return (
    <div
      className={styles.card}
      style={accent}
      role="group"
      aria-label={`人物卡片：${model.name}`}
      data-testid="character-hover-card"
    >
      <div className={styles.header}>
        {avatarSrc ? (
          <img className={styles.avatar} src={avatarSrc} alt="" draggable={false} />
        ) : (
          <span className={styles.initial} aria-hidden="true">
            {model.initial}
          </span>
        )}
        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{model.name}</span>
            {model.growth && (
              <span className={styles.level} data-testid="character-card-level">
                Lv.{model.growth.level}
              </span>
            )}
          </div>
          {model.aliases.length > 0 && (
            <div className={styles.aliases}>又名 {model.aliases.join('、')}</div>
          )}
          <div className={styles.tags}>
            {model.tags.map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
            {model.role && <span className={styles.role}>{model.role}</span>}
          </div>
        </div>
      </div>

      {model.summary && <p className={styles.summary}>{model.summary}</p>}

      {model.states.length > 0 && (
        <ul className={styles.states} aria-label="当前状态">
          {model.states.map((item) => (
            <li key={`${item.label}:${item.value}`}>
              <span className={styles.stateLabel}>{item.label}</span>
              <span className={styles.stateValue}>{item.value}</span>
            </li>
          ))}
        </ul>
      )}

      {model.growth && (
        <div className={styles.growth}>
          <div
            className={styles.expBar}
            role="progressbar"
            aria-label="距下一级"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(model.growth.ratio * 100)}
          >
            <span style={{ width: `${Math.round(model.growth.ratio * 100)}%` }} />
          </div>
          <span className={styles.expText}>{model.growth.expText}</span>
        </div>
      )}

      <div className={styles.appearance}>
        <span className={styles.stateLabel}>上次出场</span>
        <span className={styles.appearanceValue}>
          {lastAppearance === undefined ? '查找中…' : formatLastAppearance(lastAppearance)}
        </span>
      </div>

      <div className={styles.actions}>
        {onOpen && (
          <button type="button" onMouseDown={keepEditorFocus} onClick={onOpen}>
            <VscAccount aria-hidden="true" />
            打开人物
          </button>
        )}
        {onRecord && canRecord && (
          <button
            type="button"
            onMouseDown={keepEditorFocus}
            onClick={(event) => onRecord(event.currentTarget.getBoundingClientRect())}
          >
            <VscAdd aria-hidden="true" />
            记一笔
          </button>
        )}
        {onHighlightAll && (
          <button type="button" onMouseDown={keepEditorFocus} onClick={onHighlightAll}>
            <VscSymbolColor aria-hidden="true" />
            高亮全部
          </button>
        )}
      </div>
    </div>
  );
};

export default CharacterHoverCard;
