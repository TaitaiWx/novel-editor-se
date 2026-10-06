import React from 'react';
import { AiOutlineFileText, AiOutlineInfoCircle } from 'react-icons/ai';
import Tooltip from '../../Tooltip';
import SectionHeader from '../SectionHeader';
import StoryTreeNode, { type StoryTreeContext } from '../StoryTreeNode';
import type { StoryDisplayNode } from '../../../utils/storyStructure';
import styles from './styles.module.scss';

export const PROJECT_NOTES_HINT =
  '项目根目录下的说明文档（如 欢迎使用.md、README.md），不属于任何作品，也不计入章节';

interface ProjectNotesSectionProps {
  nodes: StoryDisplayNode[];
  collapsed: boolean;
  tree: StoryTreeContext;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/** 文件面板底部「项目说明」：只有根目录存在说明文档时显示，默认折叠 */
const ProjectNotesSection: React.FC<ProjectNotesSectionProps> = ({
  nodes,
  collapsed,
  tree,
  onToggle,
  onContextMenu,
}) => (
  <section className={styles.section} aria-label="项目说明">
    <SectionHeader
      title="项目说明"
      icon={<AiOutlineFileText />}
      count={nodes.length}
      singleClickOnly
      expanded={!collapsed}
      tooltip={PROJECT_NOTES_HINT}
      onToggle={onToggle}
      onContextMenu={onContextMenu}
      actions={
        <Tooltip content={PROJECT_NOTES_HINT} position="top">
          <span className={styles.info} aria-label="项目说明的用途" role="img">
            <AiOutlineInfoCircle />
          </span>
        </Tooltip>
      }
    />
    {!collapsed && (
      <div className={styles.children}>
        {nodes.map((node) => (
          <StoryTreeNode key={node.path} node={node} level={0} parentPath={null} tree={tree} />
        ))}
      </div>
    )}
  </section>
);

export default ProjectNotesSection;
