import React from 'react';
import { AiOutlineFileText } from 'react-icons/ai';
import type { ContextMenuEvent } from '../../FileTree';
import type { FileNode } from '../../../types';
import { stripStoryFileExtension } from '../../../utils/workspace';
import SectionHeader from '../SectionHeader';
import { handleRowActivationKey } from '../utils';
import styles from './styles.module.scss';

export const PROJECT_DOCS_HINT = '项目根目录下、不属于任何作品的说明文件';

interface ProjectDocsSectionProps {
  /** 项目根目录的说明文档（欢迎使用.md、README.md …） */
  docs: FileNode[];
  selectedFile: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (path: string) => void;
  /** 右键文档：沿用文件右键菜单（重命名、删除等） */
  onDocContextMenu?: (event: ContextMenuEvent) => void;
}

/**
 * 项目说明：项目级（不属于任何作品）的根目录文档。
 * 位于项目名与作品切换器之间——层级上属于项目，不混在当前作品的 正文 / 资料 里；默认折叠，只占一行。
 * 没有根目录文档时不显示。
 */
const ProjectDocsSection: React.FC<ProjectDocsSectionProps> = ({
  docs,
  selectedFile,
  collapsed,
  onToggle,
  onOpen,
  onDocContextMenu,
}) => {
  if (docs.length === 0) return null;
  return (
    <section className={styles.section} aria-label="项目说明">
      <SectionHeader
        title="项目说明"
        icon={<AiOutlineFileText />}
        count={docs.length}
        expanded={!collapsed}
        tooltip={PROJECT_DOCS_HINT}
        singleClickOnly
        onToggle={onToggle}
        onContextMenu={(event) => event.preventDefault()}
      />
      {!collapsed && (
        <div className={styles.list} role="list">
          {docs.map((doc) => (
            <div
              key={doc.path}
              role="listitem"
              tabIndex={0}
              className={`${styles.row} ${selectedFile === doc.path ? styles.rowActive : ''}`}
              title={doc.name}
              onClick={() => onOpen(doc.path)}
              onKeyDown={(event) => handleRowActivationKey(event, () => onOpen(doc.path))}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDocContextMenu?.({ x: event.clientX, y: event.clientY, node: doc });
              }}
            >
              <AiOutlineFileText className={styles.icon} aria-hidden="true" />
              <span className={styles.label}>{stripStoryFileExtension(doc.name)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default ProjectDocsSection;
