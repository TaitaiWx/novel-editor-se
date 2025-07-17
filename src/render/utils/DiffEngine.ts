/**
 * 高性能文本差异比较引擎
 * 参考VSCode的diff算法实现，支持大文件处理
 */

export interface DiffOperation {
  type: 'add' | 'delete' | 'equal';
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface DiffResult {
  operations: DiffOperation[];
  addedLines: number;
  deletedLines: number;
  totalChanges: number;
}

export interface DiffOptions {
  chunkSize?: number; // 分块大小，默认10KB
  maxFileSize?: number; // 最大文件大小，超过此大小使用流式处理
  enableLineDiff?: boolean; // 是否启用行级diff
  enableWordDiff?: boolean; // 是否启用词级diff
  ignoreWhitespace?: boolean; // 是否忽略空白字符
  ignoreCase?: boolean; // 是否忽略大小写
}

/**
 * 高性能文本差异比较引擎
 */
export class DiffEngine {
  private options: Required<DiffOptions>;

  constructor(options: DiffOptions = {}) {
    this.options = {
      chunkSize: options.chunkSize || 10240, // 10KB
      maxFileSize: options.maxFileSize || 50 * 1024 * 1024, // 50MB
      enableLineDiff: options.enableLineDiff ?? true,
      enableWordDiff: options.enableWordDiff ?? false,
      ignoreWhitespace: options.ignoreWhitespace ?? false,
      ignoreCase: options.ignoreCase ?? false,
    };
  }

  /**
   * 计算两个文本的差异
   */
  diff(oldText: string, newText: string): DiffResult {
    // 预处理文本
    const processedOld = this.preprocessText(oldText);
    const processedNew = this.preprocessText(newText);

    // 根据文件大小选择算法
    if (oldText.length > this.options.maxFileSize || newText.length > this.options.maxFileSize) {
      return this.streamingDiff(processedOld, processedNew);
    } else if (oldText.length > this.options.chunkSize || newText.length > this.options.chunkSize) {
      return this.chunkedDiff(processedOld, processedNew);
    } else {
      return this.simpleDiff(processedOld, processedNew);
    }
  }

  /**
   * 预处理文本
   */
  private preprocessText(text: string): string {
    let processed = text;

    if (this.options.ignoreCase) {
      processed = processed.toLowerCase();
    }

    if (this.options.ignoreWhitespace) {
      processed = processed.replace(/\s+/g, ' ');
    }

    return processed;
  }

  /**
   * 简单diff算法（小文件）
   */
  private simpleDiff(oldText: string, newText: string): DiffResult {
    const operations: DiffOperation[] = [];
    let i = 0, j = 0;
    let addedLines = 0;
    let deletedLines = 0;

    while (i < oldText.length || j < newText.length) {
      // 寻找下一个相同字符的位置
      let matchLength = 0;
      while (i + matchLength < oldText.length && 
             j + matchLength < newText.length && 
             oldText[i + matchLength] === newText[j + matchLength]) {
        matchLength++;
      }
      
      if (matchLength > 0) {
        // 找到相同部分
        operations.push({
          type: 'equal',
          content: oldText.substring(i, i + matchLength),
          startIndex: i,
          endIndex: i + matchLength
        });
        i += matchLength;
        j += matchLength;
      } else {
        // 处理不同部分
        if (i < oldText.length && j < newText.length) {
          // 两边都有内容，优先删除
          operations.push({
            type: 'delete',
            content: oldText[i],
            startIndex: i,
            endIndex: i + 1
          });
          deletedLines++;
          i++;
        } else if (i < oldText.length) {
          // 只有旧文本有内容，删除
          operations.push({
            type: 'delete',
            content: oldText[i],
            startIndex: i,
            endIndex: i + 1
          });
          deletedLines++;
          i++;
        } else if (j < newText.length) {
          // 只有新文本有内容，添加
          operations.push({
            type: 'add',
            content: newText[j],
            startIndex: j,
            endIndex: j + 1
          });
          addedLines++;
          j++;
        }
      }
    }

    return {
      operations,
      addedLines,
      deletedLines,
      totalChanges: addedLines + deletedLines
    };
  }

  /**
   * 分块diff算法（中等文件）
   */
  private chunkedDiff(oldText: string, newText: string): DiffResult {
    const operations: DiffOperation[] = [];
    let addedLines = 0;
    let deletedLines = 0;

    // 计算需要处理的块数
    const oldChunks = Math.ceil(oldText.length / this.options.chunkSize);
    const newChunks = Math.ceil(newText.length / this.options.chunkSize);
    
    let oldPos = 0;
    let newPos = 0;
    
    for (let i = 0; i < Math.max(oldChunks, newChunks); i++) {
      const oldChunk = oldText.substring(oldPos, oldPos + this.options.chunkSize);
      const newChunk = newText.substring(newPos, newPos + this.options.chunkSize);
      
      if (oldChunk === newChunk) {
        // 块相同，添加equal操作
        operations.push({
          type: 'equal',
          content: oldChunk,
          startIndex: oldPos,
          endIndex: oldPos + oldChunk.length
        });
        oldPos += oldChunk.length;
        newPos += newChunk.length;
      } else {
        // 块不同，使用简单算法处理这个块
        const chunkResult = this.simpleDiff(oldChunk, newChunk);
        
        // 调整索引并合并操作
        for (const op of chunkResult.operations) {
          operations.push({
            ...op,
            startIndex: op.startIndex + oldPos,
            endIndex: op.endIndex + oldPos
          });
        }
        
        addedLines += chunkResult.addedLines;
        deletedLines += chunkResult.deletedLines;
        
        oldPos += oldChunk.length;
        newPos += newChunk.length;
      }
    }

    return {
      operations,
      addedLines,
      deletedLines,
      totalChanges: addedLines + deletedLines
    };
  }

  /**
   * 流式diff算法（大文件）
   */
  private streamingDiff(oldText: string, newText: string): DiffResult {
    const operations: DiffOperation[] = [];
    let addedLines = 0;
    let deletedLines = 0;

    // 使用滑动窗口算法
    const windowSize = this.options.chunkSize;
    const oldLength = oldText.length;
    const newLength = newText.length;

    let oldPos = 0;
    let newPos = 0;

    while (oldPos < oldLength || newPos < newLength) {
      // 计算当前窗口
      const oldWindow = oldText.substring(oldPos, Math.min(oldPos + windowSize, oldLength));
      const newWindow = newText.substring(newPos, Math.min(newPos + windowSize, newLength));

      // 在窗口内寻找最长公共子序列
      const lcs = this.findLongestCommonSubsequence(oldWindow, newWindow);
      
      if (lcs.length > 0) {
        // 找到公共部分
        const commonStart = lcs[0];
        const commonEnd = lcs[lcs.length - 1];
        
        // 添加删除操作（如果有）
        if (commonStart.oldIndex > 0) {
          const deletedContent = oldWindow.substring(0, commonStart.oldIndex);
          operations.push({
            type: 'delete',
            content: deletedContent,
            startIndex: oldPos,
            endIndex: oldPos + commonStart.oldIndex
          });
          deletedLines += this.countLines(deletedContent);
        }
        
        // 添加新增操作（如果有）
        if (commonStart.newIndex > 0) {
          const addedContent = newWindow.substring(0, commonStart.newIndex);
          operations.push({
            type: 'add',
            content: addedContent,
            startIndex: newPos,
            endIndex: newPos + commonStart.newIndex
          });
          addedLines += this.countLines(addedContent);
        }
        
        // 添加相等操作
        const commonContent = oldWindow.substring(commonStart.oldIndex, commonEnd.oldIndex + 1);
        operations.push({
          type: 'equal',
          content: commonContent,
          startIndex: oldPos + commonStart.oldIndex,
          endIndex: oldPos + commonEnd.oldIndex + 1
        });
        
        // 更新位置
        oldPos += commonEnd.oldIndex + 1;
        newPos += commonEnd.newIndex + 1;
      } else {
        // 没有找到公共部分，处理剩余内容
        if (oldPos < oldLength) {
          const deletedContent = oldText.substring(oldPos);
          operations.push({
            type: 'delete',
            content: deletedContent,
            startIndex: oldPos,
            endIndex: oldLength
          });
          deletedLines += this.countLines(deletedContent);
          oldPos = oldLength;
        }
        
        if (newPos < newLength) {
          const addedContent = newText.substring(newPos);
          operations.push({
            type: 'add',
            content: addedContent,
            startIndex: newPos,
            endIndex: newLength
          });
          addedLines += this.countLines(addedContent);
          newPos = newLength;
        }
      }
    }

    return {
      operations,
      addedLines,
      deletedLines,
      totalChanges: addedLines + deletedLines
    };
  }

  /**
   * 寻找最长公共子序列
   */
  private findLongestCommonSubsequence(str1: string, str2: string): Array<{oldIndex: number, newIndex: number}> {
    const len1 = str1.length;
    const len2 = str2.length;
    
    // 使用动态规划算法
    const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    
    // 填充DP表
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    // 回溯找到LCS
    const lcs: Array<{oldIndex: number, newIndex: number}> = [];
    let i = len1, j = len2;
    
    while (i > 0 && j > 0) {
      if (str1[i - 1] === str2[j - 1]) {
        lcs.unshift({ oldIndex: i - 1, newIndex: j - 1 });
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    
    return lcs;
  }

  /**
   * 计算文本中的行数
   */
  private countLines(text: string): number {
    return text.split('\n').length;
  }

  /**
   * 行级diff（将文本按行分割后比较）
   */
  lineDiff(oldText: string, newText: string): DiffResult {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    
    const operations: DiffOperation[] = [];
    let addedLines = 0;
    let deletedLines = 0;
    
    let i = 0, j = 0;
    
    while (i < oldLines.length || j < newLines.length) {
      // 寻找下一个相同的行
      let matchLength = 0;
      while (i + matchLength < oldLines.length && 
             j + matchLength < newLines.length && 
             oldLines[i + matchLength] === newLines[j + matchLength]) {
        matchLength++;
      }
      
      if (matchLength > 0) {
        // 找到相同的行
        const equalContent = oldLines.slice(i, i + matchLength).join('\n') + (i + matchLength < oldLines.length ? '\n' : '');
        operations.push({
          type: 'equal',
          content: equalContent,
          startIndex: i,
          endIndex: i + matchLength
        });
        i += matchLength;
        j += matchLength;
      } else {
        // 处理不同的行
        if (i < oldLines.length && j < newLines.length) {
          // 两边都有行，优先删除
          operations.push({
            type: 'delete',
            content: oldLines[i] + '\n',
            startIndex: i,
            endIndex: i + 1
          });
          deletedLines++;
          i++;
        } else if (i < oldLines.length) {
          // 只有旧文本有行，删除
          operations.push({
            type: 'delete',
            content: oldLines[i] + '\n',
            startIndex: i,
            endIndex: i + 1
          });
          deletedLines++;
          i++;
        } else if (j < newLines.length) {
          // 只有新文本有行，添加
          operations.push({
            type: 'add',
            content: newLines[j] + '\n',
            startIndex: j,
            endIndex: j + 1
          });
          addedLines++;
          j++;
        }
      }
    }
    
    return {
      operations,
      addedLines,
      deletedLines,
      totalChanges: addedLines + deletedLines
    };
  }

  /**
   * 词级diff（将文本按词分割后比较）
   */
  wordDiff(oldText: string, newText: string): DiffResult {
    // 简单的词分割（按空格和标点符号）
    const oldWords = oldText.split(/(\s+|[^\w\s])/);
    const newWords = newText.split(/(\s+|[^\w\s])/);
    
    const operations: DiffOperation[] = [];
    let addedLines = 0;
    let deletedLines = 0;
    
    let i = 0, j = 0;
    
    while (i < oldWords.length || j < newWords.length) {
      // 寻找下一个相同的词
      let matchLength = 0;
      while (i + matchLength < oldWords.length && 
             j + matchLength < newWords.length && 
             oldWords[i + matchLength] === newWords[j + matchLength]) {
        matchLength++;
      }
      
      if (matchLength > 0) {
        // 找到相同的词
        const equalContent = oldWords.slice(i, i + matchLength).join('');
        operations.push({
          type: 'equal',
          content: equalContent,
          startIndex: i,
          endIndex: i + matchLength
        });
        i += matchLength;
        j += matchLength;
      } else {
        // 处理不同的词
        if (i < oldWords.length && j < newWords.length) {
          // 两边都有词，优先删除
          operations.push({
            type: 'delete',
            content: oldWords[i],
            startIndex: i,
            endIndex: i + 1
          });
          deletedLines++;
          i++;
        } else if (i < oldWords.length) {
          // 只有旧文本有词，删除
          operations.push({
            type: 'delete',
            content: oldWords[i],
            startIndex: i,
            endIndex: i + 1
          });
          deletedLines++;
          i++;
        } else if (j < newWords.length) {
          // 只有新文本有词，添加
          operations.push({
            type: 'add',
            content: newWords[j],
            startIndex: j,
            endIndex: j + 1
          });
          addedLines++;
          j++;
        }
      }
    }
    
    return {
      operations,
      addedLines,
      deletedLines,
      totalChanges: addedLines + deletedLines
    };
  }
}

/**
 * 创建默认的diff引擎实例
 */
export const createDiffEngine = (options?: DiffOptions): DiffEngine => {
  return new DiffEngine(options);
};

/**
 * 便捷的diff函数
 */
export const diff = (oldText: string, newText: string, options?: DiffOptions): DiffResult => {
  const engine = createDiffEngine(options);
  return engine.diff(oldText, newText);
};

/**
 * 便捷的行级diff函数
 */
export const lineDiff = (oldText: string, newText: string, options?: DiffOptions): DiffResult => {
  const engine = createDiffEngine(options);
  return engine.lineDiff(oldText, newText);
};

/**
 * 便捷的词级diff函数
 */
export const wordDiff = (oldText: string, newText: string, options?: DiffOptions): DiffResult => {
  const engine = createDiffEngine(options);
  return engine.wordDiff(oldText, newText);
}; 