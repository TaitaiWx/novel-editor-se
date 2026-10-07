import React, { useEffect, useRef } from 'react';
import {
  AiOutlineFileText,
  AiOutlineFolderOpen,
  AiOutlineGlobal,
  AiOutlineInfoCircle,
  AiOutlineSearch,
  AiOutlineUser,
} from 'react-icons/ai';
import { isImeComposing } from '../../../utils/ime';
import {
  splitHighlight,
  type FileSearchGroup,
  type FileSearchGroupId,
  type FileSearchItem,
} from '../search';
import styles from './styles.module.scss';

interface SearchResultsProps {
  query: string;
  groups: FileSearchGroup[];
  /** 当前键盘选中项的 key */
  activeKey: string | null;
  /** 全文搜索进行中 */
  contentSearching: boolean;
  contentTruncated: boolean;
  contentError: string | null;
  onOpen: (item: FileSearchItem) => void;
  onHover: (key: string) => void;
  /** Esc 关闭搜索 */
  onDismiss: () => void;
}

const GROUP_ICONS: Record<FileSearchGroupId, React.ReactNode> = {
  docs: <AiOutlineInfoCircle />,
  story: <AiOutlineFileText />,
  characters: <AiOutlineUser />,
  lore: <AiOutlineGlobal />,
  materials: <AiOutlineFolderOpen />,
  content: <AiOutlineSearch />,
};

/** 选项的 DOM id（供输入框 aria-activedescendant 使用） */
export function searchOptionId(key: string): string {
  return `file-search-option-${encodeURIComponent(key)}`;
}

const Highlighted: React.FC<{ text: string; query: string }> = ({ text, query }) => (
  <>
    {splitHighlight(text, query).map((segment, index) =>
      segment.match ? (
        <mark key={index} className={styles.mark}>
          {segment.text}
        </mark>
      ) : (
        <React.Fragment key={index}>{segment.text}</React.Fragment>
      )
    )}
  </>
);

/** 全文命中行预览：按主进程给出的位置高亮 */
const Preview: React.FC<{ text: string; start: number; length: number }> = ({
  text,
  start,
  length,
}) => (
  <span className={styles.preview}>
    {text.slice(0, start)}
    <mark className={styles.mark}>{text.slice(start, start + length)}</mark>
    {text.slice(start + length)}
  </span>
);

/** 文件面板搜索结果：按 项目说明 / 正文 / 人物 / 设定 / 资料 / 内容 分组，点击打开 */
const SearchResults: React.FC<SearchResultsProps> = ({
  query,
  groups,
  activeKey,
  contentSearching,
  contentTruncated,
  contentError,
  onOpen,
  onHover,
  onDismiss,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // 键盘移动选中项时滚动到可见范围
  useEffect(() => {
    if (!activeKey) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[id="${searchOptionId(activeKey)}"]`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  const empty = groups.length === 0;

  return (
    <div
      ref={listRef}
      className={styles.results}
      id="file-search-results"
      role="listbox"
      aria-label="搜索结果"
      data-testid="file-search-results"
      onKeyDown={(event) => {
        if (isImeComposing(event)) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      {groups.map((group) => (
        <section key={group.id} className={styles.group} aria-label={group.label}>
          <div className={styles.groupHeader}>
            <span className={styles.groupIcon}>{GROUP_ICONS[group.id]}</span>
            <span>{group.label}</span>
            <span className={styles.groupCount}>{group.total}</span>
          </div>
          {group.items.map((item) => (
            <div
              key={item.key}
              id={searchOptionId(item.key)}
              role="option"
              aria-selected={item.key === activeKey}
              tabIndex={-1}
              className={`${styles.item}${item.key === activeKey ? ` ${styles.active}` : ''}`}
              title={item.kind === 'file' || item.kind === 'content' ? item.path : item.title}
              onMouseEnter={() => onHover(item.key)}
              // 按下时不抢走输入框焦点，保持键盘可继续输入
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onOpen(item)}
            >
              <span className={styles.itemLine}>
                <span className={styles.itemTitle}>
                  <Highlighted text={item.title} query={item.kind === 'content' ? '' : query} />
                </span>
                {item.kind === 'content' && (
                  <span className={styles.itemLineNo}>第 {item.line} 行</span>
                )}
                {item.detail && (
                  <span className={styles.itemDetail}>
                    <Highlighted text={item.detail} query={query} />
                  </span>
                )}
              </span>
              {item.kind === 'content' && (
                <Preview text={item.preview} start={item.matchStart} length={item.matchLength} />
              )}
            </div>
          ))}
          {group.total > group.items.length && (
            <div className={styles.more}>还有 {group.total - group.items.length} 条未显示</div>
          )}
        </section>
      ))}

      <div className={styles.status} aria-live="polite">
        {contentSearching
          ? '正在搜索正文内容…'
          : contentError
            ? `正文内容搜索失败：${contentError}`
            : empty
              ? `没有找到「${query.trim()}」。可以搜索章节名、人物、设定、资料文件名或正文里的句子`
              : contentTruncated
                ? '正文命中较多，只显示前一部分，请输入更具体的关键词'
                : null}
      </div>
    </div>
  );
};

export default SearchResults;
