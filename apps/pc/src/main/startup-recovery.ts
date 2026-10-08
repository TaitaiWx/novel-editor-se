/**
 * 启动恢复（主帧加载失败 / 渲染进程崩溃 / 超时未就绪）的纯函数部分：
 * - 重试间隔逐次加长：构建产物被重建（例如开发时 E2E 或打包脚本正在重写 dist）通常只缺几百毫秒，
 *   立刻连续重试会在文件回来之前就用完次数，直接进入安全模式
 * - 安全模式错误页：「重试启动」不能用 location.reload()（那只会重新加载错误页本身），
 *   改为修改地址的 hash，由主进程监听到后重新加载渲染界面
 */

/** 主帧加载失败时最多自动重试几次（之后显示安全模式错误页） */
export const STARTUP_MAX_RETRIES = 3;

/** 第 attempt 次重试（从 1 开始）前等待的毫秒数 */
export function startupRetryDelayMs(attempt: number): number {
  const schedule = [800, 2000, 4000];
  const index = Math.max(0, Math.min(schedule.length - 1, attempt - 1));
  return schedule[index];
}

/** 错误页上「重试启动」写入的 hash，主进程据此重新加载渲染界面 */
export const STARTUP_RETRY_HASH = 'retry-startup';

export function isStartupRetryUrl(url: string): boolean {
  try {
    return new URL(url).hash === `#${STARTUP_RETRY_HASH}`;
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 安全模式错误页（data: URL 加载，不依赖构建产物） */
export function buildStartupErrorHtml(reason: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>小说编辑器启动失败</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #171a21;
        color: #e6e8ef;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        width: min(680px, calc(100vw - 48px));
        background: #1f2430;
        border: 1px solid #343b4f;
        border-radius: 14px;
        padding: 24px;
        box-sizing: border-box;
      }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; line-height: 1.6; color: #c8cfde; }
      code {
        display: block;
        margin-top: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        background: #131722;
        color: #9bb2ff;
        word-break: break-word;
      }
      button {
        margin-top: 16px;
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #3b82f6;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>启动失败，已进入安全模式</h1>
      <p>渲染界面加载异常，应用已自动重试但未恢复。</p>
      <p>你可以点击“重试启动”，或重启应用后再次尝试更新。</p>
      <code>${escapeHtml(reason)}</code>
      <button id="retry" onclick="location.hash='${STARTUP_RETRY_HASH}'">重试启动</button>
    </section>
  </body>
</html>`;
}
