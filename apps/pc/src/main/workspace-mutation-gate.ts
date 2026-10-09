/** Renderer drain barrier plus scoped cooperative GUI/CLI leases. */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  withWorkspaceLease,
  withWorkspaceWriterLease,
  runOutsideWorkspaceLease,
  canonicalWorkspaceResources,
  workspaceResourcesConflict,
  type WorkspaceLeaseOptions,
} from '@novel-editor/core';

const admission = new AsyncLocalStorage<{ active: boolean; options: WorkspaceLeaseOptions }>();
interface Request {
  snapshot: boolean;
  resources: Promise<string[] | null>;
  done: Promise<void>;
  started: Promise<void>;
}
const requests = new Set<Request>();

function schedule<T>(
  snapshot: boolean,
  task: () => Promise<T> | T,
  options: WorkspaceLeaseOptions | Promise<WorkspaceLeaseOptions>
): Promise<T> {
  // Register before asynchronous canonicalization so admission preserves IPC call order.
  const earlier = [...requests];
  const declared = Promise.resolve(options);
  let start!: () => void;
  let release!: () => void;
  const request: Request = {
    snapshot,
    resources: declared.then((value) => canonicalWorkspaceResources(value.resources)),
    started: new Promise((resolve) => {
      start = resolve;
    }),
    done: new Promise((resolve) => {
      release = resolve;
    }),
  };
  requests.add(request);
  return (async () => {
    try {
      const resources = await request.resources;
      await Promise.all(
        earlier.map(async (other) => {
          if (workspaceResourcesConflict(resources, await other.resources))
            await (snapshot || other.snapshot ? other.done : other.started);
        })
      );
      const leaseOptions = await declared;
      if (snapshot) return await withWorkspaceLease(task, leaseOptions);
      const scope = { active: true, options: leaseOptions };
      try {
        return await withWorkspaceWriterLease(() => {
          start();
          return admission.run(scope, task);
        }, leaseOptions);
      } finally {
        scope.active = false;
      }
    } finally {
      start();
      requests.delete(request);
      release();
    }
  })();
}

export function withWorkspaceMutation<T>(
  task: () => Promise<T> | T,
  options: WorkspaceLeaseOptions | Promise<WorkspaceLeaseOptions> = {}
): Promise<T> {
  if (admission.getStore()?.active)
    return Promise.resolve(options).then((value) => withWorkspaceLease(task, value));
  return schedule(false, task, options);
}

export function withWorkspaceSnapshot<T>(
  task: () => Promise<T>,
  options: WorkspaceLeaseOptions = {}
): Promise<T> {
  if (admission.getStore()?.active) throw new Error('Cannot snapshot inside a workspace mutation');
  return schedule(true, task, options);
}

/** Detached jobs keep the declared resource set, but acquire an independent lease. */
export function withBackgroundWorkspaceMutation<T>(
  task: () => Promise<T> | T,
  options?: WorkspaceLeaseOptions
): Promise<T> {
  const declared = options ?? admission.getStore()?.options ?? {};
  return admission.exit(() =>
    runOutsideWorkspaceLease(() => withWorkspaceMutation(task, declared))
  );
}
