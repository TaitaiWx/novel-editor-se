import React from 'react';
import { VscDeviceCameraVideo } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import { requestOpenSceneVideo } from '../SceneVideoView/events';
import styles from './styles.module.scss';

export const SCENE_VIDEO_TIP = '把选中的正文（或光标所在的「第X场」）做成分镜与视频';

interface SceneVideoButtonProps {
  /** 快捷键展示文本（与应用菜单「编辑 → 场景视频…」一致） */
  shortcutLabel?: string;
}

/** 编辑器文件栏上的「场景视频」胶囊按钮：打开场景视频工作区 */
const SceneVideoButton: React.FC<SceneVideoButtonProps> = ({ shortcutLabel }) => (
  <span className={styles.slot}>
    <Tooltip
      content={shortcutLabel ? `${SCENE_VIDEO_TIP}（${shortcutLabel}）` : SCENE_VIDEO_TIP}
      position="bottom"
    >
      <button
        type="button"
        className={styles.pill}
        aria-label="场景视频"
        data-testid="scene-video-pill"
        // 不抢编辑器焦点，保留选区
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => requestOpenSceneVideo()}
      >
        <VscDeviceCameraVideo className={styles.icon} aria-hidden="true" />
        <span>场景视频</span>
      </button>
    </Tooltip>
  </span>
);

export default SceneVideoButton;
