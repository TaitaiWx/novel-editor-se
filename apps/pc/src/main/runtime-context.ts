import { app } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { RuntimeDescriptor } from './update-types';
import { inferDefaultChannel } from './runtime-copies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let currentRuntimeDescriptor: RuntimeDescriptor = {
  version: app.getVersion(),
  channel: inferDefaultChannel(app.getVersion()),
  runtimeApiVersion: 1,
  rootDir: join(__dirname, '..'),
  distDir: __dirname,
  source: 'dev',
  copyName: 'embedded',
};

export function setCurrentRuntimeDescriptor(nextDescriptor: RuntimeDescriptor) {
  currentRuntimeDescriptor = nextDescriptor;
}

export function getCurrentRuntimeDescriptor(): RuntimeDescriptor {
  return currentRuntimeDescriptor;
}

export function getCurrentRuntimeVersion(): string {
  return currentRuntimeDescriptor.version;
}

export function getCurrentRuntimeChannel() {
  return currentRuntimeDescriptor.channel;
}

export function getCurrentRuntimeDistDir() {
  return currentRuntimeDescriptor.distDir;
}

export function getCurrentRuntimeRootDir() {
  return currentRuntimeDescriptor.rootDir;
}

export function getCurrentRuntimeCopyName() {
  return currentRuntimeDescriptor.copyName;
}
