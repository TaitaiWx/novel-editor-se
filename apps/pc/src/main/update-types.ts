export type UpdateChannel = 'stable' | 'beta' | 'canary';

export type RuntimeCopyName = 'a' | 'b';

export type RuntimeSource = 'embedded' | 'downloaded';

export interface RuntimeCopyRecord {
  copyName: RuntimeCopyName;
  version: string | null;
  runtimeApiVersion: number;
  bundleHash: string | null;
  bundleSize: number | null;
  source: RuntimeSource | null;
  preparedAt: string | null;
  lastHealthyAt: string | null;
  failedLaunches: number;
}

export interface RuntimeBootSession {
  copyName: RuntimeCopyName;
  version: string;
  startedAt: string;
  healthyAt: string | null;
  gracefulExitRequestedAt: string | null;
}

export interface RuntimeCopyBootState {
  schemaVersion: number;
  launcherVersion: string;
  channel: UpdateChannel;
  stableCopy: RuntimeCopyName | null;
  pendingCopy: RuntimeCopyName | null;
  currentCopy: RuntimeCopyName | null;
  lastKnownGoodVersion: string | null;
  lastError: string | null;
  copies: Record<RuntimeCopyName, RuntimeCopyRecord>;
  bootSession: RuntimeBootSession | null;
}

export interface RuntimeDescriptor {
  version: string;
  channel: UpdateChannel;
  runtimeApiVersion: number;
  rootDir: string;
  distDir: string;
  source: RuntimeSource | 'dev';
  copyName: RuntimeCopyName | 'embedded';
}

export interface RuntimePackageManifest {
  schemaVersion: number;
  runtimeApiVersion: number;
  channel: UpdateChannel;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  stagingPercentage: number;
  bundleFile: string;
  sha256: string;
  size: number;
  publishedAt: string;
  releaseNotesFile?: string;
}
