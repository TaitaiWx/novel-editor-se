import { app } from 'electron';
import type { PersistedUpdaterState, RollbackTarget } from '../auto-updater-state';
import { isBoundRollbackTarget } from './rollback-metadata';
import {
  armRecovery,
  readRecoveryDescriptor,
  recoveryPhase,
  acknowledgeRecoveryHealth,
  cleanCompletedRecovery,
} from './recovery-supervisor';
export async function armUpdateRecovery(previous: RollbackTarget, targetVersion: string) {
  if (!app.isPackaged || !isBoundRollbackTarget(previous))
    throw new Error('独立恢复只支持经过校验的正式安装包');
  return armRecovery({
    userData: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    executable: process.execPath,
    appImage: process.env.APPIMAGE,
    previous,
    targetVersion,
  });
}
export async function syncExternalRecovery(state: PersistedUpdaterState) {
  const userData = app.getPath('userData');
  const d = await readRecoveryDescriptor(userData);
  if (!d) return;
  const phase = await recoveryPhase(userData);
  if (['recovering', 'restored-awaiting-health', 'recovered', 'failed'].includes(phase ?? '')) {
    state.rejectedVersion = d.target;
    state.rollbackPendingVersion = d.previous;
  }
  await cleanCompletedRecovery(userData);
}
export async function externalRecoveryOwnsFailure() {
  const userData = app.getPath('userData');
  const d = await readRecoveryDescriptor(userData);
  return Boolean(
    d &&
      app.getVersion() === d.target &&
      ['ready', 'watching', 'recovering', 'restored-awaiting-health', 'failed'].includes(
        (await recoveryPhase(userData)) ?? ''
      )
  );
}
export async function canConfirmExternalHealth() {
  const userData = app.getPath('userData');
  const d = await readRecoveryDescriptor(userData);
  if (!d || app.getVersion() !== d.target) return true;
  return ['ready', 'watching', 'healthy'].includes((await recoveryPhase(userData)) ?? '');
}
export function confirmExternalHealth() {
  return acknowledgeRecoveryHealth(app.getPath('userData'), app.getVersion());
}
