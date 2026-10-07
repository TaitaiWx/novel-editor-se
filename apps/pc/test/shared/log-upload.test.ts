import { describe, expect, it } from 'vitest';
import {
  buildLogBundleFileName,
  describeLogUploadResult,
  shouldUploadCrashReport,
} from '../../src/shared/log-upload';

describe('shared/log-upload', () => {
  it('buildLogBundleFileName 使用本地时间与设备 ID 前 8 位', () => {
    const date = new Date(2026, 9, 6, 9, 5, 7);
    expect(buildLogBundleFileName(date, '0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(
      'novel-editor-logs-20261006-090507-0f8fad5b.zip'
    );
    expect(buildLogBundleFileName(date, '../')).toBe(
      'novel-editor-logs-20261006-090507-unknown.zip'
    );
  });

  it('describeLogUploadResult 区分已上传 / 已保存 / 失败', () => {
    expect(describeLogUploadResult({ status: 'uploaded', ticketId: 'T-42', bytes: 1 })).toBe(
      '日志已上传（编号 T-42）'
    );
    expect(describeLogUploadResult({ status: 'uploaded', ticketId: null, bytes: 1 })).toBe(
      '日志已上传'
    );
    expect(
      describeLogUploadResult({
        status: 'saved',
        fileName: 'a.zip',
        filePath: '/x/a.zip',
        uploadError: null,
        bytes: 1,
      })
    ).toBe('日志已打包到 下载/a.zip，可发送给我们');
    expect(describeLogUploadResult({ status: 'failed', error: '磁盘已满' })).toBe(
      '日志打包失败：磁盘已满'
    );
  });

  it('shouldUploadCrashReport 始终开启：只看是否配置了上传地址', () => {
    expect(shouldUploadCrashReport('https://logs.example.com/up')).toBe(true);
    expect(shouldUploadCrashReport(null)).toBe(false);
    expect(shouldUploadCrashReport(undefined)).toBe(false);
    expect(shouldUploadCrashReport('')).toBe(false);
  });
});
