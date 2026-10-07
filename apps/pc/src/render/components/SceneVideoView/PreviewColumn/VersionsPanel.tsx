import React from 'react';
import {
  chosenVersionFor,
  shotNumber,
  shotVersionsFromFiles,
  type SceneVideoState,
} from '../sceneVideoState';
import MediaPlayer, { type ReadSceneFile } from './MediaPlayer';
import styles from './styles.module.scss';

export interface VersionsPanelProps {
  state: SceneVideoState;
  files: readonly string[];
  previewFile: string | null;
  compare: readonly string[];
  readFile: ReadSceneFile;
  onPreview: (fileName: string) => void;
  onChoose: (shotId: string, fileName: string) => void;
  onToggleCompare: (fileName: string) => void;
}

/** 每个镜头的历史版本：点版本预览，「选用」决定拼接与回链用哪一版，勾选两个版本并排对比 */
const VersionsPanel: React.FC<VersionsPanelProps> = ({
  state,
  files,
  previewFile,
  compare,
  readFile,
  onPreview,
  onChoose,
  onToggleCompare,
}) => {
  const rows = state.storyboard.shots
    .map((shot, index) => {
      const number = shotNumber(shot);
      return {
        shot,
        index,
        versions: number === null ? [] : shotVersionsFromFiles(files, number),
        chosen: chosenVersionFor(state, shot, files),
      };
    })
    .filter((row) => row.versions.length > 0);

  if (rows.length === 0) {
    return <p className={styles.muted}>生成完成的镜头会出现在这里，每次生成都保留一个版本。</p>;
  }

  return (
    <div className={styles.versions}>
      {rows.map(({ shot, index, versions, chosen }) => (
        <div key={shot.id} className={styles.versionRow}>
          <span className={styles.versionLabel}>镜头 {index + 1}</span>
          <div className={styles.versionChips}>
            {versions.map((version) => {
              const isChosen = chosen === version.fileName;
              return (
                <span
                  key={version.fileName}
                  className={`${styles.versionChip} ${
                    previewFile === version.fileName ? styles.versionChipActive : ''
                  }`}
                >
                  <button
                    type="button"
                    className={styles.versionButton}
                    aria-label={`预览 镜头 ${index + 1} v${version.version}`}
                    onClick={() => onPreview(version.fileName)}
                  >
                    v{version.version}
                    {isChosen && <span className={styles.chosenMark}>选用</span>}
                  </button>
                  {!isChosen && (
                    <button
                      type="button"
                      className={styles.versionAction}
                      aria-label={`选用 镜头 ${index + 1} v${version.version}`}
                      onClick={() => onChoose(shot.id, version.fileName)}
                    >
                      选用
                    </button>
                  )}
                  <label className={styles.compareToggle} title="勾选两个版本并排对比">
                    <input
                      type="checkbox"
                      checked={compare.includes(version.fileName)}
                      aria-label={`对比 镜头 ${index + 1} v${version.version}`}
                      onChange={() => onToggleCompare(version.fileName)}
                    />
                    对比
                  </label>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {compare.length === 2 && (
        <div className={styles.compare} aria-label="版本对比">
          {compare.map((fileName) => (
            <MediaPlayer
              key={fileName}
              readFile={readFile}
              fileName={fileName}
              caption={fileName}
            />
          ))}
        </div>
      )}
      {compare.length === 1 && <p className={styles.muted}>再勾选一个版本即可并排对比。</p>}
    </div>
  );
};

export default VersionsPanel;
