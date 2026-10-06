import React, { useState } from 'react';
import {
  AiOutlineAppstore,
  AiOutlinePlus,
  AiOutlineQuestionCircle,
  AiOutlineRise,
} from 'react-icons/ai';
import { GrowthHelp } from '../../RightPanel/GrowthView/GrowthHelp';
import Tooltip from '../../Tooltip';
import SectionHeader from '../SectionHeader';
import ObjectItemRow from '../ObjectItemRow';
import { WORKSPACE_TAB_GROWTH, createGrowthWorkspaceTab } from '../../../utils/workspace';
import { formatGrowthSheetMeta, type GrowthSheetSummary } from '../../../utils/growthIndex';
import type { ObjectContextMenuTarget } from '../types';
import styles from './styles.module.scss';

export const GROWTH_SECTION_HINT =
  '像游戏角色卡一样记下等级、经验、技能与抉择，几百章后也能一眼看清，避免战力崩溃';

interface GrowthSectionProps {
  /** 过滤后的成长卡摘要 */
  sheets: GrowthSheetSummary[];
  /** 记忆库（资料/记忆/规则.json）是否已创建 */
  initialized: boolean;
  /** 是否处于搜索筛选状态（决定空状态文案） */
  filtering: boolean;
  collapsed: boolean;
  activeWorkspaceTab?: string | null;
  onToggle: () => void;
  onOpen: (characterName?: string | null) => void;
  onCreate: () => void;
  onContextMenu: (event: React.MouseEvent, target: ObjectContextMenuTarget) => void;
}

/** 文件面板「成长档案」分区：列出已建档角色（等级徽章），可新建、打开总览或查看使用说明 */
const GrowthSection: React.FC<GrowthSectionProps> = ({
  sheets,
  initialized,
  filtering,
  collapsed,
  activeWorkspaceTab,
  onToggle,
  onOpen,
  onCreate,
  onContextMenu,
}) => {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <section className={styles.section} data-growth-tour="list">
      <SectionHeader
        title="成长档案"
        icon={<AiOutlineRise />}
        count={sheets.length}
        active={activeWorkspaceTab === WORKSPACE_TAB_GROWTH}
        singleClickOnly
        onToggle={onToggle}
        onContextMenu={(event) => onContextMenu(event, { kind: 'growth-root' })}
        actions={
          <>
            <Tooltip content="成长档案使用说明" position="top">
              <button
                type="button"
                className={styles.headerAction}
                onClick={() => setHelpOpen(true)}
                aria-label="成长档案使用说明"
              >
                <AiOutlineQuestionCircle />
              </button>
            </Tooltip>
            <Tooltip content="打开成长档案总览" position="top">
              <button
                type="button"
                className={styles.headerAction}
                onClick={() => onOpen(null)}
                aria-label="打开成长档案总览"
              >
                <AiOutlineAppstore />
              </button>
            </Tooltip>
            <Tooltip content="新建成长卡" position="top">
              <button
                type="button"
                className={styles.headerAction}
                onClick={onCreate}
                aria-label="新建成长卡"
              >
                <AiOutlinePlus />
              </button>
            </Tooltip>
          </>
        }
      />
      {!collapsed && (
        <div className={styles.children}>
          {sheets.map((item) => (
            <ObjectItemRow
              key={item.name}
              kindLabel="成长档案"
              title={item.name}
              badge={`Lv.${item.level}`}
              meta={formatGrowthSheetMeta(item)}
              icon={<AiOutlineRise />}
              active={activeWorkspaceTab === createGrowthWorkspaceTab(item.name)}
              onOpen={() => onOpen(item.name)}
              onContextMenu={(event) =>
                onContextMenu(event, { kind: 'growth-item', characterName: item.name })
              }
            />
          ))}
          {sheets.length === 0 &&
            (filtering ? (
              <div className={styles.empty}>当前筛选条件下没有成长档案</div>
            ) : (
              <div className={styles.hint} role="note">
                <div className={styles.hintTitle}>记录角色成长，防止战力崩溃</div>
                <div className={styles.hintText}>
                  {GROWTH_SECTION_HINT}。{initialized ? '' : '首次使用会先选择规则模板。'}
                </div>
                <div className={styles.hintActions}>
                  <button type="button" className={styles.hintButton} onClick={onCreate}>
                    <AiOutlinePlus />
                    新建成长卡
                  </button>
                  <button
                    type="button"
                    className={styles.hintLink}
                    onClick={() => setHelpOpen(true)}
                  >
                    怎么用？
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
      <GrowthHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
  );
};

export default GrowthSection;
