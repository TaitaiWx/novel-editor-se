import React, { useState } from 'react';
import PanelHeader from '../PanelHeader';
import TextEditor from '../TextEditor';
import SettingsButton from '../SettingsButton';
import styles from './styles.module.scss';

interface ContentPanelProps {
  selectedFile: string | null;
}

const ContentPanel: React.FC<ContentPanelProps> = ({ selectedFile }) => {
  const [showGrid, setShowGrid] = useState(false);
  const [showRowLines, setShowRowLines] = useState(false);
  const getFileName = (filePath: string | null) => {
    if (!filePath) return '请选择文件';
    return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  };

  return (
    <div className={styles.contentPanel}>
      <PanelHeader
        title={getFileName(selectedFile)}
        indicator={
          selectedFile
            ? {
                text: '已选择',
                type: 'success',
              }
            : undefined
        }
        settingsComponent={
          <SettingsButton
            showGrid={showGrid}
            onToggleGrid={setShowGrid}
            showRowLines={showRowLines}
            onToggleRowLines={setShowRowLines}
          />
        }
      />

      <div className={styles.contentPanelContent}>
        <TextEditor filePath={selectedFile} showGrid={showGrid} showRowLines={showRowLines} />
      </div>
    </div>
  );
};

export default ContentPanel;
