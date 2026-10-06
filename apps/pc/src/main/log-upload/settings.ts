/**
 * 日志上传设置（userData/log-upload-settings.json）
 *
 * 由主进程持有：崩溃发生时渲染进程可能已经不在了，开关必须在主进程直接可读
 */
import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeLogUploadSettings, type LogUploadSettings } from '../../shared/log-upload';

let cached: LogUploadSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'log-upload-settings.json');
}

export async function loadLogUploadSettings(): Promise<LogUploadSettings> {
  if (cached) return cached;
  try {
    cached = normalizeLogUploadSettings(JSON.parse(await readFile(settingsPath(), 'utf-8')));
  } catch {
    cached = normalizeLogUploadSettings(null);
  }
  return cached;
}

export async function saveLogUploadSettings(patch: unknown): Promise<LogUploadSettings> {
  const current = await loadLogUploadSettings();
  const raw = patch && typeof patch === 'object' ? (patch as Partial<LogUploadSettings>) : {};
  const next = normalizeLogUploadSettings({ ...current, ...raw });
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8');
  cached = next;
  return next;
}

/** 仅供测试：清空缓存 */
export function resetLogUploadSettingsCache(): void {
  cached = null;
}
