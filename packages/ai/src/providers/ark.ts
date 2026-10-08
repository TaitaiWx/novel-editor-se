/**
 * 火山方舟（Ark）共用的错误提示
 *
 * 2026-10-09 用真实 Key 验证：模型没有在控制台开通时，方舟返回
 * 「The model or endpoint xxx does not exist or you do not have access to it.」（HTTP 404，
 * code InvalidEndpointOrModel.NotFound），原文看不出下一步该做什么，这里追加中文提示。
 */
import { AIError } from '../errors';

export const ARK_MODEL_ACCESS_HINT = '请在火山方舟控制台「开通管理」开通该模型';

const MODEL_ACCESS_PATTERN = /does not exist or you do not have access/i;

/** 错误信息是「模型不存在或无权访问」时追加开通提示（其他错误原样返回） */
export function withArkModelHint(error: AIError): AIError {
  if (!MODEL_ACCESS_PATTERN.test(error.message) || error.message.includes(ARK_MODEL_ACCESS_HINT)) {
    return error;
  }
  return new AIError({
    ...error.toJSON(),
    message: `${error.message}（${ARK_MODEL_ACCESS_HINT}）`,
    cause: error,
  });
}
