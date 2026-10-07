/**
 * 正文结构规则（「设置 → 正文结构」）的 IPC 协议：主进程 project-structure-get / set ↔ 渲染进程
 *
 * 配置本身的类型与校验在 @novel-editor/core/structure-rules（GUI / CLI 共用），
 * 存储位置见 core structure-config：`ne init` 项目写 config.json 的 structure 字段，普通文件夹写 .novel-editor/structure.json。
 */
import type { StructureConfig } from '@novel-editor/core/structure-rules';

export const PROJECT_STRUCTURE_GET = 'project-structure-get';
export const PROJECT_STRUCTURE_SET = 'project-structure-set';
/** 保存后广播给所有窗口：{ folderPath, config } */
export const PROJECT_STRUCTURE_CHANGED = 'project-structure-changed';

export interface ProjectStructureInfo {
  /** 项目根 / 文件夹（与请求的 folderPath 相同，已规范化） */
  folderPath: string;
  config: StructureConfig;
  /** project：.novel-editor/config.json；folder：.novel-editor/structure.json */
  location: 'project' | 'folder';
  /** 配置文件的绝对路径 */
  file: string;
  /** 是否已保存过（否则为默认规则） */
  stored: boolean;
  warnings: string[];
}

export type ProjectStructureResult =
  | { ok: true; data: ProjectStructureInfo }
  | { ok: false; error: string };

export interface ProjectStructureChangedEvent {
  folderPath: string;
  config: StructureConfig;
}
