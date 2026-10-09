import path from 'node:path';
import { getDatabase, videoTaskOps } from '@novel-editor/store';

/** The runner can touch every task in the current connection, including detached downloads. */
export function getVideoWorkspaceResources(extraWorkPath?: unknown): {
  database?: ReturnType<typeof getDatabase>;
  resources?: string[];
} {
  let database: ReturnType<typeof getDatabase> | undefined;
  try {
    database = getDatabase();
    const works = videoTaskOps.list<{ workPath: unknown }>({}).map((task) => task.workPath);
    if (extraWorkPath !== undefined) works.push(extraWorkPath);
    const absolute = (value: unknown): value is string =>
      typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value);
    if (!absolute(database.name) || !works.every(absolute)) return { database };
    return { database, resources: [database.name, ...works] };
  } catch {
    // Missing connection or undeclared legacy task metadata must exclude all resources.
    return { database };
  }
}
