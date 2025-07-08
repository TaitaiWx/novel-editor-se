# 自动保存功能优化说明

## 修复的问题

### 原始问题

在之前的实现中，文件切换时的自动保存逻辑存在严重 bug：

- 当用户从文件A切换到文件B时，会把文件A的内容错误地保存到文件B
- 这是因为 `useEffect` 清理函数执行时，`filePath` 已经变成了新文件路径
- 导致内容覆盖和文件错乱

### 解决方案

#### 1. 使用 ref 追踪当前文件状态

```typescript
const currentFilePathRef = useRef<string | null>(null);
const currentContentRef = useRef<string>('');
const currentOriginalContentRef = useRef<string>('');
```

#### 2. 修复自动保存逻辑

- 自动保存现在使用 ref 中的路径和内容，而不是 state
- 确保保存到正确的文件路径

#### 3. 文件切换时的保存处理

- 在 `useEffect` 中检测文件路径变化
- 在加载新文件之前，先保存前一个文件的更改
- 避免异步竞态条件

#### 4. 组件卸载时的保存

- 在组件卸载时检查是否有未保存的更改
- 安全地保存当前文件内容

## 核心改进

### 文件切换保存逻辑

```typescript
useEffect(() => {
  // 保存前一个文件的内容（如果有变化）
  const savePreviousFile = async () => {
    if (
      currentFilePathRef.current &&
      currentContentRef.current !== currentOriginalContentRef.current &&
      !readOnly
    ) {
      try {
        await window.electron.ipcRenderer.invoke(
          'write-file',
          currentFilePathRef.current,
          currentContentRef.current
        );
      } catch (error) {
        console.error('Failed to save previous file:', error);
      }
    }
  };

  // 如果文件路径变化，先保存前一个文件
  if (filePath !== currentFilePathRef.current) {
    savePreviousFile();
  }

  // 更新当前文件信息
  currentFilePathRef.current = filePath;
  currentContentRef.current = content;
  currentOriginalContentRef.current = originalContent;
}, [filePath, content, originalContent, readOnly]);
```

### 自动保存逻辑

```typescript
const autoSaveFile = useCallback(async () => {
  const targetPath = currentFilePathRef.current;
  const targetContent = currentContentRef.current;

  if (!targetPath || readOnly || targetContent === currentOriginalContentRef.current) return;

  setAutoSaving(true);
  try {
    await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
    // 只有在保存的是当前文件时才更新状态
    if (targetPath === filePath) {
      setOriginalContent(targetContent);
      setLastSaved(new Date());
    }
  } catch (error) {
    console.error('Auto-save failed:', error);
  } finally {
    setAutoSaving(false);
  }
}, [filePath, readOnly]);
```

## 功能特性

✅ **自动保存**：内容变更后2秒自动保存
✅ **手动保存**：Ctrl/Cmd+S 强制保存
✅ **文件切换安全**：切换文件时正确保存到原文件
✅ **状态指示**：实时显示保存状态和最后保存时间
✅ **错误处理**：所有保存操作都有错误处理
✅ **组件卸载保存**：组件卸载时自动保存未保存的更改

## 测试建议

1. **基础功能测试**

   - 打开文件，编辑内容，观察2秒后自动保存
   - 使用 Ctrl/Cmd+S 手动保存
   - 观察状态栏的保存指示

2. **文件切换测试**

   - 在文件A中编辑内容
   - 切换到文件B
   - 再切换回文件A，验证内容正确保存
   - 检查文件B没有被错误覆盖

3. **快速操作测试**

   - 快速编辑多个文件
   - 快速切换文件
   - 验证每个文件的内容都正确保存

4. **边界情况测试**
   - 在自动保存期间切换文件
   - 在未保存状态下关闭应用
   - 网络/磁盘错误时的处理

## 技术亮点

- **无竞态条件**：使用 ref 避免异步状态问题
- **安全的文件操作**：所有保存操作都有完整的错误处理
- **用户体验优化**：静默自动保存，不干扰用户工作流
- **状态同步**：UI状态与文件状态完全同步
- **内存安全**：正确清理定时器和事件监听器
