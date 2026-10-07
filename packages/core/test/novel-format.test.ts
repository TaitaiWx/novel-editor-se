import { describe, expect, it } from 'vitest';
import {
  audioDirectiveSource,
  classifyStructureLine,
  extractNovelScenes,
  imageDirectiveSource,
  hasNovelMarkup,
  lintNovelMarkup,
  parseDirectiveAttributes,
  parseDirectiveLine,
  parseFrontMatter,
  stripNovelMarkup,
  videoDirectiveSource,
} from '../src/novel-format';

describe('parseFrontMatter', () => {
  it('解析字符串、数字、布尔、数组与行尾注释', () => {
    const text = [
      '---',
      'title: 港口夜雨',
      'chapter: 3',
      'ratio: -1.5',
      'draft: true',
      'done: false',
      'pov: "林舟"',
      'tags: [悬疑, \'雨夜\', "港口"]',
      'status: 初稿 # 待修改',
      '这一行不是键值',
      '---',
      '正文第一行',
    ].join('\n');
    const result = parseFrontMatter(text);
    expect(result.data).toEqual({
      title: '港口夜雨',
      chapter: 3,
      ratio: -1.5,
      draft: true,
      done: false,
      pov: '林舟',
      tags: ['悬疑', '雨夜', '港口'],
      status: '初稿',
    });
    expect(result.lineCount).toBe(11);
    expect(result.body).toBe('正文第一行');
  });

  it('没有闭合的 --- 时视为没有 front-matter', () => {
    const text = '---\ntitle: 未闭合\n正文';
    expect(parseFrontMatter(text)).toEqual({ data: {}, lineCount: 0, body: text });
  });

  it('不以 --- 开头时视为没有 front-matter', () => {
    const text = '正文\n---\ntitle: x\n---';
    expect(parseFrontMatter(text)).toEqual({ data: {}, lineCount: 0, body: text });
  });

  it('容忍文件开头的 BOM 与 CRLF', () => {
    const result = parseFrontMatter('﻿---\r\ntitle: 港口\r\n---\r\n正文');
    expect(result.data).toEqual({ title: '港口' });
    expect(result.lineCount).toBe(3);
    expect(result.body).toBe('正文');
  });
});

describe('parseDirectiveAttributes', () => {
  it('解析 #id、.class 与各种引号的值', () => {
    expect(
      parseDirectiveAttributes('{#s-1 .night .rain title="港口 夜" pov=\'林舟\' mood=紧张}')
    ).toEqual({
      id: 's-1',
      classes: ['night', 'rain'],
      values: { title: '港口 夜', pov: '林舟', mood: '紧张' },
    });
  });

  it('空属性返回空结构', () => {
    expect(parseDirectiveAttributes('')).toEqual({ classes: [], values: {} });
    expect(parseDirectiveAttributes('{}')).toEqual({ classes: [], values: {} });
  });
});

describe('parseDirectiveLine', () => {
  it('识别叶子指令', () => {
    expect(parseDirectiveLine('::video[开场镜头]{src="资料/视频/a.mp4"}')).toEqual({
      kind: 'leaf',
      name: 'video',
      label: '开场镜头',
      attributes: { classes: [], values: { src: '资料/视频/a.mp4' } },
    });
  });

  it('识别容器开始与闭合（允许前后空白）', () => {
    expect(parseDirectiveLine('  :::scene[港口]{#s-1 title=码头}  ')).toEqual({
      kind: 'container-open',
      name: 'scene',
      label: '港口',
      attributes: { id: 's-1', classes: [], values: { title: '码头' } },
    });
    expect(parseDirectiveLine(':::')?.kind).toBe('container-close');
    expect(parseDirectiveLine('  :::  ')?.kind).toBe('container-close');
  });

  it('普通正文与中文指令名都不是指令', () => {
    expect(parseDirectiveLine('12:30 他到了港口')).toBeNull();
    expect(parseDirectiveLine('比例 3:2')).toBeNull();
    expect(parseDirectiveLine('::中文')).toBeNull();
    expect(parseDirectiveLine(':::场景')).toBeNull();
    expect(parseDirectiveLine('::video 后面还有正文')).toBeNull();
    expect(parseDirectiveLine('')).toBeNull();
  });
});

describe('hasNovelMarkup', () => {
  it('front-matter、指令行、行内指令都算', () => {
    expect(hasNovelMarkup('---\ntitle: x\n---')).toBe(true);
    expect(hasNovelMarkup('﻿---\ntitle: x\n---')).toBe(true);
    expect(hasNovelMarkup('正文\n:::scene\n:::')).toBe(true);
    expect(hasNovelMarkup('他看见了:char[阿舟]{id=x}')).toBe(true);
  });

  it('普通正文不算', () => {
    expect(hasNovelMarkup('第一章\n12:30 他到了港口，比例 3:2。')).toBe(false);
  });
});

describe('stripNovelMarkup', () => {
  it('没有标记时原样返回', () => {
    const text = '第一章\n12:30 港口';
    expect(stripNovelMarkup(text)).toBe(text);
  });

  it('去掉 front-matter 与指令行、保留行内指令文字，且行数不变', () => {
    const text = [
      '---',
      'title: 港口',
      '---',
      ':::scene{#s-1 title=港口}',
      '他喊了一声:char[阿舟]{id=linzhou}，没人回答。',
      '::video[镜头]{src=a.mp4}',
      ':::',
      '12:30 雨停了。',
    ].join('\n');
    const stripped = stripNovelMarkup(text);
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length);
    expect(stripped.split('\n')).toEqual([
      '',
      '',
      '',
      '',
      '他喊了一声阿舟，没人回答。',
      '',
      '',
      '12:30 雨停了。',
    ]);
  });

  it('行内指令在行首或没有属性时同样保留文字', () => {
    expect(stripNovelMarkup(':char[阿舟]说：走。')).toBe('阿舟说：走。');
  });
});

describe('extractNovelScenes', () => {
  it('闭合的场景：标题优先取 title 属性，其次方括号标签', () => {
    const text = [
      ':::scene{#s-1 title=港口 pov=林舟}',
      '雨夜。',
      ':::',
      ':::scene[灯塔]',
      '风大。',
      ':::',
    ].join('\n');
    const scenes = extractNovelScenes(text);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({
      id: 's-1',
      title: '港口',
      startLine: 1,
      endLine: 3,
      unclosed: false,
    });
    expect(scenes[0].attributes.values.pov).toBe('林舟');
    expect(scenes[1]).toMatchObject({ title: '灯塔', startLine: 4, endLine: 6, unclosed: false });
    expect(scenes[1].id).toBeUndefined();
  });

  it('未闭合的场景在下一个场景开始处结束', () => {
    const text = [':::scene{title=甲}', '正文', ':::scene{title=乙}', '正文', ':::'].join('\n');
    const scenes = extractNovelScenes(text);
    expect(scenes.map((s) => [s.title, s.startLine, s.endLine, s.unclosed])).toEqual([
      ['甲', 1, 2, true],
      ['乙', 3, 5, false],
    ]);
  });

  it('未闭合的场景在 ≤2 级标题前结束，三级标题不打断', () => {
    const text = [':::scene{title=甲}', '### 小节', '正文', '## 第二章', '后文'].join('\n');
    const scenes = extractNovelScenes(text);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ startLine: 1, endLine: 3, unclosed: true });
  });

  it('未闭合到文末时结束在最后一行；非 scene 容器不算场景', () => {
    const text = [':::note{title=备注}', ':::', ':::scene', '正文'].join('\n');
    const scenes = extractNovelScenes(text);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ title: '', startLine: 3, endLine: 4, unclosed: true });
  });
});

describe('lintNovelMarkup', () => {
  it('结构正确时没有问题', () => {
    expect(lintNovelMarkup(':::scene{#a title=甲}\n正文\n:::\n')).toEqual([]);
    expect(lintNovelMarkup('普通正文 12:30')).toEqual([]);
  });

  it('报告未闭合、重复 id 与多余的 :::，并按行号排序', () => {
    const text = [
      ':::', // 1 多余
      ':::scene{#a title=甲}', // 2
      '正文',
      ':::', // 4
      ':::scene{#a title=乙}', // 5 重复 id + 未闭合
      '正文',
      '## 下一节', // 7
      ':::', // 8 多余
    ].join('\n');
    const issues = lintNovelMarkup(text);
    expect(issues.map((issue) => issue.line)).toEqual([1, 5, 5, 8]);
    expect(issues[0].message).toContain('多余的 :::');
    expect(issues.some((i) => i.line === 5 && i.message.includes('乙'))).toBe(true);
    expect(issues.some((i) => i.line === 5 && i.message.includes('与第 2 行重复'))).toBe(true);
    expect(issues[3].message).toContain('多余的 :::');
  });

  it('未命名场景的提示里用「未命名」或 id', () => {
    expect(lintNovelMarkup(':::scene\n正文')[0].message).toContain('未命名');
    expect(lintNovelMarkup(':::scene{#s-9}\n正文')[0].message).toContain('s-9');
  });
});

describe('videoDirectiveSource', () => {
  it('返回视频地址与说明', () => {
    expect(videoDirectiveSource('::video[开场]{src="资料/视频/一.mp4" poster=a.png}')).toEqual({
      src: '资料/视频/一.mp4',
      caption: '开场',
    });
  });

  it('不是视频指令、没有 src 或是容器时返回 null', () => {
    expect(videoDirectiveSource('::image{src=a.png}')).toBeNull();
    expect(videoDirectiveSource('::video[无地址]')).toBeNull();
    expect(videoDirectiveSource('::video{src="  "}')).toBeNull();
    expect(videoDirectiveSource(':::video{src=a.mp4}')).toBeNull();
    expect(videoDirectiveSource('普通正文')).toBeNull();
  });
});

describe('classifyStructureLine（不用 Markdown 语法的章 / 幕 / 场标题）', () => {
  it('识别章 / 幕 / 场与特殊章节名', () => {
    expect(classifyStructureLine('第一章 离港')).toBe('chapter');
    expect(classifyStructureLine('第一章离港')).toBe('chapter');
    expect(classifyStructureLine('  第12章：风暴  ')).toBe('chapter');
    expect(classifyStructureLine('第十回 风起')).toBe('chapter');
    expect(classifyStructureLine('楔子')).toBe('chapter');
    expect(classifyStructureLine('番外：雪夜')).toBe('chapter');
    expect(classifyStructureLine('第一幕 离乡')).toBe('act');
    expect(classifyStructureLine('第二场 铁匠铺的夜')).toBe('scene');
  });

  it('正文句子、过长的行、幕 / 场后紧跟正文都不算', () => {
    expect(classifyStructureLine('他说第三章说过的话。')).toBeNull();
    expect(classifyStructureLine('第三章说过的话。')).toBeNull();
    expect(classifyStructureLine('第一场雨下了很久')).toBeNull();
    expect(classifyStructureLine(`第一章 ${'很'.repeat(40)}`)).toBeNull();
    expect(classifyStructureLine('')).toBeNull();
    expect(classifyStructureLine('序言写在后面')).toBeNull();
  });

  it('未闭合的场景在章 / 幕标题行前结束，场标题不打断', () => {
    const scenes = extractNovelScenes(
      [':::scene{title=港口}', '第一场 码头', '正文', '第二章 夜航', '下一章'].join('\n')
    );
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ startLine: 1, endLine: 3, unclosed: true });
  });
});

describe('imageDirectiveSource', () => {
  it('::image 的地址与说明；不是图片指令或没有 src 时为 null', () => {
    expect(imageDirectiveSource('::image[码头]{src="资料/图集/a.webp"}')).toEqual({
      src: '资料/图集/a.webp',
      caption: '码头',
    });
    expect(imageDirectiveSource('::video[x]{src=a.mp4}')).toBeNull();
    expect(imageDirectiveSource('::image[x]')).toBeNull();
  });
});

describe('audioDirectiveSource', () => {
  it('::audio 的地址、说明、循环与音量', () => {
    expect(
      audioDirectiveSource('::audio[海港配乐]{src="资料/音乐/海港.m4a" loop volume=0.6}')
    ).toEqual({ src: '资料/音乐/海港.m4a', caption: '海港配乐', loop: true, volume: 0.6 });
    expect(audioDirectiveSource('::audio{src=a.m4a}')).toEqual({
      src: 'a.m4a',
      caption: '',
      loop: false,
    });
    expect(audioDirectiveSource('::audio[x]{src=a.m4a .loop volume=40}')).toMatchObject({
      loop: true,
      volume: 0.4,
    });
    expect(audioDirectiveSource('::audio[x]{src=a.m4a loop=false volume=abc}')).toEqual({
      src: 'a.m4a',
      caption: 'x',
      loop: false,
    });
    // 引号里的 loop 字样不算循环标记
    expect(audioDirectiveSource('::audio[x]{src="loop.m4a"}')?.loop).toBe(false);
  });

  it('不是音频指令或没有 src 时为 null', () => {
    expect(audioDirectiveSource('::video[x]{src=a.mp4}')).toBeNull();
    expect(audioDirectiveSource('::audio[x]')).toBeNull();
    expect(audioDirectiveSource(':::audio{src=a.m4a}')).toBeNull();
    expect(audioDirectiveSource('普通正文 12:30')).toBeNull();
  });

  it('字数统计去掉 ::audio 行；ne lint 提示缺少 src 的媒体指令', () => {
    expect(stripNovelMarkup('正文\n::audio[配乐]{src=a.m4a}\n后文')).toBe('正文\n\n后文');
    expect(lintNovelMarkup('::audio[配乐]{src=a.m4a}')).toEqual([]);
    const issues = lintNovelMarkup('::audio[配乐]\n::image{alt=x}\n::note[备注]');
    expect(issues.map((issue) => [issue.line, issue.message.slice(0, 8)])).toEqual([
      [1, '::audio '],
      [2, '::image '],
    ]);
  });
});
