import { describe, expect, it } from 'vitest';
import { analyzeContentStats, buildThousandCharMarkers } from '../../src/render/utils/contentStats';

describe('content stats helpers', () => {
  it('会按状态栏口径统计行数与字数', () => {
    expect(analyzeContentStats('甲乙 丙\n丁\t戊\r\n')).toEqual({
      lineCount: 3,
      charCount: 5,
    });
  });

  it('会在跨过每千字阈值的行生成累计字数标记', () => {
    const content = `${'甲'.repeat(950)}\n${'乙'.repeat(120)}\n${'丙'.repeat(980)}\n${'丁'.repeat(35)}`;

    expect(buildThousandCharMarkers(content)).toEqual([
      { lineNumber: 2, charCount: 1070 },
      { lineNumber: 3, charCount: 2050 },
    ]);
  });

  it('空内容或非法步长不会生成千字标记', () => {
    expect(buildThousandCharMarkers('')).toEqual([]);
    expect(buildThousandCharMarkers('正文', 0)).toEqual([]);
  });
});
