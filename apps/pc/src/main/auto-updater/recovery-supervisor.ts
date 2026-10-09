/** OS-owned recovery lifecycle. No Electron dependency: a broken new runtime is never used. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import {
  access,
  link,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { RollbackTarget } from '../auto-updater-state';
const run = promisify(execFile);
const terminal = new Set(['healthy', 'recovered', 'failed', 'cancelled']);
export type RecoveryMode = 'mac' | 'nsis' | 'appimage' | 'deb';
export function recoveryCapability(platform: string, appImage: boolean) {
  const mode: RecoveryMode | null =
    platform === 'darwin'
      ? 'mac'
      : platform === 'win32'
        ? 'nsis'
        : platform === 'linux'
          ? appImage
            ? 'appimage'
            : 'deb'
          : null;
  return {
    mode,
    authorization: mode === 'deb' || mode === 'nsis' ? 'system-prompt' : 'none',
    reboot: 'next-user-login',
  } as const;
}
export function desktopQuote(value: string) {
  return `"${value.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&')}"`;
}
function xml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!
  );
}
export interface RecoveryDescriptor {
  protocol: 1;
  id: string;
  target: string;
  previous: string;
}
export function validateRecoveryDescriptor(value: unknown): value is RecoveryDescriptor {
  const d = value as RecoveryDescriptor | null;
  return Boolean(
    d &&
      d.protocol === 1 &&
      typeof d.id === 'string' &&
      typeof d.target === 'string' &&
      typeof d.previous === 'string' &&
      d.target !== d.previous &&
      /^[a-f0-9]{48}$/.test(d.id) &&
      /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(d.target) &&
      /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(d.previous)
  );
}
export async function readRecoveryDescriptor(userData: string) {
  const parsed: unknown = await readFile(join(userData, 'update-recovery', 'active.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return validateRecoveryDescriptor(parsed) ? parsed : null;
}
async function atomic(path: string, value: string) {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function windowsPowerShell() {
  return join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
}
function loginPath(id: string) {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'LaunchAgents', `com.novel-editor.recovery.${id}.plist`);
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'autostart',
    `novel-editor-recovery-${id}.desktop`
  );
}
async function registerLogin(d: RecoveryDescriptor, dir: string) {
  if (process.platform === 'win32') {
    // Persist in the current user's Run key, never HKLM, a service, or an elevated task.
    const command = `"${windowsPowerShell()}" -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "${join(dir, 'guardian.ps1')}" -Transaction "${dir}"`;
    await run('reg.exe', [
      'add',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      `NovelEditorRecovery-${d.id}`,
      '/t',
      'REG_SZ',
      '/d',
      command,
      '/f',
    ]);
    return;
  }
  const file = loginPath(d.id);
  await mkdir(dirname(file), { recursive: true });
  const args = ['/bin/sh', join(dir, 'guardian.sh'), dir];
  const contents =
    process.platform === 'darwin'
      ? `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.novel-editor.recovery.${d.id}</string><key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array><key>RunAtLoad</key><true/></dict></plist>`
      : `[Desktop Entry]\nType=Application\nName=Novel Editor Update Recovery\nNoDisplay=true\nTerminal=false\nExec=${args.map(desktopQuote).join(' ')}\n`;
  await atomic(file, contents);
}
async function unregisterLogin(d: RecoveryDescriptor) {
  if (process.platform === 'win32') {
    await run('reg.exe', [
      'delete',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v',
      `NovelEditorRecovery-${d.id}`,
      '/f',
    ]).catch(() => undefined);
  } else await rm(loginPath(d.id), { force: true });
}
export async function recoveryPhase(userData: string) {
  const d = await readRecoveryDescriptor(userData);
  if (!d) return null;
  return (
    await readFile(join(userData, 'update-recovery', d.id, 'phase'), 'utf8').catch(() => '')
  ).trim();
}
export async function acknowledgeRecoveryHealth(
  userData: string,
  version: string
): Promise<boolean> {
  const d = await readRecoveryDescriptor(userData);
  if (!d) return true;
  const phase = await recoveryPhase(userData);
  const dir = join(userData, 'update-recovery', d.id);
  if (version === d.target) {
    if (phase === 'healthy') return true;
    if (phase !== 'watching' && phase !== 'ready') return false;
    // Atomic arbitration shared with the OS guardian. A phase read alone is not a lock.
    const candidate = join(dir, `health-decision-${randomBytes(12).toString('hex')}`);
    const payload = `healthy:${d.id}:${version}`;
    await writeFile(candidate, payload, { mode: 0o600 });
    try {
      await link(candidate, join(dir, 'decision'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return (await readFile(join(dir, 'decision'), 'utf8').catch(() => '')) === payload;
    } finally {
      await rm(candidate, { force: true });
    }
  } else if (version === d.previous) {
    if (!['recovering', 'restored-awaiting-health', 'failed', 'recovered'].includes(phase ?? ''))
      return true;
  } else return true;
  await atomic(join(dir, 'healthy'), `${d.id}:${version}`);
  if (version === d.previous && phase === 'failed') await atomic(join(dir, 'phase'), 'recovered');
  await unregisterLogin(d);
  return true;
}
export interface ArmRecoveryOptions {
  userData: string;
  resourcesPath: string;
  executable: string;
  appImage?: string;
  targetVersion: string;
  previous: RollbackTarget;
}
export async function armRecovery(options: ArmRecoveryOptions) {
  const { userData, resourcesPath, executable, previous, targetVersion } = options;
  if (previous.recoveryProtocol !== 1 || !previous.cachedInstallerPath || !previous.sha256)
    throw new Error('旧版本未声明独立恢复确认协议，不能安全执行自动更新');
  const capability = recoveryCapability(process.platform, Boolean(options.appImage));
  if (!capability.mode) throw new Error('当前安装形式没有可用的独立恢复器');
  if (process.platform === 'darwin') await access('/usr/bin/lockf', constants.X_OK);
  if (process.platform === 'linux') await access('/usr/bin/flock', constants.X_OK);
  const root = join(userData, 'update-recovery');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const active = await readRecoveryDescriptor(userData);
  if (active && !terminal.has((await recoveryPhase(userData)) ?? ''))
    throw new Error('已有更新恢复事务正在进行');
  const descriptor: RecoveryDescriptor = {
    protocol: 1,
    id: randomBytes(24).toString('hex'),
    target: targetVersion,
    previous: previous.version,
  };
  if (!validateRecoveryDescriptor(descriptor)) throw new Error('更新恢复版本无效');
  const dir = join(root, descriptor.id);
  await mkdir(dir, { mode: 0o700 });
  try {
    // Probe the atomic publication primitive before replacing any application.
    const probe = join(dir, 'link-probe');
    await writeFile(probe, descriptor.id, { mode: 0o600 });
    await link(probe, `${probe}.linked`);
    await rm(probe);
    await rm(`${probe}.linked`);
    const artifact = join(dir, previous.assetName);
    await copyFile(previous.cachedInstallerPath, artifact, constants.COPYFILE_EXCL);
    if ((await digest(artifact)) !== previous.sha256) throw new Error('独立恢复包校验失败');
    const files: Record<string, string> = {
      nonce: descriptor.id,
      target: targetVersion,
      previous: previous.version,
      timeout: '180',
      artifact,
      sha256: previous.sha256,
      mode: capability.mode,
      executable,
    };
    if (capability.mode === 'mac') {
      const suffix = '/Contents/MacOS/';
      if (!executable.includes(suffix)) throw new Error('无法确定正式应用安装位置');
      const install = executable.slice(0, executable.lastIndexOf(suffix));
      await access(dirname(install), constants.W_OK);
      await access(install, constants.W_OK);
      const signature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', install]);
      const team = signature.stderr.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1];
      if (!team) throw new Error('独立恢复要求正式签名的 macOS 安装包');
      const requirement = `identifier "com.novel-editor.app" and anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
      const check = join(dir, 'verify');
      await mkdir(check);
      await run('/usr/bin/ditto', ['-x', '-k', artifact, check]);
      const bundle = join(check, 'Novel Editor.app');
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, bundle]);
      const version = await run('/usr/libexec/PlistBuddy', [
        '-c',
        'Print :CFBundleShortVersionString',
        join(bundle, 'Contents', 'Info.plist'),
      ]);
      if (version.stdout.trim() !== previous.version)
        throw new Error('恢复应用实际版本与清单不匹配');
      await rm(check, { recursive: true });
      files['install-path'] = install;
      files['signature-requirement'] = requirement;
      files.stage = join(dirname(install), `.novel-editor-restore-${descriptor.id}`);
      files['failed-path'] = join(dirname(install), `.novel-editor-failed-${descriptor.id}.app`);
    } else if (capability.mode === 'appimage') {
      files['install-path'] = resolve(options.appImage!);
      await access(dirname(files['install-path']), constants.W_OK);
      files.stage = join(
        dirname(files['install-path']),
        `.novel-editor-restore-${descriptor.id}.AppImage`
      );
      await access('/usr/bin/sha256sum', constants.X_OK);
    } else if (capability.mode === 'deb') {
      await access('/usr/bin/pkexec', constants.X_OK);
      await access('/usr/bin/dpkg', constants.X_OK);
      const installed = await run('/usr/bin/dpkg-query', ['-S', executable]);
      const packageName = installed.stdout.split(': ')[0].split(':')[0];
      const artifactPackage = await run('/usr/bin/dpkg-deb', ['--field', artifact, 'Package']);
      if (!packageName || artifactPackage.stdout.trim() !== packageName)
        throw new Error('恢复包不属于当前 Debian 安装');
      await access('/usr/bin/sha256sum', constants.X_OK);
      files['install-path'] = executable;
    } else {
      files['install-dir'] = dirname(executable);
      await access(windowsPowerShell(), constants.X_OK);
      const policy = await run(windowsPowerShell(), [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-Command',
        'Get-ExecutionPolicy',
      ]);
      if (!['RemoteSigned', 'Unrestricted', 'Bypass'].includes(policy.stdout.trim()))
        throw new Error(
          `Windows 组策略禁止执行本应用的恢复脚本（${policy.stdout.trim()}），需要管理员允许已签名恢复工具；已取消更新`
        );
    }
    await Promise.all(
      Object.entries(files).map(([name, value]) =>
        writeFile(join(dir, name), value, { mode: 0o600 })
      )
    );
    for (const name of [
      'guardian.sh',
      'guardian.ps1',
      'launch.ps1',
      'restore.sh',
      'publish-mac.sh',
    ])
      await copyFile(
        join(resourcesPath, 'recovery', name),
        join(dir, name === 'restore.sh' ? 'recover.sh' : name)
      );
    await registerLogin(descriptor, dir);
    await atomic(join(root, 'active.json'), JSON.stringify(descriptor));
    const env = { ...process.env };
    // A Linux recovery process must not be mistaken for a running AppImage instance.
    delete env.APPIMAGE;
    delete env.APPDIR;
    delete env.ELECTRON_RUN_AS_NODE;
    const child =
      process.platform === 'win32'
        ? spawn(
            windowsPowerShell(),
            [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'RemoteSigned',
              '-File',
              join(dir, 'launch.ps1'),
              '-Transaction',
              dir,
            ],
            { detached: true, stdio: 'ignore', windowsHide: true, env }
          )
        : spawn('/bin/sh', [join(dir, 'guardian.sh'), dir], {
            detached: true,
            stdio: 'ignore',
            env,
          });
    let launchError: Error | null = null;
    child.on('error', (error) => {
      launchError = error;
    });
    child.unref();
    if (process.platform === 'win32')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('恢复启动器未退出')), 10_000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error('恢复启动器失败'));
        });
      });
    const deadline = Date.now() + 10_000;
    while ((await recoveryPhase(userData)) !== 'ready') {
      if (launchError) throw launchError;
      if (Date.now() > deadline || (process.platform !== 'win32' && child.exitCode !== null))
        throw new Error('独立恢复进程未就绪，已阻止安装');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      capability,
      commit: () => atomic(join(dir, 'commit'), String(process.pid)),
      cancel: async () => {
        await atomic(join(dir, 'cancel'), '1');
        await unregisterLogin(descriptor);
      },
    };
  } catch (error) {
    await writeFile(join(dir, 'cancel'), '1').catch(() => undefined);
    await unregisterLogin(descriptor).catch(() => undefined);
    await writeFile(join(dir, 'phase'), 'cancelled').catch(() => undefined);
    throw error;
  }
}
/** Remove only completed recovery registration, never a pending recovery transaction. */
export async function cleanCompletedRecovery(userData: string) {
  const d = await readRecoveryDescriptor(userData);
  if (!d || !terminal.has((await recoveryPhase(userData)) ?? '')) return;
  await unregisterLogin(d);
  const root = join(userData, 'update-recovery');
  // Keep active diagnostics, discard older completed transactions to bound disk usage.
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{48}$/.test(name) || name === d.id) continue;
    const phase = (await readFile(join(root, name, 'phase'), 'utf8').catch(() => '')).trim();
    if (terminal.has(phase)) await rm(join(root, name), { recursive: true, force: true });
  }
}
