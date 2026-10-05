import React from 'react';
import { AiOutlineRise } from 'react-icons/ai';
import Tooltip from '../../../Tooltip';
import styles from './styles.module.scss';

interface CharacterGrowthButtonProps {
  characterName: string;
  /** 已有成长卡时的等级；null 表示尚未建档 */
  level: number | null;
  onOpen: (characterName: string) => void;
}

const GROWTH_HINT =
  '成长档案：记录等级、经验、技能、抉择与队伍足迹，几百章后也能一眼看清，避免战力崩溃';

/** 人物详情标题区的「成长档案」入口：已建档显示等级，未建档点击即新建 */
export const CharacterGrowthButton: React.FC<CharacterGrowthButtonProps> = ({
  characterName,
  level,
  onOpen,
}) => (
  <Tooltip content={GROWTH_HINT} position="bottom">
    <button
      type="button"
      className={styles.button}
      onClick={() => onOpen(characterName)}
      aria-label={
        level === null ? `为 ${characterName} 新建成长档案` : `打开 ${characterName} 的成长档案`
      }
    >
      <AiOutlineRise className={styles.icon} />
      <span>成长档案</span>
      <span className={styles.badge}>{level === null ? '新建' : `Lv.${level}`}</span>
    </button>
  </Tooltip>
);

export default CharacterGrowthButton;
