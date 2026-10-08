/**
 * 文本模型的「生成参数」分组：温度 / 上下文长度 / 单次回复长度。
 * 每个文本模型都显示同一组、同样的范围与说明；失焦即保存（onCommit，可清空恢复默认）。
 */
import React from 'react';
import NumberInput from '../../NumberInput';
import FieldRow from './FieldRow';
import styles from './styles.module.scss';

export type GenerationParamKey = 'temperature' | 'contextTokens' | 'maxTokens';

interface ParamSpec {
  key: GenerationParamKey;
  label: string;
  desc: string;
  min: number;
  max: number;
  step: number;
}

export const GENERATION_PARAMS: readonly ParamSpec[] = [
  {
    key: 'temperature',
    label: '温度',
    desc: '越高越发散，越低越稳定。功能自带建议值时（例如续写），以功能的建议为准。',
    min: 0,
    max: 2,
    step: 0.1,
  },
  {
    key: 'contextTokens',
    label: '上下文长度',
    desc: '这个模型单次请求能携带的上下文上限；续写等功能按它决定带多少前文与资料。',
    min: 1000,
    max: 10_000_000,
    step: 1000,
  },
  {
    key: 'maxTokens',
    label: '单次回复长度',
    desc: '单次回复的最大长度，也是各功能请求长度的上限；较长回复会消耗更多额度。',
    min: 1,
    max: 1_000_000,
    step: 128,
  },
];

type ParamValues = Partial<Record<GenerationParamKey, number | null | undefined>>;

interface GenerationParamsProps {
  /** 服务名称（用于无障碍标签，区分多个面板） */
  providerLabel: string;
  values: ParamValues;
  /** 设置草稿模式：实时修改（不可清空） */
  onChange?: (key: GenerationParamKey, value: number) => void;
  /** 即时保存模式：失焦 / Enter 提交，清空为 null（恢复服务默认值） */
  onCommit?: (key: GenerationParamKey, value: number | null) => void;
}

const GenerationParams: React.FC<GenerationParamsProps> = ({
  providerLabel,
  values,
  onChange,
  onCommit,
}) => {
  const commitMode = !onChange;
  return (
    <div
      className={styles.paramGroup}
      role="group"
      aria-label={`${providerLabel} 生成参数`}
      data-testid="ai-generation-params"
    >
      <div className={styles.paramGroupTitle}>
        生成参数
        {commitMode && <span className={styles.paramGroupHint}>留空使用服务默认值</span>}
      </div>
      {GENERATION_PARAMS.map((param) => {
        const current = values[param.key];
        const value = typeof current === 'number' ? current : null;
        return (
          <FieldRow key={param.key} label={param.label} description={param.desc}>
            <NumberInput
              block
              size="lg"
              allowEmpty={commitMode}
              min={param.min}
              max={param.max}
              step={param.step}
              aria-label={param.label}
              value={value}
              onChange={(next) => onChange?.(param.key, next)}
              onCommit={
                commitMode
                  ? (next) => {
                      if (next !== value) onCommit?.(param.key, next);
                    }
                  : undefined
              }
            />
          </FieldRow>
        );
      })}
    </div>
  );
};

export default GenerationParams;
