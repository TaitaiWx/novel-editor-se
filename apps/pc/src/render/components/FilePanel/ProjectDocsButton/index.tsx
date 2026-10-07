import React, { useEffect, useRef, useState } from 'react';
import { AiOutlineRead } from 'react-icons/ai';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import type { ContextMenuEvent } from '../../FileTree';
import type { FileNode } from '../../../types';
import { stripStoryFileExtension } from '../../../utils/workspace';
import styles from './styles.module.scss';

export const PROJECT_DOCS_HINT = '项目根目录下、不属于任何作品的说明文件';
const SEEN_STORAGE_PREFIX = 'novel-editor:project-docs-seen:';

/** 文档列表的签名：新增 / 改名后视为「有新的说明」，再次显示提示点 */
export function projectDocsSignature(docs: readonly FileNode[]): string {
  return docs
    .map((doc) => doc.name)
    .sort()
    .join('\n');
}

function readSeen(folderPath: string): string | null {
  try {
    return window.localStorage.getItem(SEEN_STORAGE_PREFIX + folderPath);
  } catch {
    return null;
  }
}

function writeSeen(folderPath: string, signature: string): void {
  try {
    window.localStorage.setItem(SEEN_STORAGE_PREFIX + folderPath, signature);
  } catch {
    // localStorage 不可用时只是每次都显示提示点
  }
}

/** 悬停提示：像公告一样列出前几个文档名 */
export function projectDocsTooltip(docs: readonly FileNode[], unseen: boolean): string {
  const names = docs.slice(0, 3).map((doc) => stripStoryFileExtension(doc.name));
  const more = docs.length > 3 ? ` 等 ${docs.length} 篇` : '';
  return `${unseen ? '有新的项目说明：' : '项目说明：'}${names.join('、')}${more}\n点击查看`;
}

interface ProjectDocsButtonProps {
  folderPath: string;
  /** 项目根目录的说明文档（欢迎使用.md、README.md …） */
  docs: FileNode[];
  selectedFile: string | null;
  onOpen: (path: string) => void;
  /** 右键文档：沿用文件右键菜单（重命名、删除等） */
  onDocContextMenu?: (event: ContextMenuEvent) => void;
}

/**
 * 项目说明（项目级、不属于任何作品的根目录文档）：文件面板顶部「搜索」左侧的图标。
 * 悬停像公告一样提示有哪些说明；有没看过的说明时图标带提示点（按项目记住已看过的文档列表）；
 * 点击弹出列表，单击打开。没有根目录文档时不显示。
 */
const ProjectDocsButton: React.FC<ProjectDocsButtonProps> = ({
  folderPath,
  docs,
  selectedFile,
  onOpen,
  onDocContextMenu,
}) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const signature = projectDocsSignature(docs);
  const [seen, setSeen] = useState<string | null>(() => readSeen(folderPath));
  useEffect(() => setSeen(readSeen(folderPath)), [folderPath]);
  if (docs.length === 0) return null;
  const unseen = seen !== signature;
  const label = `项目说明（${docs.length} 篇）`;

  const toggle = () => {
    setOpen((value) => !value);
    if (unseen) {
      writeSeen(folderPath, signature);
      setSeen(signature);
    }
  };

  return (
    <>
      <Tooltip content={projectDocsTooltip(docs, unseen)} position="bottom">
        <button
          ref={anchorRef}
          type="button"
          className={`${styles.trigger} ${open ? styles.triggerActive : ''}`}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="project-docs-trigger"
          onClick={toggle}
        >
          <AiOutlineRead aria-hidden="true" />
          {unseen && <span className={styles.dot} data-testid="project-docs-unseen" />}
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={anchorRef}
        placement="bottom"
        align="start"
        offset={6}
        role="dialog"
        onClose={() => setOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.panel} aria-label="项目说明">
          <div className={styles.head}>
            <span className={styles.title}>项目说明</span>
            <span className={styles.count}>{docs.length}</span>
          </div>
          <p className={styles.hint}>{PROJECT_DOCS_HINT}</p>
          <ul className={styles.list} role="list">
            {docs.map((doc) => (
              <li key={doc.path}>
                <button
                  type="button"
                  className={`${styles.row} ${selectedFile === doc.path ? styles.rowActive : ''}`}
                  title={doc.name}
                  onClick={() => {
                    setOpen(false);
                    onOpen(doc.path);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onDocContextMenu?.({ x: event.clientX, y: event.clientY, node: doc });
                  }}
                >
                  <span className={styles.label}>{stripStoryFileExtension(doc.name)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </>
  );
};

export default ProjectDocsButton;
