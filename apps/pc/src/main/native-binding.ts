/**
 * better-sqlite3 native module path resolution
 *
 * Packaged Electron apps cannot auto-locate .node files via the bindings module.
 * This provides an explicit path to the native binding.
 */
import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';

let _nativeBinding: string | undefined;
let _nativeBindingResolved = false;

export function getNativeBinding(): string | undefined {
  if (_nativeBindingResolved) return _nativeBinding;
  _nativeBindingResolved = true;

  if (!app.isPackaged) return undefined;

  const unpackedPath = app.getAppPath() + '.unpacked';
  const bindingPath = path.join(
    unpackedPath,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );

  if (existsSync(bindingPath)) {
    _nativeBinding = bindingPath;
  } else {
    console.warn('better-sqlite3 native binding not found at:', bindingPath);
  }

  return _nativeBinding;
}
