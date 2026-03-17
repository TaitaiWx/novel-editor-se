import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let cachedId: string | null = null;

export function getDeviceId(): string {
  if (cachedId) return cachedId;

  const dir = app.getPath('userData');
  const filePath = join(dir, 'device-id');

  try {
    const id = readFileSync(filePath, 'utf-8').trim();
    if (id) {
      cachedId = id;
      return id;
    }
  } catch {
    // File doesn't exist yet — create it
  }

  const newId = randomUUID();
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, newId, 'utf-8');
  cachedId = newId;
  return newId;
}
