/**
 * 轻量参数解析器（无第三方依赖）
 *
 * 解析流程：
 *   1. 先从任意位置提取全局选项（--json / -v / -q / --config / --cwd / -h / --version）
 *   2. 用剩余参数的前缀匹配命令路径（支持 `stats` 与 `stats today` 这种同名父子命令）
 *   3. 按命令定义解析命令选项与位置参数，未知命令/选项给出拼写建议
 */
import { CliError } from './errors';
import { didYouMean } from './suggest';
import type {
  CommandSpec,
  GlobalOptions,
  OptionSpec,
  OptionValue,
  ParsedCommandArgs,
} from './types';

export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  {
    name: 'json',
    type: 'boolean',
    description: '以 JSON 格式输出 { ok, data | error }（AI 友好）',
  },
  { name: 'verbose', short: 'v', type: 'boolean', description: '输出详细日志到 stderr' },
  { name: 'quiet', short: 'q', type: 'boolean', description: '静默模式，只输出结果' },
  { name: 'config', type: 'string', valueName: 'path', description: '指定项目配置文件路径' },
  { name: 'cwd', type: 'string', valueName: 'path', description: '指定工作目录' },
  { name: 'help', short: 'h', type: 'boolean', description: '显示帮助' },
];

export type ParseOutcome =
  | { kind: 'command'; globals: GlobalOptions; command: CommandSpec; args: ParsedCommandArgs }
  | { kind: 'help'; globals: GlobalOptions; topic: string[]; missingSubcommand?: boolean }
  | { kind: 'version'; globals: GlobalOptions };

export function createDefaultGlobals(): GlobalOptions {
  return { json: false, verbose: false, quiet: false, help: false };
}

function splitInlineValue(token: string): { flag: string; inline?: string } {
  const eq = token.indexOf('=');
  return eq === -1 ? { flag: token } : { flag: token.slice(0, eq), inline: token.slice(eq + 1) };
}

function findOption(specs: readonly OptionSpec[], flag: string): OptionSpec | undefined {
  if (flag.startsWith('--')) {
    const name = flag.slice(2);
    return specs.find((spec) => spec.name === name);
  }
  if (/^-[A-Za-z]$/.test(flag)) {
    return specs.find((spec) => spec.short === flag.slice(1));
  }
  return undefined;
}

/**
 * 第一阶段：提取全局选项。即使后续解析失败，也能拿到 --json 等设置用于格式化错误。
 */
export function extractGlobals(argv: readonly string[]): {
  globals: GlobalOptions;
  rest: string[];
  version: boolean;
  error?: CliError;
} {
  const globals = createDefaultGlobals();
  const rest: string[] = [];
  let version = false;
  let error: CliError | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    if (token === '--version' || token === '-V') {
      version = true;
      continue;
    }
    const { flag, inline } = splitInlineValue(token);
    const spec = token.startsWith('-') ? findOption(GLOBAL_OPTIONS, flag) : undefined;
    if (!spec) {
      rest.push(token);
      continue;
    }
    if (spec.type === 'boolean') {
      const value = inline === undefined ? true : !['false', '0', 'no'].includes(inline);
      if (spec.name === 'json') globals.json = value;
      else if (spec.name === 'verbose') globals.verbose = value;
      else if (spec.name === 'quiet') globals.quiet = value;
      else if (spec.name === 'help') globals.help = value;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value === '') {
      error = error ?? new CliError('USAGE', `选项 --${spec.name} 需要一个值`);
      continue;
    }
    if (spec.name === 'config') globals.config = value;
    else if (spec.name === 'cwd') globals.cwd = value;
  }
  return { globals, rest, version, error };
}

function topLevelNames(commands: readonly CommandSpec[]): string[] {
  return Array.from(new Set(commands.map((command) => command.path[0])));
}

/** 第二阶段：按前缀匹配命令 */
function resolveCommand(
  commands: readonly CommandSpec[],
  rest: string[],
  globals: GlobalOptions
): { command: CommandSpec; consumed: number } | ParseOutcome {
  const head = rest[0];
  const family = commands.filter((command) => command.path[0] === head);
  if (family.length === 0) {
    const names = [...topLevelNames(commands), 'help'];
    throw new CliError('UNKNOWN_COMMAND', `未知命令: ${head}`, didYouMean(head, names));
  }
  const sub = rest[1];
  const subCommands = family.filter((command) => command.path.length === 2);
  const exactSub = sub ? subCommands.find((command) => command.path[1] === sub) : undefined;
  if (exactSub) return { command: exactSub, consumed: 2 };

  const self = family.find((command) => command.path.length === 1);
  if (self) return { command: self, consumed: 1 };

  // 纯命令组（如 file / novel），缺少或写错子命令
  if (!sub || sub.startsWith('-')) {
    return { kind: 'help', globals, topic: [head], missingSubcommand: !globals.help };
  }
  throw new CliError(
    'UNKNOWN_COMMAND',
    `未知子命令: ${head} ${sub}`,
    didYouMean(
      sub,
      subCommands.map((command) => command.path[1])
    ) ?? `可用子命令: ${subCommands.map((command) => command.path[1]).join(', ')}`
  );
}

function coerceValue(spec: OptionSpec, raw: string): OptionValue {
  if (spec.type === 'number') {
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      throw new CliError('INVALID_ARGUMENT', `选项 --${spec.name} 需要数字，收到: ${raw}`);
    }
    return num;
  }
  if (spec.type === 'boolean') return !['false', '0', 'no'].includes(raw.toLowerCase());
  if (spec.choices && !spec.choices.includes(raw)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `选项 --${spec.name} 的值无效: ${raw}`,
      `可选值: ${spec.choices.join(' | ')}`
    );
  }
  return raw;
}

/** 第三阶段：解析命令自身的选项和位置参数 */
export function parseCommandArgs(
  command: CommandSpec,
  tokens: readonly string[]
): ParsedCommandArgs {
  const specs = command.options ?? [];
  const options: Record<string, OptionValue | undefined> = {};
  const positionalValues: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--') {
      positionalValues.push(...tokens.slice(i + 1));
      break;
    }
    // 单独的 "-" 与负数按位置参数处理
    if (!token.startsWith('-') || token === '-' || /^-\d/.test(token)) {
      positionalValues.push(token);
      continue;
    }
    const { flag, inline } = splitInlineValue(token);
    let spec = findOption(specs, flag);
    let negated = false;
    if (!spec && flag.startsWith('--no-')) {
      const candidate = findOption(specs, `--${flag.slice(5)}`);
      if (candidate?.type === 'boolean') {
        spec = candidate;
        negated = true;
      }
    }
    if (!spec) {
      const names = [...specs, ...GLOBAL_OPTIONS].map((item) => `--${item.name}`);
      throw new CliError(
        'UNKNOWN_OPTION',
        `未知选项: ${flag}（命令: ${command.path.join(' ')}）`,
        didYouMean(flag, names) ?? `运行 \`ne ${command.path.join(' ')} --help\` 查看可用选项`
      );
    }
    if (spec.type === 'boolean') {
      options[spec.name] = negated
        ? false
        : inline === undefined
          ? true
          : coerceValue(spec, inline);
      continue;
    }
    let raw = inline;
    if (raw === undefined) {
      raw = tokens[i + 1];
      i += 1;
    }
    if (raw === undefined) {
      throw new CliError('USAGE', `选项 --${spec.name} 需要一个值`);
    }
    options[spec.name] = coerceValue(spec, raw);
  }

  for (const spec of specs) {
    if (options[spec.name] === undefined && spec.default !== undefined) {
      options[spec.name] = spec.default;
    }
  }

  const positionals: Record<string, string | string[] | undefined> = {};
  const positionalSpecs = command.positionals ?? [];
  let cursor = 0;
  for (const spec of positionalSpecs) {
    if (spec.variadic) {
      positionals[spec.name] = positionalValues.slice(cursor);
      cursor = positionalValues.length;
      if (spec.required && (positionals[spec.name] as string[]).length === 0) {
        throw new CliError('USAGE', `缺少参数 <${spec.name}>`, `用法: ${formatUsage(command)}`);
      }
      continue;
    }
    const value = positionalValues[cursor];
    if (value === undefined && spec.required) {
      throw new CliError('USAGE', `缺少参数 <${spec.name}>`, `用法: ${formatUsage(command)}`);
    }
    positionals[spec.name] = value;
    if (value !== undefined) cursor += 1;
  }
  if (cursor < positionalValues.length) {
    throw new CliError(
      'USAGE',
      `多余的参数: ${positionalValues.slice(cursor).join(' ')}`,
      `用法: ${formatUsage(command)}`
    );
  }
  return { positionals, options };
}

export function formatUsage(command: CommandSpec): string {
  const parts = ['ne', ...command.path];
  for (const spec of command.positionals ?? []) {
    const name = spec.variadic ? `${spec.name}...` : spec.name;
    parts.push(spec.required ? `<${name}>` : `[${name}]`);
  }
  if ((command.options ?? []).length > 0) parts.push('[options]');
  return parts.join(' ');
}

/** 完整解析入口 */
export function parseArgv(argv: readonly string[], commands: readonly CommandSpec[]): ParseOutcome {
  const { globals, rest, version, error } = extractGlobals(argv);
  if (error) throw error;
  if (rest.length === 0) {
    if (version) return { kind: 'version', globals };
    return { kind: 'help', globals, topic: [] };
  }
  if (rest[0] === 'help') return { kind: 'help', globals, topic: rest.slice(1) };
  if (rest[0].startsWith('-')) {
    const names = [...GLOBAL_OPTIONS.map((item) => `--${item.name}`), '--version'];
    throw new CliError('UNKNOWN_OPTION', `未知选项: ${rest[0]}`, didYouMean(rest[0], names));
  }

  const resolved = resolveCommand(commands, rest, globals);
  if ('kind' in resolved) return resolved;
  const { command, consumed } = resolved;
  if (globals.help) return { kind: 'help', globals, topic: [...command.path] };
  return {
    kind: 'command',
    globals,
    command,
    args: parseCommandArgs(command, rest.slice(consumed)),
  };
}
