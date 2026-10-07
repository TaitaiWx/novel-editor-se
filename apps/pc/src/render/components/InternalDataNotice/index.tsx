import React from 'react';
import { AiOutlineLock } from 'react-icons/ai';
import EmptyState from '../EmptyState';
import {
  INTERNAL_DATA_OWNER_LABELS,
  internalDataMessage,
  type InternalDataOwner,
} from '../../utils/internalData';
import styles from './styles.module.scss';

interface InternalDataNoticeProps {
  owner?: InternalDataOwner;
  /** 转到可以处理这份数据的界面；没有对应界面时不显示按钮 */
  onOpen?: () => void;
}

/**
 * 内部数据（成长档案 JSON、分镜状态、提示词记录…）被打开时，编辑器位置显示的友好提示：
 * 不显示原始 JSON，只告诉作者去哪里看，并提供一键跳转
 */
const InternalDataNotice: React.FC<InternalDataNoticeProps> = ({ owner, onOpen }) => (
  <div className={styles.notice} data-testid="internal-data-notice">
    <EmptyState
      icon={<AiOutlineLock />}
      title={internalDataMessage(owner)}
      description="这份文件由软件自动维护，不需要手动查看或修改；在可视化界面里处理即可。"
      actionText={onOpen && owner ? `打开${INTERNAL_DATA_OWNER_LABELS[owner]}` : undefined}
      onAction={onOpen}
    />
  </div>
);

export default InternalDataNotice;
