/**
 * DiffEngine 测试文件
 * 用于验证diff算法的性能和正确性
 */

import { diff, lineDiff, wordDiff, createDiffEngine, DiffEngine } from './DiffEngine';

// 测试数据生成函数
function generateTestData(size: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n\t ';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateLargeText(size: number): string {
  const lines = [];
  const words = ['hello', 'world', 'test', 'diff', 'algorithm', 'performance', 'large', 'file', 'text', 'content'];
  
  for (let i = 0; i < size; i++) {
    const lineLength = Math.floor(Math.random() * 50) + 10;
    const line = [];
    for (let j = 0; j < lineLength; j++) {
      line.push(words[Math.floor(Math.random() * words.length)]);
    }
    lines.push(line.join(' '));
  }
  
  return lines.join('\n');
}

// 性能测试
export function runPerformanceTests() {
  console.log('=== DiffEngine 性能测试 ===');
  
  // 小文件测试 (1KB)
  const smallOld = generateTestData(1024);
  const smallNew = smallOld + 'new content';
  
  console.time('小文件 diff (1KB)');
  const smallResult = diff(smallOld, smallNew);
  console.timeEnd('小文件 diff (1KB)');
  console.log(`小文件结果: ${smallResult.operations.length} 个操作, ${smallResult.totalChanges} 个变化`);
  
  // 中等文件测试 (100KB)
  const mediumOld = generateTestData(100 * 1024);
  const mediumNew = mediumOld + 'new content at the end';
  
  console.time('中等文件 diff (100KB)');
  const mediumResult = diff(mediumOld, mediumNew);
  console.timeEnd('中等文件 diff (100KB)');
  console.log(`中等文件结果: ${mediumResult.operations.length} 个操作, ${mediumResult.totalChanges} 个变化`);
  
  // 大文件测试 (1MB)
  const largeOld = generateTestData(1024 * 1024);
  const largeNew = largeOld + 'new content at the end';
  
  console.time('大文件 diff (1MB)');
  const largeResult = diff(largeOld, largeNew);
  console.timeEnd('大文件 diff (1MB)');
  console.log(`大文件结果: ${largeResult.operations.length} 个操作, ${largeResult.totalChanges} 个变化`);
  
  // 超大文件测试 (10MB)
  const hugeOld = generateTestData(10 * 1024 * 1024);
  const hugeNew = hugeOld + 'new content at the end';
  
  console.time('超大文件 diff (10MB)');
  const hugeResult = diff(hugeOld, hugeNew);
  console.timeEnd('超大文件 diff (10MB)');
  console.log(`超大文件结果: ${hugeResult.operations.length} 个操作, ${hugeResult.totalChanges} 个变化`);
  
  // 行级diff测试
  const lineOld = generateLargeText(1000);
  const lineNew = lineOld + '\nnew line at the end';
  
  console.time('行级 diff (1000行)');
  const lineResult = lineDiff(lineOld, lineNew);
  console.timeEnd('行级 diff (1000行)');
  console.log(`行级diff结果: ${lineResult.operations.length} 个操作, ${lineResult.totalChanges} 个变化`);
}

// 正确性测试
export function runCorrectnessTests() {
  console.log('\n=== DiffEngine 正确性测试 ===');
  
  // 测试1: 相同文本
  const sameText = 'Hello World';
  const sameResult = diff(sameText, sameText);
  console.log('相同文本测试:', sameResult.operations.length === 1 && sameResult.operations[0].type === 'equal' ? '通过' : '失败');
  
  // 测试2: 添加内容
  const addOld = 'Hello';
  const addNew = 'Hello World';
  const addResult = diff(addOld, addNew);
  console.log('添加内容测试:', addResult.operations.length === 2 && addResult.operations[1].type === 'add' ? '通过' : '失败');
  
  // 测试3: 删除内容
  const deleteOld = 'Hello World';
  const deleteNew = 'Hello';
  const deleteResult = diff(deleteOld, deleteNew);
  console.log('删除内容测试:', deleteResult.operations.length === 2 && deleteResult.operations[1].type === 'delete' ? '通过' : '失败');
  
  // 测试4: 修改内容
  const modifyOld = 'Hello World';
  const modifyNew = 'Hello Universe';
  const modifyResult = diff(modifyOld, modifyNew);
  console.log('修改内容测试:', modifyResult.operations.length >= 3 ? '通过' : '失败');
  
  // 测试5: 空文本
  const emptyResult = diff('', '');
  console.log('空文本测试:', emptyResult.operations.length === 0 ? '通过' : '失败');
  
  // 测试6: 大文件正确性
  const largeOld = generateTestData(10000);
  const largeNew = largeOld + 'new content';
  const largeResult = diff(largeOld, largeNew);
  console.log('大文件正确性测试:', largeResult.operations.length > 0 ? '通过' : '失败');
}

// 内存使用测试
export function runMemoryTests() {
  console.log('\n=== DiffEngine 内存使用测试 ===');
  
  // 创建多个大文件进行diff
  for (let i = 0; i < 5; i++) {
    const oldText = generateTestData(1024 * 1024); // 1MB
    const newText = oldText + 'new content';
    
    console.time(`内存测试 ${i + 1}`);
    const result = diff(oldText, newText);
    console.timeEnd(`内存测试 ${i + 1}`);
    
    // 模拟垃圾回收，通过释放大对象的引用
    result.operations = [];
    result = null;
    oldText = null;
    newText = null;
  }
  
  console.log('内存测试完成');
}

// 运行所有测试
export function runAllTests() {
  try {
    runCorrectnessTests();
    runPerformanceTests();
    runMemoryTests();
    console.log('\n=== 所有测试完成 ===');
  } catch (error) {
    console.error('测试过程中发生错误:', error);
  }
}

// 在开发模式下自动运行测试
if (process.env.NODE_ENV === 'development') {
  // 延迟运行，确保页面完全加载
  setTimeout(() => {
    console.log('开始运行 DiffEngine 测试...');
    runAllTests();
  }, 2000);
}

// 导出测试函数供手动调用
export { runAllTests as testDiffEngine }; 