/**
 * 文件树图标：目录用文件夹图标，文件按大类使用同一套 Bootstrap Icons（线条风格统一），
 * 颜色由样式表中与大类同名的 class 控制。图标元素在模块级创建一次，各行复用。
 */
import React from 'react';
import { AiFillFolder } from 'react-icons/ai';
import {
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
const JSON_ICON = <BsFiletypeJson />;

export function getFileIcon(
  name: string,
  type: 'file' | 'directory',
  kind: FileKind = getFileKind(name)
): { icon: React.ReactElement; className: FileIconClass } {
  if (type === 'directory') return { icon: FOLDER_ICON, className: 'folder' };
  if (kind === 'code' && splitFileName(name).ext.toLowerCase() === '.json') {
    return { icon: JSON_ICON, className: kind };
  }
  return { icon: KIND_ICONS[kind], className: kind };
}
