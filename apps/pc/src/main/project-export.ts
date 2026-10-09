import { copyProjectTo, type ProjectCopyOptions } from '@novel-editor/core';
import { withWorkspaceSnapshot } from './workspace-mutation-gate';

export interface ProjectExportOptions extends ProjectCopyOptions {
  prepare: Array<() => Promise<{ release(): void } | null>>;
  drain: () => Promise<void>;
}
export async function exportPreparedProject(
  source: string,
  parent: string,
  options: ProjectExportOptions
): Promise<string | null> {
  const leases: Array<{ release(): void }> = [];
  try {
    for (const prepare of options.prepare) {
      const lease = await prepare();
      if (!lease) return null;
      leases.push(lease);
    }
    return await withWorkspaceSnapshot(
      async () => {
        await options.drain();
        return copyProjectTo(source, parent, options);
      },
      { resources: [source, parent] }
    );
  } finally {
    for (const lease of leases.reverse()) lease.release();
  }
}
