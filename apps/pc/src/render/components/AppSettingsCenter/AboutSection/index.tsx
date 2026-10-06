import React from 'react';
import { VscInfo } from 'react-icons/vsc';
import AboutCard from '../../AboutContent';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface AboutSectionProps {
  /** 当前分区是否可见（切换到该分区时刷新信息） */
  active: boolean;
}

/** 设置中心「关于」分区：与关于窗口展示同样的精简内容（更新通道已移到「通用」） */
const AboutSection: React.FC<AboutSectionProps> = ({ active }) => (
  <div className={sharedStyles.panel}>
    <h4>
      <VscInfo />
      <span>关于</span>
    </h4>
    <p>遇到问题时可点击「上传日志」，日志里不包含作品内容。</p>
    <div className={styles.card}>
      <AboutCard active={active} />
    </div>
  </div>
);

export default AboutSection;
