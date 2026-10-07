/**
 * AI 错误 → 写作界面上的友好提示（行内续写 widget 与续写面板共用）
 */
import type { SerializedAIError } from '@/shared/ai';
import { hideRawData } from '@/render/utils/debugMode';

export interface AIErrorDisplay {
  title: string;
  hint: string;
  canRetry: boolean;
  /** 需要去设置中心（未配置 / Key 无效） */
  needsSettings: boolean;
}

export function describeAIError(error: SerializedAIError): AIErrorDisplay {
  switch (error.kind) {
    case 'not-configured':
      return {
        title: 'AI 还没有配置',
        hint: '在设置中心填写 Grok 或默认 AI 的 API Key 后即可续写',
        canRetry: false,
        needsSettings: true,
      };
    case 'auth':
      return {
        title: 'API Key 无效',
        hint: '请检查 Key 是否正确、是否有该模型的权限',
        canRetry: false,
        needsSettings: true,
      };
    case 'quota':
      return {
        title: '额度不足',
        hint: '账户余额或额度用完了，请到服务商控制台充值或换一个服务',
        canRetry: true,
        needsSettings: true,
      };
    case 'content-safety':
      return {
        title: '内容被安全策略拦截',
        hint: '换个方向或调整前文后再试',
        canRetry: true,
        needsSettings: false,
      };
    case 'rate-limit':
      return { title: '请求太频繁', hint: '稍等片刻再试', canRetry: true, needsSettings: false };
    case 'network':
      return {
        title: '网络连接失败',
        hint: '请检查网络或接口地址',
        canRetry: true,
        needsSettings: false,
      };
    case 'timeout':
      return { title: '请求超时', hint: '稍后重试', canRetry: true, needsSettings: false };
    case 'server':
      return { title: '服务暂时不可用', hint: '稍后重试', canRetry: true, needsSettings: false };
    case 'aborted':
      return { title: '已取消', hint: '', canRetry: true, needsSettings: false };
    default:
      return {
        title: '续写失败',
        // 厂商返回的原始 JSON 不直接展示（调试模式除外）
        hint: hideRawData(error.message, '未知错误，请稍后重试'),
        canRetry: true,
        needsSettings: false,
      };
  }
}
