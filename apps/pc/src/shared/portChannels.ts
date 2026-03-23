/**
 * MessagePort 通道名常量。
 *
 * 主进程（establishPortChannel）和渲染进程（useMessagePort）共享，
 * 确保通道名一致，避免拼写错误导致的静默通信失败。
 *
 * 使用 const enum 以获得零运行时开销（编译时内联为字符串字面量）。
 * 添加新通道只需在此处新增一行。
 */
export const enum PortChannel {
  /** 编辑内容同步：主窗口 → 独立面板窗口 */
  ContentSync = 'content-sync',
  /** 增量操作流同步：主窗口 → 独立面板窗口（协同编辑预留） */
  CrdtOps = 'crdt-ops',
}
