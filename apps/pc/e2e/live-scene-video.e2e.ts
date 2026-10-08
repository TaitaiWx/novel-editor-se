/**
 * 场景视频 · 真实服务全流程（可选，只有设置了 NE_LIVE_* Key 时运行；会产生费用）
 *
 * 在应用里（窗口照常显示）走一遍作者的真实操作：
 * 打开 001-启程 → 选中「第一场」→ 文件栏「场景视频」→ 真实文本模型自动拆分镜 → 第一个镜头的对白生成配音 →
 * 「生成 N 个镜头」→ 真实视频服务逐个出片并下载 → 全部成片后自动合成样片（含声音）。
 * 结束后把这一场的目录（成片、样片、配音、分镜.json / 分镜.md）复制到示例作品《星河旅人》的
 * `资料/AI实测/场景视频-<服务>/`，并写一份「场景视频实测.md」（::video / ::audio 嵌入），在应用里打开就能看。
 *
 * 用法（在仓库根目录）：
 *   set -a; . ~/.config/novel-editor-live/keys.env; set +a
 *   NE_LIVE_PROXY=http://127.0.0.1:7890 NE_LIVE_SCENE_VIDEO=grok pnpm test:e2e apps/pc/e2e/live-scene-video.e2e.ts
 *
 * NE_LIVE_SCENE_VIDEO：grok（默认，最快）/ seedance / minimax / gemini；文本用 DeepSeek（NE_LIVE_DEEPSEEK_KEY），
 * 配音用 MiniMax（NE_LIVE_MINIMAX_KEY，没有时跳过配音）。
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPreset } from '../src/shared/ai-models';
import { captureForReview, openChapter, setupAppSuite } from './support/suite';

interface VideoChoice {
  preset: string;
  vendor: string;
  keyEnv: string;
  model?: string;
  proxy?: boolean;
}

const VIDEO_CHOICES: Record<string, VideoChoice> = {
  grok: {
    preset: 'grok-video',
    vendor: 'grok-video',
    keyEnv: 'NE_LIVE_GROK_KEY',
    model: 'grok-imagine-video-1.5',
    proxy: true,
  },
  seedance: {
    preset: 'seedance',
    vendor: 'seedance-video',
    keyEnv: 'NE_LIVE_VOLC_KEY',
    model: 'doubao-seedance-2-0-mini-260615',
  },
  minimax: { preset: 'minimax-video', vendor: 'minimax-video', keyEnv: 'NE_LIVE_MINIMAX_KEY' },
  gemini: {
    preset: 'gemini-video',
    vendor: 'gemini-video',
    keyEnv: 'NE_LIVE_GEMINI_KEY',
    proxy: true,
  },
};

const choiceName = process.env.NE_LIVE_SCENE_VIDEO?.trim() || 'grok';
const video = VIDEO_CHOICES[choiceName];
const textKey = process.env.NE_LIVE_DEEPSEEK_KEY?.trim();
const videoKey = video ? process.env[video.keyEnv]?.trim() : undefined;
const speechKey = process.env.NE_LIVE_MINIMAX_KEY?.trim();
const proxyUrl = process.env.NE_LIVE_PROXY?.trim();

const SCENE = '第一场 清晨的青石镇';
const CHAPTER_FILE = ['novels', '星河旅人', '第一卷-离乡', '001-启程.md'];
const SCENE_DIR = ['novels', '星河旅人', '资料', '视频', '001-启程', SCENE];
/** 结果复制到仓库里的示例作品（本机查看，目录被 gitignore） */
const SAMPLE_WORK = path.resolve(__dirname, '..', 'sample-data', 'novels', '星河旅人');
const SHOT_FILE = /^镜头(\d+)-v\d+\.mp4$/;
const ANIMATIC_FILE = /^样片-.+\.(mp4|webm)$/;

describe.skipIf(!video || !textKey || !videoKey)(`场景视频 · 真实服务（${choiceName}）`, () => {
  const suite = setupAppSuite({
    fixture: {
      prefix: 'novel-editor-e2e-live-scene-',
      // 示例里预先做好了这一场：去掉它，从零走一遍
      exclude: ['novels/星河旅人/资料/视频/001-启程'],
    },
  });

  it(
    '选中一场 → AI 拆分镜 → 配音 → 生成全部镜头 → 自动合成样片；结果复制到示例作品',
    async () => {
      const { page, fixture } = suite;
      const sceneDir = fixture.resolve(...SCENE_DIR);

      // 1. 打开「启用 AI 功能」，设置代理，添加模型（文本 / 视频 / 配音）
      await page.click('[aria-label="打开设置中心"]');
      await page.waitForTarget({ text: '设置中心', exact: true });
      await page.click({ text: 'AI', within: '[class*="sidebar"]', exact: true });
      await page.waitFor(
        () => Boolean(document.querySelector('input[role="switch"][aria-label="启用 AI 功能"]')),
        { message: '「启用 AI 功能」开关' }
      );
      await page.evaluate(() => {
        const master = document.querySelector(
          'input[role="switch"][aria-label="启用 AI 功能"]'
        ) as HTMLInputElement;
        if (!master.checked) master.click();
      });
      await page.click('[aria-label="关闭设置"]');
      await page.waitForGone({ text: '设置中心', exact: true });
      if (proxyUrl) {
        await page.evaluate(
          (url: string) =>
            window.electron.ipcRenderer.invoke('ai-proxy-set', { mode: 'manual', url }),
          proxyUrl
        );
      }
      const add = async (input: Record<string, unknown>) => {
        const preset = findPreset(String(input.preset));
        const result = await page.evaluate<{
          ok: boolean;
          data?: { id: string };
          error?: { message: string };
        }>(
          (payload: Record<string, unknown>) =>
            window.electron.ipcRenderer.invoke('ai-models-add', payload),
          {
            baseUrl: preset?.baseUrl ?? '',
            model: preset?.models[0] ?? '',
            ...input,
          }
        );
        expect(result.error?.message, String(input.preset)).toBeUndefined();
        return result.data!.id;
      };
      await add({
        capability: 'text',
        vendor: 'openai-compatible',
        preset: 'deepseek',
        apiKey: textKey,
      });
      await add({
        capability: 'video',
        vendor: video!.vendor,
        preset: video!.preset,
        apiKey: videoKey,
        useProxy: Boolean(video!.proxy && proxyUrl),
        ...(video!.model ? { model: video!.model } : {}),
      });
      if (speechKey) {
        await add({
          capability: 'speech',
          vendor: 'minimax-speech',
          preset: 'minimax-speech',
          apiKey: speechKey,
        });
      }

      // 2. 打开章节，选中「第一场」正文，打开场景视频
      await openChapter(page, '001-启程', '林舟背起行囊');
      const chapterText = await readFile(fixture.resolve(...CHAPTER_FILE), 'utf-8');
      const endLine =
        chapterText.split(/\r?\n/).findIndex((line) => line.startsWith('“你一定要回来。”')) + 1;
      await page.waitFor(
        (line: number) => {
          const status = document.querySelector('[class*="statusBar"]')?.textContent ?? '';
          const column = Number(new RegExp(`行 ${line}, 列 (\\d+)`).exec(status)?.[1] ?? 0);
          if (column > 1) return true;
          const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-content .cm-line'));
          const start = lines.find((item) => item.textContent?.startsWith('石板路还湿着'));
          const end = lines.find((item) => item.textContent?.startsWith('“你一定要回来。”'));
          if (!start || !end) return false;
          (document.querySelector('.cm-content') as HTMLElement).focus();
          const range = document.createRange();
          range.setStart(start, 0);
          range.setEnd(end, end.childNodes.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return false;
        },
        { args: [endLine], message: '编辑器选区已同步到第一场末行' }
      );
      await page.click('[data-testid="scene-video-pill"]');
      await page.waitForTarget('[data-testid="scene-video-view"]', 15_000);

      // 3. 真实文本模型自动拆分镜
      const SHOT_NODES = '[data-testid="scene-canvas"] [role="group"][aria-label^="镜头 "]';
      const shotCount = await page.waitFor<number>(
        (selector: string) => {
          const count = document.querySelectorAll(selector).length;
          return count >= 2 ? count : 0;
        },
        { args: [SHOT_NODES], timeout: 180_000, message: 'AI 拆出镜头节点' }
      );
      await captureForReview(page, 'live-scene-storyboard');

      // 4. 有对白的镜头逐个「全部生成配音」（样片合成时混进对白）
      let dubbedShots = 0;
      if (speechKey) {
        for (let index = 1; index <= shotCount; index += 1) {
          await page.click(`[role="group"][aria-label="镜头 ${index}"] p`);
          await page.waitForTarget('[data-testid="scene-inspector"]');
          const clicked = await page.evaluate<boolean>(() => {
            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>('[data-testid="shot-dialogue"] button')
            ).find((item) => item.textContent?.startsWith('全部生成配音') && !item.disabled);
            button?.click();
            return Boolean(button);
          });
          if (!clicked) continue;
          dubbedShots += 1;
          await page.waitUntil(
            async () =>
              (await readdir(sceneDir).catch(() => [] as string[])).some((file) =>
                file.startsWith(`镜头${index}-台词-`)
              ),
            { timeout: 120_000, message: `镜头 ${index} 的对白配音已落盘` }
          );
        }
        await page.press('Escape');
        expect(dubbedShots, 'AI 分镜里应当有带对白的镜头').toBeGreaterThan(0);
      }

      // 5. 作者检查 AI 拟的分镜草稿后「确认分镜」（确认前不能生成），再「生成 N 个镜头」
      await page.waitForTarget('[data-testid="storyboard-draft-notice"]');
      await page.click('[data-testid="confirm-storyboard"]');
      await page.waitForGone('[data-testid="storyboard-draft-notice"]');
      // 真实视频服务逐个出片，下载到资料
      await page.waitFor(
        () =>
          Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(
            (button) =>
              /^生成 \d+ 个镜头$/.test(button.textContent?.trim() ?? '') && !button.disabled
          ),
        { timeout: 30_000, message: '「生成 N 个镜头」可用' }
      );
      await page.evaluate(() => {
        Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => /^生成 \d+ 个镜头$/.test(button.textContent?.trim() ?? ''))
          ?.click();
        return true;
      });
      await page.waitUntil(
        async () => {
          const files = await readdir(sceneDir).catch(() => [] as string[]);
          const shots = new Set(files.map((file) => SHOT_FILE.exec(file)?.[1]).filter(Boolean));
          return shots.size >= shotCount;
        },
        { timeout: 25 * 60_000, message: `全部 ${shotCount} 个镜头的成片已下载` }
      );
      await captureForReview(page, 'live-scene-shots');

      // 6. 全部成片后自动合成样片
      await page.waitUntil(
        async () => (await readdir(sceneDir)).some((file) => ANIMATIC_FILE.test(file)),
        { timeout: 5 * 60_000, message: '样片已自动合成' }
      );
      await captureForReview(page, 'live-scene-animatic');

      // 7. 复制到示例作品的 资料/AI实测/场景视频-<服务>/，写一份可以直接看的说明
      const target = path.join(SAMPLE_WORK, '资料', 'AI实测', `场景视频-${choiceName}`);
      await rm(target, { recursive: true, force: true });
      await mkdir(path.dirname(target), { recursive: true });
      await cp(sceneDir, target, { recursive: true });
      const files = (await readdir(target)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const relative = `资料/AI实测/场景视频-${choiceName}`;
      const lines = [
        `# 场景视频实测（${choiceName}）`,
        '',
        `001-启程 · ${SCENE}：DeepSeek 拆分镜 → ${video!.preset} 生成 ${shotCount} 个镜头 → 自动合成样片` +
          (speechKey ? `；${dubbedShots} 个镜头的对白用 MiniMax 配音` : '') +
          `（${new Date().toLocaleString('zh-CN', { hour12: false })}）。`,
        '',
        '## 样片',
        '',
        ...files
          .filter((file) => ANIMATIC_FILE.test(file))
          .map((file) => `::video[样片]{src="${relative}/${file}"}\n`),
        '## 镜头',
        '',
        ...files
          .filter((file) => SHOT_FILE.test(file))
          .map((file) => `::video[${file.replace(/\.mp4$/, '')}]{src="${relative}/${file}"}\n`),
        ...(files.some((file) => file.includes('-台词-'))
          ? [
              '## 配音',
              '',
              ...files
                .filter((file) => file.includes('-台词-'))
                .map((file) => `::audio[${file}]{src="${relative}/${file}"}\n`),
            ]
          : []),
        '## 分镜',
        '',
        (
          await readFile(path.join(target, '分镜.md'), 'utf-8').catch(() => '（没有分镜.md）')
        ).trim(),
        '',
      ];
      await writeFile(path.join(target, '场景视频实测.md'), `${lines.join('\n')}\n`);
      expect(files.filter((file) => SHOT_FILE.test(file)).length).toBeGreaterThanOrEqual(shotCount);
    },
    40 * 60_000
  );
});
