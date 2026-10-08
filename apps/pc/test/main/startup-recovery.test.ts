import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STARTUP_MAX_RETRIES,
  STARTUP_RETRY_HASH,
  buildStartupErrorHtml,
  isStartupRetryUrl,
  startupRetryDelayMs,
} from '../../src/main/startup-recovery';
import { swapDirectory } from '../../../../vitest.e2e.global-setup';

describe('启动恢复', () => {
  it('重试间隔逐次加长，总等待足以跨过一次构建产物重建', () => {
    const delays = Array.from({ length: STARTUP_MAX_RETRIES }, (_, index) =>
      startupRetryDelayMs(index + 1)
    );
    expect(delays).toEqual([800, 2000, 4000]);
    expect(delays.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(6000);
    expect(startupRetryDelayMs(0)).toBe(800);
    expect(startupRetryDelayMs(99)).toBe(4000);
  });

  it('错误页的「重试启动」改 hash（不是 location.reload），原因被转义', () => {
    const html = buildStartupErrorHtml('页面加载失败: <ERR_FILE_NOT_FOUND> & "x"');
    expect(html).toContain(`location.hash='${STARTUP_RETRY_HASH}'`);
    expect(html).not.toContain('location.reload()');
    expect(html).toContain('&lt;ERR_FILE_NOT_FOUND&gt; &amp; &quot;x&quot;');
  });

  it('识别重试地址', () => {
    expect(isStartupRetryUrl(`data:text/html,abc#${STARTUP_RETRY_HASH}`)).toBe(true);
    expect(isStartupRetryUrl(`file:///app/index.html#${STARTUP_RETRY_HASH}`)).toBe(true);
    expect(isStartupRetryUrl('file:///app/index.html#other')).toBe(false);
    expect(isStartupRetryUrl('not a url')).toBe(false);
  });
});

describe('E2E 构建替换 dist', () => {
  it('新构建整体替换旧 dist，不留旧文件与临时目录', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'swap-dist-'));
    const target = path.join(root, 'dist');
    const staging = path.join(root, '.dist-staging-1');
    mkdirSync(target);
    writeFileSync(path.join(target, 'old.js'), 'old');
    mkdirSync(staging);
    writeFileSync(path.join(staging, 'index.html'), 'new');
    swapDirectory(staging, target);
    expect(readFileSync(path.join(target, 'index.html'), 'utf-8')).toBe('new');
    expect(existsSync(path.join(target, 'old.js'))).toBe(false);
    expect(existsSync(staging)).toBe(false);
  });

  it('原来没有 dist 时直接放入', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'swap-dist-'));
    const staging = path.join(root, '.dist-staging-2');
    mkdirSync(staging);
    writeFileSync(path.join(staging, 'index.html'), 'new');
    swapDirectory(staging, path.join(root, 'dist'));
    expect(existsSync(path.join(root, 'dist', 'index.html'))).toBe(true);
  });
});
