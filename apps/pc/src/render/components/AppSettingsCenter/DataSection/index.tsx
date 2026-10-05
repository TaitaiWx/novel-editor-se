import React from 'react';
import { AiOutlineDatabase } from 'react-icons/ai';
import type { ClearDataScope } from '../constants';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface DataSectionProps {
  clearConfirmScope: ClearDataScope | null;
  setClearConfirmScope: (scope: ClearDataScope | null) => void;
  handleClearData: (scope: ClearDataScope) => Promise<void>;
}

/** 数据与缓存分区 */
const DataSection: React.FC<DataSectionProps> = ({
  clearConfirmScope,
  setClearConfirmScope,
  handleClearData,
}) => (
  <div className={sharedStyles.panel}>
    <h4>
      <AiOutlineDatabase />
      <span>数据与缓存</span>
    </h4>
    <p>清理保存在当前设备上的本地缓存与偏好设置，不会删除作品目录中的文件。</p>

    <div className={styles.dataGrid}>
      <div className={styles.dataCard}>
        <div className={styles.dataCardHeader}>
          <div>
            <div className={styles.dataCardTitle}>文档数据</div>
            <div className={styles.dataCardDesc}>
              清理最近项目记录和创作辅助缓存，不会影响正文与素材文件。
            </div>
          </div>
          <button
            className={styles.dataClearButton}
            onClick={() =>
              setClearConfirmScope(clearConfirmScope === 'document' ? null : 'document')
            }
          >
            清除文档数据
          </button>
        </div>
        {clearConfirmScope === 'document' && (
          <div className={styles.dataConfirmBox}>
            <div className={styles.dataConfirmText}>
              将清理本地缓存与最近项目记录，不会删除作品文件。
            </div>
            <div className={styles.dataConfirmActions}>
              <button
                className={styles.dataCancelButton}
                onClick={() => setClearConfirmScope(null)}
              >
                取消
              </button>
              <button
                className={styles.dataDangerConfirmButton}
                onClick={() => void handleClearData('document')}
              >
                确认清除
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.dataCard}>
        <div className={styles.dataCardHeader}>
          <div>
            <div className={styles.dataCardTitle}>AI 设置数据</div>
            <div className={styles.dataCardDesc}>
              重置 AI 服务、模型和密钥等参数，不影响作品内容。
            </div>
          </div>
          <button
            className={styles.dataClearButton}
            onClick={() => setClearConfirmScope(clearConfirmScope === 'ai' ? null : 'ai')}
          >
            清除 AI 设置
          </button>
        </div>
        {clearConfirmScope === 'ai' && (
          <div className={styles.dataConfirmBox}>
            <div className={styles.dataConfirmText}>
              将恢复 AI 设置到默认值，不影响作品内容和本地缓存。
            </div>
            <div className={styles.dataConfirmActions}>
              <button
                className={styles.dataCancelButton}
                onClick={() => setClearConfirmScope(null)}
              >
                取消
              </button>
              <button
                className={styles.dataDangerConfirmButton}
                onClick={() => void handleClearData('ai')}
              >
                确认清除
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`${styles.dataCard} ${styles.dataCardDanger}`}>
        <div className={styles.dataCardHeader}>
          <div>
            <div className={styles.dataCardTitle}>全部清空</div>
            <div className={styles.dataCardDesc}>
              清理本地缓存并恢复默认设置，不会删除作品目录中的文件。
            </div>
          </div>
          <button
            className={styles.dataClearDangerButton}
            onClick={() => setClearConfirmScope(clearConfirmScope === 'all' ? null : 'all')}
          >
            全部清空
          </button>
        </div>
        {clearConfirmScope === 'all' && (
          <div className={styles.dataConfirmBox}>
            <div className={styles.dataConfirmText}>
              这会重置全部本地设置与缓存，不会删除作品文件。
            </div>
            <div className={styles.dataConfirmActions}>
              <button
                className={styles.dataCancelButton}
                onClick={() => setClearConfirmScope(null)}
              >
                取消
              </button>
              <button
                className={styles.dataDangerConfirmButton}
                onClick={() => void handleClearData('all')}
              >
                确认全部清空
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
);

export default DataSection;
