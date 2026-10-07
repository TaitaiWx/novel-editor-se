/**
 * 文件树图标：目录用文件夹图标，文件按大类使用同一套 Bootstrap Icons（线条风格统一），
 * 颜色由样式表中与大类同名的 class 控制。图标元素在模块级创建一次，各行复用。
 */
import React from 'react';
import { AiFillFolder } from 'react-icons/ai';
import {
  BsCameraReelsFill,
  BsFileEarmark,
  BsFileEarmarkCode,
  BsFileEarmarkExcel,
  BsFileEarmarkImage,
  BsFileEarmarkMusic,
  BsFileEarmarkPdf,
  BsFileEarmarkPlay,
  BsFileEarmarkPpt,
  BsFileEarmarkText,
  BsFileEarmarkWord,
  BsFileEarmarkZip,
  BsFiletypeJson,
  BsFiletypeMd,
} from 'react-icons/bs';
import { getFileKind, splitFileName, type FileKind } from './fileDisplay';

/** 图标 class：文件大类或 folder */
export type FileIconClass = FileKind | 'folder';

const KIND_ICONS: Record<FileKind, React.ReactElement> = {
  image: <BsFileEarmarkImage />,
  video: <BsFileEarmarkPlay />,
  audio: <BsFileEarmarkMusic />,
  pdf: <BsFileEarmarkPdf />,
  word: <BsFileEarmarkWord />,
  excel: <BsFileEarmarkExcel />,
  ppt: <BsFileEarmarkPpt />,
  archive: <BsFileEarmarkZip />,
  markdown: <BsFiletypeMd />,
  text: <BsFileEarmarkText />,
  code: <BsFileEarmarkCode />,
  unknown: <BsFileEarmark />,
};

const FOLDER_ICON = <AiFillFolder />;
/** 场景视频目录（里面是这一场的分镜状态、成片与样片）：用视频图标，和普通文件夹区分 */
const SCENE_VIDEO_ICON = <BsCameraReelsFill />;
const JSON_ICON = <BsFiletypeJson />;

export function getFileIcon(
  name: string,
  type: 'file' | 'directory',
  kind: FileKind = getFileKind(name),
  options: { sceneVideo?: boolean } = {}
): { icon: React.ReactElement; className: FileIconClass } {
  if (type === 'directory') {
    return options.sceneVideo
      ? { icon: SCENE_VIDEO_ICON, className: 'video' }
      : { icon: FOLDER_ICON, className: 'folder' };
  }
  if (kind === 'code' && splitFileName(name).ext.toLowerCase() === '.json') {
    return { icon: JSON_ICON, className: kind };
  }
  return { icon: KIND_ICONS[kind], className: kind };
}
