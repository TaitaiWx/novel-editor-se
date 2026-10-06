import React, { useRef, useState } from 'react';
import { AiOutlineFileText, AiOutlineRead } from 'react-icons/ai';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import type { ContextMenuEvent } from '../../FileTree';
import type { FileNode } from '../../../types';
import { stripStoryFileExtension } from '../../../utils/workspace';
import styles from './styles.module.scss';

export const PROJECT_DOCS_HINT = '项目根目录下、不属于任何作品的说明文件';

interface ProjectDocsButtonProps {
  /** 项目根目录的说明文档（欢迎使用.md、README.md …）；为空时不渲染 */
  docs: FileNode[];
  selectedFile: string | null;
  onOpen: (path: string) => void;
  /** 右键文档：沿用文件右键菜单（重命名、删除等） */
  onContextMenu?: (event: ContextMenuEvent) => void;
}

/** 文件面板顶部项目名旁的「项目说明」按钮：带数量徽标，点击弹出根目录说明文档列表 */
const ProjectDocsButton: React.FC<ProjectDocsButtonProps> = ({
  docs,
  selectedFile,
  onOpen,
  onContextMenu,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (docs.length === 0) return null;

  const label = `项目说明（${docs.length} 个文件）`;
  return (
    <>
      <Tooltip content={`${label}\n${PROJECT_DOCS_HINT}`} position="bottom">
        <button
          ref={buttonRef}
          type="button"
          className={`${styles.trigger} ${open ? styles.triggerActive : ''}`}
          onClick={() => setOpen((current) => !current)}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <AiOutlineRead />
          <span className={styles.badge} aria-hidden="true">
            {docs.length}
          </span>
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={buttonRef}
        placement="bottom"
        align="start"
        offset={6}
        className={styles.popover}
        onClose={() => setOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.panel}>
          <div className={styles.header}>
            <span className={styles.title}>项目说明</span>
            <span className={styles.hint}>{PROJECT_DOCS_HINT}</span>
          </div>
          <div className={styles.list} role="list" aria-label="项目说明">
            {docs.map((doc) => (
              <div key={doc.path} role="listitem">
                <button
                  type="button"
                  className={`${styles.item} ${selectedFile === doc.path ? styles.itemActive : ''}`}
                  title={doc.name}
                  onClick={() => {
                    setOpen(false);
                    onOpen(doc.path);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onContextMenu?.({ x: event.clientX, y: event.clientY, node: doc });
                  }}
                >
                  <AiOutlineFileText className={styles.itemIcon} />
                  <span className={styles.itemName}>{stripStoryFileExtension(doc.name)}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
};

export default ProjectDocsButton;
