/**
 * 自动更新模块入口：静默更新、版本指针 + 高可用回滚、金丝雀/灰度发布。
 *
 * 目录结构：
 * - constants.ts      常量
 * - channel.ts        通道推断与元数据文件名（纯函数）
 * - rollout.ts        灰度分桶与资格判断（纯函数）
 * - policy.ts         退避、网络错误识别、版本指针/回滚判定（纯函数）
 * - assets.ts         回滚安装包选择与缓存清理策略（纯函数）
 * - status.ts         对渲染进程广播的状态快照
 * - state-store.ts    持久化状态读写
 * - loader.ts         electron-updater 懒加载与配置
 * - network.ts        弱网恢复
 * - rollback.ts       回滚安装包缓存与执行回滚
 * - health.ts         启动健康检测
 * - controller.ts     事件绑定与对外操作
 */
export type { UpdateChannel } from '../auto-updater-state';
export type { UpdateStatus } from './status';
export {
  checkForUpdatesManually,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  setupAutoUpdater,
} from './controller';
export { noteUpdaterRendererHealthy, noteUpdaterRendererReady } from './health';
export { rollbackToPreviousVersion } from './rollback';
