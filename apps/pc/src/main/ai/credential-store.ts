/**
 * AI 密钥安全存储（Electron safeStorage）
 *
 * - 每个 Provider 一条，`safeStorage.encryptString` 加密后 base64 写入 userData/ai-credentials.json（权限 0600）
 * - macOS 钥匙串 / Windows DPAPI / Linux libsecret|kwallet 提供加密；系统不支持加密（或 Linux 只有
 *   basic_text 后端）时退化为受限权限文件明文保存，并通过 isSecure() 告知设置中心提示作者
 * - 渲染进程永远拿不到明文：只有主进程在发起请求时调用 get()
 * - 密钥按应用全局保存（不跟随项目），避免项目文件夹被分享时泄露
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface StoredEntry {
  data: string;
  encrypted: boolean;
  updatedAt: string;
}

interface StoredFile {
  schemaVersion: 1;
  entries: Record<string, StoredEntry>;
}

export const CREDENTIALS_FILE_NAME = 'ai-credentials.json';
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertProviderId(id: unknown): string {
  if (typeof id !== 'string' || !PROVIDER_ID_PATTERN.test(id)) {
    throw new Error('无效的 AI 服务 id');
  }
  return id;
}

export class CredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /** 系统是否提供可靠的加密（Linux basic_text 视为不可靠） */
  isSecure(): boolean {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return false;
      const backend = this.safeStorage.getSelectedStorageBackend?.();
      return backend !== 'basic_text';
    } catch {
      return false;
    }
  }

  private read(): StoredFile {
    if (!existsSync(this.filePath)) return { schemaVersion: 1, entries: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<StoredFile>;
      const entries =
        parsed && typeof parsed.entries === 'object' && parsed.entries !== null
          ? parsed.entries
          : {};
      return { schemaVersion: 1, entries: { ...entries } };
    } catch {
      // 文件损坏：视为空（不抛出，避免整个 AI 功能不可用；作者重新填写 Key 即可）
      return { schemaVersion: 1, entries: {} };
    }
  }

  private write(file: StoredFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, this.filePath);
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Windows 不支持 POSIX 权限，忽略
    }
  }

  has(providerId: string): boolean {
    return this.get(providerId) !== null;
  }

  /** 解密后的密钥；没有或无法解密（换了系统账户 / 钥匙串被重置）时返回 null */
  get(providerId: string): string | null {
    const entry = this.read().entries[assertProviderId(providerId)];
    if (!entry || typeof entry.data !== 'string' || !entry.data) return null;
    try {
      if (!entry.encrypted) return Buffer.from(entry.data, 'base64').toString('utf-8') || null;
      return this.safeStorage.decryptString(Buffer.from(entry.data, 'base64')) || null;
    } catch {
      return null;
    }
  }

  set(providerId: string, secret: string): void {
    const id = assertProviderId(providerId);
    const value = secret.trim();
    if (!value) throw new Error('API Key 不能为空');
    if (value.length > 4096) throw new Error('API Key 过长');
    const file = this.read();
    const encrypted = this.isSecure();
    const data = encrypted
      ? this.safeStorage.encryptString(value).toString('base64')
      : Buffer.from(value, 'utf-8').toString('base64');
    file.entries[id] = { data, encrypted, updatedAt: this.clock().toISOString() };
    this.write(file);
  }

  delete(providerId: string): boolean {
    const id = assertProviderId(providerId);
    const file = this.read();
    if (!file.entries[id]) return false;
    delete file.entries[id];
    this.write(file);
    return true;
  }

  /** 已保存密钥的 Provider（不含密钥本身） */
  list(): Array<{ providerId: string; encrypted: boolean; updatedAt: string }> {
    return Object.entries(this.read().entries).map(([providerId, entry]) => ({
      providerId,
      encrypted: Boolean(entry.encrypted),
      updatedAt: entry.updatedAt,
    }));
  }
}
