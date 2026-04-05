import { describe, expect, it } from 'vitest';
import { mergeSettingsDraft } from '../../src/render/utils/appSettings';

describe('app settings AI migration', () => {
  it('旧版 AI 配置缺少 enabled 时会按已配置连接参数迁移为启用', () => {
    const settings = mergeSettingsDraft(
      JSON.stringify({
        ai: {
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-5.4-mini',
        },
      })
    );

    expect(settings.ai.enabled).toBe(true);
    expect(settings.ai.apiKey).toBe('sk-test');
  });

  it('旧版平铺 AI 配置也会迁移到 ai 节点', () => {
    const settings = mergeSettingsDraft(
      JSON.stringify({
        apiKey: 'sk-legacy',
        baseUrl: 'https://api.example.com/v1',
        model: 'deepseek-chat',
      })
    );

    expect(settings.ai.enabled).toBe(true);
    expect(settings.ai.apiKey).toBe('sk-legacy');
    expect(settings.ai.baseUrl).toBe('https://api.example.com/v1');
    expect(settings.ai.model).toBe('deepseek-chat');
  });

  it('显式关闭 AI 时保留关闭状态，不会被自动迁移覆盖', () => {
    const settings = mergeSettingsDraft(
      JSON.stringify({
        ai: {
          enabled: false,
          enabledExplicitlySet: true,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-5.4-mini',
        },
      })
    );

    expect(settings.ai.enabled).toBe(false);
  });

  it('旧版默认写入 enabled=false 但已保存密钥时，会迁移为启用', () => {
    const settings = mergeSettingsDraft(
      JSON.stringify({
        ai: {
          enabled: false,
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-5.4-mini',
        },
      })
    );

    expect(settings.ai.enabled).toBe(true);
    expect(settings.ai.enabledExplicitlySet).toBe(false);
  });

  it('会把千字标记阈值限制在允许的预设档位内', () => {
    const validSettings = mergeSettingsDraft(
      JSON.stringify({
        general: {
          thousandCharMarkerStep: 2000,
        },
      })
    );
    const invalidSettings = mergeSettingsDraft(
      JSON.stringify({
        general: {
          thousandCharMarkerStep: 1234,
        },
      })
    );

    expect(validSettings.general.thousandCharMarkerStep).toBe(2000);
    expect(invalidSettings.general.thousandCharMarkerStep).toBe(1000);
  });
});
