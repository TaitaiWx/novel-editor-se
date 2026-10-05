/**
 * 帮助文本渲染（参考 VS Code CLI 的分组风格）
 */
import { CliError } from './errors';
import { GLOBAL_OPTIONS, formatUsage } from './parser';
import { didYouMean } from './suggest';
import { CLI_VERSION } from './version';
import type { CommandSpec, OptionSpec } from './types';

/** 命令组说明 */
export const GROUP_SUMMARIES: Record<string, string> = {
  file: '文件操作',
  batch: '批量操作',
  novel: '作品管理',
  chapter: '章节管理',
  stats: '写作统计',
  growth: '成长记录器 / 记忆库',
};

function formatOption(spec: OptionSpec): [string, string] {
  const flag = `${spec.short ? `-${spec.short}, ` : '    '}--${spec.name}`;
  const value =
    spec.type === 'boolean' ? '' : ` <${spec.valueName ?? spec.choices?.join('|') ?? spec.type}>`;
  const extra =
    spec.default !== undefined && spec.type !== 'boolean' ? `（默认: ${spec.default}）` : '';
  return [`${flag}${value}`, `${spec.description}${extra}`];
}

function columns(rows: Array<[string, string]>, indent = '  '): string {
  const width = Math.max(...rows.map(([left]) => left.length), 0);
  return rows.map(([left, right]) => `${indent}${left.padEnd(width)}  ${right}`).join('\n');
}

export function renderRootHelp(commands: readonly CommandSpec[]): string {
  const sections: string[] = [
    `Novel Editor CLI v${CLI_VERSION}`,
    '',
    '用法: ne <command> [subcommand] [args] [options]',
    '      novel-editor 与 ne 等价',
  ];
  const order: string[] = [];
  for (const command of commands) if (!order.includes(command.path[0])) order.push(command.path[0]);
  const standalone = order.filter((name) => !GROUP_SUMMARIES[name]);
  sections.push(
    '',
    '命令:',
    columns(
      standalone.map((name) => {
        const command = commands.find((item) => item.path.length === 1 && item.path[0] === name);
        return [name, command?.summary ?? ''];
      })
    )
  );
  for (const group of order.filter((name) => GROUP_SUMMARIES[name])) {
    sections.push(
      '',
      `${GROUP_SUMMARIES[group]} (${group}):`,
      columns(
        commands
          .filter((command) => command.path[0] === group)
          .map((command) => [command.path.join(' '), command.summary])
      )
    );
  }
  sections.push(
    '',
    '全局选项:',
    columns([...GLOBAL_OPTIONS.map(formatOption), ['    --version', '输出版本号']]),
    '',
    '运行 `ne help <command>` 或 `ne <command> --help` 查看命令详情。'
  );
  return sections.join('\n');
}

export function renderGroupHelp(group: string, commands: readonly CommandSpec[]): string {
  const members = commands.filter((command) => command.path[0] === group);
  return [
    `${GROUP_SUMMARIES[group] ?? group}`,
    '',
    `用法: ne ${group} <subcommand> [args] [options]`,
    '',
    '子命令:',
    columns(members.map((command) => [command.path.join(' '), command.summary])),
    '',
    `运行 \`ne ${group} <subcommand> --help\` 查看子命令详情。`,
  ].join('\n');
}

export function renderCommandHelp(command: CommandSpec): string {
  const sections = [`用法: ${formatUsage(command)}`, '', command.description ?? command.summary];
  if (command.positionals?.length) {
    sections.push(
      '',
      '参数:',
      columns(command.positionals.map((spec) => [`<${spec.name}>`, spec.description]))
    );
  }
  if (command.options?.length) {
    sections.push('', '选项:', columns(command.options.map(formatOption)));
  }
  sections.push('', '全局选项:', columns(GLOBAL_OPTIONS.map(formatOption)));
  if (command.examples?.length) {
    sections.push('', '示例:', command.examples.map((example) => `  $ ${example}`).join('\n'));
  }
  return sections.join('\n');
}

/** 根据主题渲染帮助：[] → 总览；[group] → 组；[group, sub] → 命令 */
export function renderHelp(topic: string[], commands: readonly CommandSpec[]): string {
  if (topic.length === 0) return renderRootHelp(commands);
  const exact = commands.find(
    (command) =>
      command.path.length === topic.length && command.path.every((part, i) => part === topic[i])
  );
  if (exact) return renderCommandHelp(exact);
  if (topic.length === 1 && commands.some((command) => command.path[0] === topic[0])) {
    return renderGroupHelp(topic[0], commands);
  }
  const names = commands.map((command) => command.path.join(' '));
  throw new CliError(
    'UNKNOWN_COMMAND',
    `没有该命令的帮助: ${topic.join(' ')}`,
    didYouMean(topic.join(' '), names)
  );
}

/** 机器可读的命令清单（--json 帮助 / daemon /commands 使用） */
export function describeCommands(commands: readonly CommandSpec[]) {
  return commands.map((command) => ({
    command: command.path.join(' '),
    summary: command.summary,
    usage: formatUsage(command),
    positionals: (command.positionals ?? []).map((spec) => ({
      name: spec.name,
      required: Boolean(spec.required),
      variadic: Boolean(spec.variadic),
      description: spec.description,
    })),
    options: (command.options ?? []).map((spec) => ({
      name: spec.name,
      short: spec.short ?? null,
      type: spec.type,
      choices: spec.choices ?? null,
      default: spec.default ?? null,
      description: spec.description,
    })),
  }));
}
