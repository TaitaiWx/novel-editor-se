/** 当前挂载的资料表单在离开前定位未处理内容；拒绝时导航保持原地。 */
type LeaveGuard = (target: string | null) => boolean;
const guards = new Set<LeaveGuard>();
export function registerWorkspaceLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
export function canLeaveWorkspace(target: string | null): boolean {
  for (const guard of [...guards]) if (!guard(target)) return false;
  return true;
}
