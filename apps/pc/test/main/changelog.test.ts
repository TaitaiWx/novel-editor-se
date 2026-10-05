import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { getReleaseNotesCandidates, isJustUpdated } from '../../src/main/changelog';

describe('changelog', () => {
  describe('getReleaseNotesCandidates', () => {
    it('打包版只读取 resourcesPath', () => {
      expect(
        getReleaseNotesCandidates({
          isPackaged: true,
          resourcesPath: '/app/resources',
          appPath: '/app/resources/app.asar',
        })
      ).toEqual([path.join('/app/resources', 'release-notes.json')]);
    });

    it('未打包时优先读取 appPath（apps/pc）根目录，再回退上一级', () => {
      expect(
        getReleaseNotesCandidates({
          isPackaged: false,
          resourcesPath: '/electron/resources',
          appPath: '/repo/apps/pc',
        })
      ).toEqual([
        path.join('/repo/apps/pc', 'release-notes.json'),
        path.join('/repo/apps', 'release-notes.json'),
      ]);
    });
  });

  describe('isJustUpdated', () => {
    it('全新安装不算更新', () => {
      expect(isJustUpdated(null, '1.0.0')).toBe(false);
      expect(isJustUpdated('', '1.0.0')).toBe(false);
    });

    it('版本相同不算更新', () => {
      expect(isJustUpdated('1.0.0', '1.0.0')).toBe(false);
    });

    it('版本变化才算更新', () => {
      expect(isJustUpdated('1.0.0', '1.1.0')).toBe(true);
    });
  });
});
