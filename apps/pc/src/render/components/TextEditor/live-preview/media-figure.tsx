/**
 * 编辑器内 ::video / ::image 指令的媒体（独立的 React root，挂进 CodeMirror widget 的 DOM）：
 * - 视频用自定义播放器（无黑边、悬停浮现控制条），右上角「在旁边看」
 * - 图片的边框贴合图片比例（最高约 420px），悬停时右上角「在旁边看」
 * 「在旁边看」在 mousedown 时处理并阻止默认行为，编辑器不失焦、光标不动。
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { VscOpenPreview } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import VideoPlayer from '../../VideoPlayer';
import { referenceItemFor, requestOpenReference } from '../../../utils/referencePane';

export const MEDIA_MAX_WIDTH = 640;
export const MEDIA_MAX_HEIGHT = 420;

export interface MediaFigureProps {
  kind: 'video' | 'image';
  /** 实际找到的本地路径（「在旁边看」打开它） */
  path: string;
  url: string;
  label: string;
  /** 尺寸变化（读到元数据 / 图片加载完成 / 全屏）时回调 */
  onLayoutChange: () => void;
}

const BesideButton: React.FC<{ path: string; label: string }> = ({ path, label }) => {
  const open = () => {
    const item = referenceItemFor(path, label);
    if (item) requestOpenReference({ items: [item] });
  };
  return (
    <Tooltip content="在编辑器旁边看" position="bottom">
      <button
        type="button"
        className="cm-lp-media-beside"
        aria-label={`在旁边看 ${label}`}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          open();
        }}
        onClick={(event) => {
          event.stopPropagation();
          // 键盘触发（Enter / 空格）时没有 mousedown
          if (event.detail === 0) open();
        }}
      >
        <VscOpenPreview aria-hidden="true" />
      </button>
    </Tooltip>
  );
};

export const MediaFigure: React.FC<MediaFigureProps> = ({
  kind,
  path,
  url,
  label,
  onLayoutChange,
}) => {
  const beside = <BesideButton path={path} label={label} />;
  if (kind === 'video') {
    return (
      <VideoPlayer
        src={url}
        title={label}
        maxWidth={MEDIA_MAX_WIDTH}
        maxHeight={MEDIA_MAX_HEIGHT}
        videoClassName="cm-lp-video-player"
        actions={beside}
        showLoopToggle
        onLayoutChange={onLayoutChange}
      />
    );
  }
  return (
    <span className="cm-lp-image-frame">
      <img className="cm-lp-image-directive" src={url} alt={label} onLoad={onLayoutChange} />
      <span className="cm-lp-media-actions">{beside}</span>
    </span>
  );
};

/** 渲染进 widget 的 DOM，返回卸载函数（放到微任务里，避免在 React 提交过程中同步卸载） */
export function mountMediaFigure(dom: HTMLElement, props: MediaFigureProps): () => void {
  const root = createRoot(dom);
  flushSync(() => root.render(<MediaFigure {...props} />));
  return () => {
    queueMicrotask(() => root.unmount());
  };
}
