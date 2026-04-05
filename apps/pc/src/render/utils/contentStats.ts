export interface ContentStats {
  lineCount: number;
  charCount: number;
}

export interface ThousandCharMarker {
  lineNumber: number;
  charCount: number;
}

function isCountableCharCode(code: number): boolean {
  return code !== 10 && code !== 13 && code !== 9 && code !== 32;
}

export function analyzeContentStats(content: string): ContentStats {
  if (!content) {
    return { lineCount: 0, charCount: 0 };
  }

  let lineCount = 1;
  let charCount = 0;

  // 中文说明：这里与状态栏字数口径保持一致，只跳过换行、Tab 和半角空格。
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 10) {
      lineCount += 1;
      continue;
    }
    if (isCountableCharCode(code)) {
      charCount += 1;
    }
  }

  return { lineCount, charCount };
}

export function buildThousandCharMarkers(
  content: string,
  milestoneStep = 1000
): ThousandCharMarker[] {
  if (!content || !Number.isFinite(milestoneStep) || milestoneStep <= 0) {
    return [];
  }

  const markers: ThousandCharMarker[] = [];
  let currentLine = 1;
  let charCount = 0;
  let nextMilestone = milestoneStep;
  let pendingMarkerCount: number | null = null;

  // 中文说明：逐字符单次扫描全文，在跨过每个千字阈值时，
  // 把该行的累计字数挂到 gutter，避免 split/replace 带来的额外内存分配。
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);

    if (code === 10) {
      if (pendingMarkerCount !== null) {
        markers.push({ lineNumber: currentLine, charCount: pendingMarkerCount });
        pendingMarkerCount = null;
      }
      currentLine += 1;
      continue;
    }

    if (!isCountableCharCode(code)) {
      continue;
    }

    charCount += 1;
    if (charCount >= nextMilestone) {
      pendingMarkerCount = charCount;
      while (charCount >= nextMilestone) {
        nextMilestone += milestoneStep;
      }
    } else if (pendingMarkerCount !== null) {
      pendingMarkerCount = charCount;
    }
  }

  if (pendingMarkerCount !== null) {
    markers.push({ lineNumber: currentLine, charCount: pendingMarkerCount });
  }

  return markers;
}
