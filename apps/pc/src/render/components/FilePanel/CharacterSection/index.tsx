import React, { useMemo, useState } from 'react';
import {
  AiOutlineAppstore,
  AiOutlinePlus,
  AiOutlineQuestionCircle,
  AiOutlineRise,
  AiOutlineUser,
} from 'react-icons/ai';
import { resolveCover } from '@novel-editor/core/entity-media';
import { GrowthHelp } from '../../RightPanel/GrowthView/GrowthHelp';
import type { Character } from '../../RightPanel/types';
import CharacterAvatar from '../../CharacterAvatar';
import Tooltip from '../../Tooltip';
import SectionHeader from '../SectionHeader';
import ObjectItemRow from '../ObjectItemRow';
import CharacterGenerationHint from '../CharacterGenerationHint';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_GROWTH,
  createCharacterWorkspaceTab,
  createGrowthWorkspaceTab,
} from '../../../utils/workspace';
import { formatGrowthSheetMeta, type GrowthSheetSummary } from '../../../utils/growthIndex';
import { getCharacterCategoryLabel, type CharacterGroup } from '../utils';
import type { ObjectContextMenuTarget } from '../types';
import type { AssistantArtifactGenerationStatus } from '../../../utils/assistantGeneration';
import styles from './styles.module.scss';

export const CHARACTER_SECTION_HINT =
  '人物卡里有人物设计、图集（形象图 / 三视图）和成长档案（等级、经验、技能），几百章后也能一眼看清';

/** 成长卡按人物名匹配到人物；匹配不到人物的成长卡单独列出 */
export function splitGrowthSheets(
  characters: readonly Pick<Character, 'name' | 'aliases'>[],
  sheets: readonly GrowthSheetSummary[]
): { byCharacter: Map<string, GrowthSheetSummary>; orphans: GrowthSheetSummary[] } {
  const byName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const byCharacter = new Map<string, GrowthSheetSummary>();
  const used = new Set<string>();
  for (const character of characters) {
    const names = [character.name, ...(character.aliases ?? [])];
    const sheet = names.map((name) => byName.get(name)).find(Boolean);
    if (sheet) {
      byCharacter.set(character.name, sheet);
      used.add(sheet.name);
    }
  }
  return { byCharacter, orphans: sheets.filter((sheet) => !used.has(sheet.name)) };
}

interface CharacterSectionProps {
  groups: CharacterGroup[];
  /** 筛选后的人物（用于成长卡匹配与计数） */
  characters: Character[];
  growthSheets: GrowthSheetSummary[];
  /** 作品目录：解析人物封面（图集 / 头像）的相对路径 */
  workPath: string | null;
  filtering: boolean;
  collapsed: boolean;
  activeWorkspaceTab?: string | null;
  generationStatus?: AssistantArtifactGenerationStatus | null;
  onToggle: () => void;
  onOpenCharacter: (id: number) => void;
  onRenameCharacter: (id: number, name: string) => void;
  onDeleteCharacter: (id: number) => void;
  onCreateCharacter: () => void;
  /** 打开成长档案：传人物名为单个成长卡，null 为总览；未提供时不显示成长相关入口 */
  onOpenGrowth?: (characterName?: string | null) => void;
  onContextMenu: (event: React.MouseEvent, target: ObjectContextMenuTarget) => void;
}

/**
 * 文件面板「角色」分区：人物与成长档案合为一体。
 * 每行显示人物封面头像（图集里选的形象图，没有时为首字）与成长等级徽章；
 * 头部是使用说明、成长总览、新建人物；只有成长卡、还没有人物卡的条目单独列在「只有成长档案」。
 */
const CharacterSection: React.FC<CharacterSectionProps> = ({
  groups,
  characters,
  growthSheets,
  workPath,
  filtering,
  collapsed,
  activeWorkspaceTab,
  generationStatus,
  onToggle,
  onOpenCharacter,
  onRenameCharacter,
  onDeleteCharacter,
  onCreateCharacter,
  onOpenGrowth,
  onContextMenu,
}) => {
  const [helpOpen, setHelpOpen] = useState(false);
  const { byCharacter, orphans } = useMemo(
    () => splitGrowthSheets(characters, growthSheets),
    [characters, growthSheets]
  );
  const total = characters.length + orphans.length;

  return (
    <section className={styles.section} aria-label="角色" data-growth-tour="list">
      <SectionHeader
        title="角色"
        icon={<AiOutlineUser />}
        count={total}
        active={
          activeWorkspaceTab === WORKSPACE_TAB_CHARACTERS ||
          activeWorkspaceTab === WORKSPACE_TAB_GROWTH
        }
        singleClickOnly
        tooltip={CHARACTER_SECTION_HINT}
        onToggle={onToggle}
        onContextMenu={(event) => onContextMenu(event, { kind: 'characters-root' })}
        actions={
          <>
            {onOpenGrowth && (
              <>
                <Tooltip content="使用说明：人物设计、图集与成长档案" position="top">
                  <button
                    type="button"
                    className={styles.headerAction}
                    onClick={() => setHelpOpen(true)}
                    aria-label="角色与成长档案使用说明"
                  >
                    <AiOutlineQuestionCircle />
                  </button>
                </Tooltip>
                <Tooltip content="成长总览：所有角色的等级、提醒与被遗忘的配角" position="top">
                  <button
                    type="button"
                    className={styles.headerAction}
                    onClick={() => onOpenGrowth(null)}
                    aria-label="打开成长档案总览"
                  >
                    <AiOutlineAppstore />
                  </button>
                </Tooltip>
              </>
            )}
            <Tooltip content="新建人物" position="top">
              <button
                type="button"
                className={styles.headerAction}
                onClick={onCreateCharacter}
                aria-label="新建人物"
              >
                <AiOutlinePlus />
              </button>
            </Tooltip>
          </>
        }
      />
      {generationStatus && <CharacterGenerationHint status={generationStatus} />}
      {!collapsed && (
        <div className={styles.children}>
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.key} className={styles.subgroup}>
                <div className={styles.subgroupLabel}>
                  <span>{group.label}</span>
                  <span className={styles.subgroupCount}>{group.items.length}</span>
                </div>
                {group.items.map((item) => {
                  const sheet = byCharacter.get(item.name);
                  return (
                    <ObjectItemRow
                      key={item.id}
                      kindLabel="人物"
                      title={item.name}
                      badge={sheet ? `Lv.${sheet.level}` : undefined}
                      meta={`${getCharacterCategoryLabel(item.category)} · ${item.role || '未填写角色定位'}`}
                      icon={
                        <CharacterAvatar
                          name={item.name}
                          avatar={resolveCover(item.media ?? [], item.avatar)}
                          workPath={workPath}
                          color={item.highlightColor}
                          size={18}
                        />
                      }
                      active={activeWorkspaceTab === createCharacterWorkspaceTab(item)}
                      onOpen={() => onOpenCharacter(item.id)}
                      onRename={(name) => onRenameCharacter(item.id, name)}
                      onDelete={() => onDeleteCharacter(item.id)}
                      onContextMenu={(event) =>
                        onContextMenu(event, { kind: 'character-item', characterId: item.id })
                      }
                    />
                  );
                })}
              </div>
            )
          )}
          {onOpenGrowth && orphans.length > 0 && (
            <div className={styles.subgroup}>
              <div className={styles.subgroupLabel}>
                <Tooltip content="这些成长卡还没有对应的人物卡；新建同名人物后会自动合并">
                  <span>只有成长档案</span>
                </Tooltip>
                <span className={styles.subgroupCount}>{orphans.length}</span>
              </div>
              {orphans.map((sheet) => (
                <ObjectItemRow
                  key={sheet.name}
                  kindLabel="成长档案"
                  title={sheet.name}
                  badge={`Lv.${sheet.level}`}
                  meta={formatGrowthSheetMeta(sheet)}
                  icon={<AiOutlineRise />}
                  active={activeWorkspaceTab === createGrowthWorkspaceTab(sheet.name)}
                  onOpen={() => onOpenGrowth(sheet.name)}
                  onContextMenu={(event) =>
                    onContextMenu(event, { kind: 'growth-item', characterName: sheet.name })
                  }
                />
              ))}
            </div>
          )}
          {total === 0 &&
            (filtering ? (
              <div className={styles.empty}>当前筛选条件下没有人物</div>
            ) : (
              <div className={styles.hint} role="note">
                <div className={styles.hintTitle}>先建一个人物</div>
                <div className={styles.hintText}>{CHARACTER_SECTION_HINT}。</div>
                <div className={styles.hintActions}>
                  <button type="button" className={styles.hintButton} onClick={onCreateCharacter}>
                    <AiOutlinePlus />
                    新建人物
                  </button>
                  {onOpenGrowth && (
                    <button
                      type="button"
                      className={styles.hintLink}
                      onClick={() => setHelpOpen(true)}
                    >
                      怎么用？
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
      <GrowthHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
  );
};

export default CharacterSection;
