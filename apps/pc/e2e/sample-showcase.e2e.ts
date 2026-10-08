/**
 * 示例作品集展示（独立的 Electron 实例，fixture 就是完整的示例作品集，不配置任何 AI 服务）：
 *
 * - 声音示例.md：::audio 就地显示为音频播放条（播放器的音频界面）并真正播放；「在旁边听」在参考窗格打开；
 *   全程没有「Failed to get file info」或读文件错误
 * - 预先做好的场景视频：资料 → 视频 → 001-启程 → 带场景标记的「第一场 清晨的青石镇」，单击打开画布（成片 1280 × 720 且有音轨）：
 *   5 个镜头带 台词 / 音效 / 配乐 标记，首帧与成片缩略图、样片可见；镜头检查器有对白（说话人）与配音占位音、
 *   预演第一帧与预演视频；场景检查器显示配音语言与背景音乐。只打开不修改时不写回 分镜.json
 * - 英文作品 Starbound：「Chapter 1: The Harbor」「Act I」「Scene 1 — …」按英文结构规则显示为章 / 幕 / 场标题
 * - 人物详情：林舟的「声音」已经填好（性别 / 年龄 / 音色）
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  captureForReview,
  ensureSidebarOpen,
  openCharacterGrowth,
  setupAppSuite,
} from './support/suite';
import { SEL, openProjectDocs, selectWork, waitForEditorText } from './support/workbench';
import { FIXTURE_WORK } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-showcase-' } });

const SECTION_MATERIALS = `${SEL.workspaceTree} [aria-label="资料"]`;
const SCENE = '第一场 清晨的青石镇';
const SCENE_DIR = ['novels', '星河旅人', '资料', '视频', '001-启程', SCENE];
const AUDIO_GROUP = '.cm-content .cm-lp-audio [role="group"]';
const CANVAS = '[data-testid="scene-canvas"]';
const SHOT_NODES = `${CANVAS} [role="group"][aria-label^="镜头 "]`;

/** 读文件 / 探测文件出错的日志（媒体路径探测必须静默） */
function fileErrors(): string[] {
  return suite.app.logs
    .join('')
    .split('\n')
    .filter((line) =>
      /Failed to get file info|read-file-binary|Error occurred in handler/.test(line)
    );
}

async function expandMaterial(name: string, expectChild: string): Promise<void> {
  const { page } = suite;
  if (await page.exists({ text: expectChild, within: SECTION_MATERIALS, exact: true })) return;
  await page.click({ text: name, within: SECTION_MATERIALS, exact: true });
  await page.waitForTarget({ text: expectChild, within: SECTION_MATERIALS, exact: true });
}

describe('示例作品集展示', () => {
  it('声音示例.md：::audio 显示为音频播放条并能播放，「在旁边听」打开参考窗格', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    await openProjectDocs(page);
    await page.click({ text: '声音示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '这一篇只讲「声音」');
    // 第一屏里的配乐 / 环境音都渲染成音频界面（不是视频画面）
    await page.waitFor(
      (selector: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
          (group) => group.dataset.media === 'audio'
        ).length >= 3,
      { args: [AUDIO_GROUP], timeout: 15_000, message: '至少 3 个音频播放条' }
    );
    const first = await page.evaluate<{ label: string; loop: boolean; volume: number }>(
      (selector: string) => {
        const group = document.querySelector<HTMLElement>(selector);
        const media = group?.querySelector('video');
        return {
          label: group?.getAttribute('aria-label') ?? '',
          loop: media?.loop ?? false,
          volume: media?.volume ?? 0,
        };
      },
      AUDIO_GROUP
    );
    expect(first.label).toBe('音频 配乐 · 青石镇的清晨（可循环）');
    // 指令里的 loop / volume=0.7 作为初始值
    expect(first.loop).toBe(true);
    expect(first.volume).toBeCloseTo(0.7, 2);
    await page.waitFor(
      (selector: string) =>
        (document.querySelector<HTMLVideoElement>(`${selector} video`)?.readyState ?? 0) >= 1,
      { args: [AUDIO_GROUP], timeout: 15_000, message: '配乐读到元数据' }
    );
    // 播放：音频界面的控制条常显，点播放后时间前进
    await page.click(`${AUDIO_GROUP} button[aria-label="播放"]`);
    await page.waitFor(
      (selector: string) =>
        (document.querySelector<HTMLVideoElement>(`${selector} video`)?.currentTime ?? 0) > 0.3,
      { args: [AUDIO_GROUP], timeout: 15_000, message: '配乐开始播放（currentTime 前进）' }
    );
    const duration = await page.evaluate<number>(
      (selector: string) =>
        document.querySelector<HTMLVideoElement>(`${selector} video`)?.duration ?? 0,
      AUDIO_GROUP
    );
    expect(duration).toBeGreaterThan(8);
    await page.click(`${AUDIO_GROUP} button[aria-label="暂停"]`);
    await captureForReview(page, 'showcase-sound-doc');

    // 「在旁边听」：参考窗格里同样是音频界面
    await page.hover(AUDIO_GROUP);
    await page.click(`${AUDIO_GROUP} .cm-lp-media-beside`);
    // 参考窗格（编辑器之外）出现同名的音频播放器
    await page.waitFor(
      () =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[role="group"][data-media="audio"]')
        ).some(
          (group) =>
            !group.closest('.cm-content') &&
            group.getAttribute('aria-label') === '音频 配乐 · 青石镇的清晨（可循环）'
        ),
      { timeout: 15_000, message: '参考窗格显示音频播放器' }
    );
    expect(fileErrors()).toEqual([]);
  }, 90_000);

  it('预先做好的场景视频：从资料打开画布，镜头 / 声音 / 预演 / 成片 / 样片都在', async () => {
    const { page, fixture } = suite;
    const stateFile = fixture.resolve(...SCENE_DIR, '分镜.json');
    const before = await readFile(stateFile, 'utf-8');
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    await expandMaterial('视频', '001-启程');
    await expandMaterial('001-启程', SCENE);
    await page.waitForTarget(`${SECTION_MATERIALS} [data-scene-video="true"]`);
    await page.click({ text: SCENE, within: SECTION_MATERIALS, exact: true });
    await page.waitForTarget(CANVAS, 15_000);
    await page.waitFor((selector: string) => document.querySelectorAll(selector).length === 5, {
      args: [SHOT_NODES],
      timeout: 15_000,
      message: '画布上有 5 个镜头节点',
    });

    const badges = await page.evaluate<string[]>(
      (selector: string) =>
        Array.from(document.querySelectorAll(selector)).map(
          (node) => node.querySelector('[data-testid="shot-audio-badges"]')?.textContent ?? ''
        ),
      SHOT_NODES
    );
    expect(badges[0]).toContain('台词 1');
    expect(badges[0]).toContain('音效 1');
    expect(badges.every((text) => text.includes('配乐'))).toBe(true);
    expect(badges[3]).toContain('音效 1');

    // 镜头 1 / 2 有成片，镜头 3–5 显示首帧；最右边的样片能读到画面
    await page.waitFor(() => document.querySelectorAll('[data-testid="shot-video"]').length === 2, {
      timeout: 15_000,
      message: '镜头 1 / 2 显示成片缩略视频',
    });
    await page.waitFor(
      () =>
        ['镜头 3 首帧', '镜头 4 首帧', '镜头 5 首帧'].every((alt) => {
          const image = document.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
          return !!image && image.complete && image.naturalWidth > 0;
        }),
      { timeout: 15_000, message: '镜头 3–5 的首帧图已加载' }
    );
    await page.waitFor(
      () =>
        (document.querySelector<HTMLVideoElement>('[data-testid="scene-video-animatic"]')
          ?.readyState ?? 0) >= 1,
      { timeout: 15_000, message: '样片读到元数据' }
    );
    await captureForReview(page, 'showcase-scene-canvas');

    // 镜头 2：对白带说话人与配音占位音（可试听）
    await page.click(`${CANVAS} [role="group"][aria-label="镜头 2"] p`);
    await page.waitForTarget('[data-testid="shot-dialogue"]');
    expect(
      await page.evaluate<string[]>(() =>
        Array.from(
          document.querySelectorAll<HTMLTextAreaElement>('[data-testid="shot-dialogue"] textarea')
        ).map((item) => item.value)
      )
    ).toEqual(['舟哥！']);
    expect(
      await page.evaluate<string>(
        () =>
          document
            .querySelector('[data-testid="shot-dialogue"] [role="combobox"]')
            ?.textContent?.trim() ?? ''
      )
    ).toContain('小石头');
    await page.waitForTarget(
      '[data-testid="shot-dialogue"] [data-testid="dialogue-audio"]',
      15_000
    );
    await page.waitForTarget('[data-testid="shot-sfx"] [data-testid="sfx-cue"]');

    // 镜头 1：预演第一帧与预演视频
    await page.click(`${CANVAS} [role="group"][aria-label="镜头 1"] p`);
    await page.waitForTarget('[data-testid="keyframe-section"]');
    await page.waitForTarget('img[alt="镜头 1 预演第一帧"]', 15_000);
    await page.waitForTarget('[data-testid="previz-video-preview"]', 15_000);
    await captureForReview(page, 'showcase-shot-inspector');

    // 镜头 1 的成片：1280 × 720，带声音（播放一小段后播放器判定有音轨，不显示「无音轨」）
    const shotPlayer = '[role="group"][aria-label="视频 镜头1-v1.mp4"]';
    await page.waitFor(
      (selector: string) =>
        (document.querySelector<HTMLVideoElement>(`${selector} video`)?.readyState ?? 0) >= 1,
      { args: [shotPlayer], timeout: 15_000, message: '镜头 1 成片读到元数据' }
    );
    // 静音播放（不打扰测试机），Chromium 照样解码音轨
    await page.evaluate((selector: string) => {
      const video = document.querySelector<HTMLVideoElement>(`${selector} video`);
      if (!video) return;
      video.muted = true;
      void video.play();
    }, shotPlayer);
    await page.waitFor(
      (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.dataset.audio === 'present',
      { args: [shotPlayer], timeout: 15_000, message: '镜头 1 成片判定为有音轨' }
    );
    const shotMedia = await page.evaluate<{ width: number; audio: string; absent: boolean }>(
      (selector: string) => {
        const group = document.querySelector<HTMLElement>(selector);
        const video = group?.querySelector('video');
        video?.pause();
        return {
          width: video?.videoWidth ?? 0,
          audio: group?.dataset.audio ?? '',
          absent: !!group?.querySelector('[data-audio="absent"]'),
        };
      },
      shotPlayer
    );
    expect(shotMedia.width).toBeGreaterThanOrEqual(1280);
    expect(shotMedia.audio).not.toBe('absent');
    expect(shotMedia.absent).toBe(false);

    // 场景：配音语言普通话、背景音乐「青石镇的清晨」
    await page.click(`${CANVAS} [role="group"][aria-label="场景"] p`);
    await page.waitForTarget('[data-testid="scene-audio-section"]');
    expect(
      await page.evaluate<string>(
        () => document.querySelector('[data-testid="scene-audio-language"]')?.textContent ?? ''
      )
    ).toContain('普通话');
    await page.waitFor(
      () =>
        (document.querySelector('[data-testid="scene-audio-bgm-file"]')?.textContent ?? '') ===
        '青石镇的清晨.m4a',
      { timeout: 10_000, message: '场景检查器显示背景音乐文件' }
    );
    await captureForReview(page, 'showcase-scene-inspector');

    // 只是查看：分镜.json 没有被改写（章节路径仍是相对作品目录的示例写法）
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await readFile(stateFile, 'utf-8')).toBe(before);
    expect(fileErrors()).toEqual([]);
  }, 120_000);

  it('英文作品 Starbound：Chapter / Act / Scene 显示为章 / 幕 / 场标题', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, 'Starbound');
    await page.click({ text: '001-The Harbor', within: SEL.workspaceTree, exact: true });
    await waitForEditorText(page, 'The harbor of Port Lumen');
    // 光标移到正文中间，章标题行不在光标处
    await page.click({ text: 'Ives rolled up the chart', within: SEL.editor });
    const titles = await page.evaluate<Record<string, string[]>>(() => {
      const pick = (cls: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(`.cm-content .${cls}`)).map((line) =>
          line.innerText.trim()
        );
      return {
        chapter: pick('cm-lp-chapter-title'),
        act: pick('cm-lp-act-title'),
        scene: pick('cm-lp-scene-title'),
      };
    });
    expect(titles.chapter).toEqual(['Chapter 1: The Harbor']);
    expect(titles.act).toEqual(['Act I']);
    expect(titles.scene).toEqual(['Scene 1 — The Pier at Dusk', 'Scene 2 — The Bargain']);
    await captureForReview(page, 'showcase-english-work');
  });

  it('人物详情：林舟的声音（性别 / 年龄 / 音色）已经填好', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    // 与成长档案同一个入口打开林舟的人物详情，再切到「人物设计」
    // 前面的用例展开了很长的资料树：先把「角色」分区滚到可见处并等滚动停稳，避免点到错位的行
    await page.evaluate(() =>
      document
        .querySelector('[class*="workspaceTree"] section[aria-label="角色"]')
        ?.scrollIntoView({ block: 'start', behavior: 'instant' })
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await openCharacterGrowth(page, '林舟');
    // 第一次打开成长卡会弹出引导，跳过以免遮挡后续操作
    const tour = '[role="dialog"][aria-label^="引导"]';
    await page.waitForTarget(tour).catch(() => undefined);
    if (await page.exists(tour)) {
      await page.click({ text: '跳过', within: tour, exact: true });
      await page.waitForGone(tour);
    }
    const tabs = '[role="tablist"][aria-label="人物详情"]';
    await page.click({ text: '人物设计', within: tabs });
    await page.waitForTarget('[data-testid="character-voice"]');
    const voice = await page.evaluate<{ gender: string; age: string; timbre: string }>(() => {
      const form = document.querySelector('[data-testid="character-voice"]');
      const input = (label: string) =>
        (form?.querySelector(`input[aria-label="人物声音 ${label}"]`) as HTMLInputElement | null)
          ?.value ?? '';
      return {
        gender: form?.querySelector('[aria-label="人物声音 性别"]')?.textContent?.trim() ?? '',
        age: input('年龄'),
        timbre: input('音色'),
      };
    });
    expect(voice.gender).toContain('男声');
    expect(voice.age).toBe('少年');
    expect(voice.timbre).toBe('清亮、略带沙哑，说话短促');
    await captureForReview(page, 'showcase-character-voice');
  });
});
