/** Built-in command resource declarations. Unknown/extension commands retain wildcard leases. */
import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  findProjectRoot,
  findStructureConfigRoot,
  resolveNovelPath,
  resolveStatsTargets,
  resolveWorkScope,
  sanitizeFileName,
} from '@novel-editor/core';
import type { CliContext, CommandSpec, ParsedCommandArgs } from './types';

export async function commandWorkspaceResources(
  command: CommandSpec,
  ctx: CliContext,
  args: ParsedCommandArgs
): Promise<string[] | undefined> {
  const [group, action] = command.path;
  const positional = (name: string) =>
    typeof args.positionals[name] === 'string' ? (args.positionals[name] as string) : undefined;
  const option = (name: string) =>
    typeof args.options[name] === 'string' ? (args.options[name] as string) : undefined;
  const resolve = (value: string) => path.resolve(ctx.cwd, value);
  const logRoots = async (targets: string[]) => {
    const roots = await Promise.all(targets.map((target) => findProjectRoot(path.dirname(target))));
    return [...targets, ...roots.filter((root): root is string => !!root)];
  };
  if (group === 'file') {
    if (action === 'rename') return [resolve(positional('old')!), resolve(positional('new')!)];
    const target = resolve(positional('file') ?? positional('path') ?? '.');
    return action === 'write' || action === 'create' ? logRoots([target]) : [target];
  }
  if (group === 'batch') {
    const source = resolve(positional('path') ?? '.');
    if (action === 'find-replace')
      return [
        ...(await logRoots([source])),
        ...(await logRoots([path.join(source, 'chapter.md')])),
      ];
    const out = option('out');
    const destination = out
      ? resolve(out)
      : action === 'export'
        ? path.join(
            path.dirname(source),
            `${path.basename(source)}-export-${option('format') ?? 'txt'}`
          )
        : path.dirname(source); // Single-file conversion writes siblings; directory conversion remains covered.
    const sourceScope =
      action === 'convert' && !(await stat(source).catch(() => null))?.isDirectory()
        ? path.dirname(source)
        : source;
    return [sourceScope, source, destination];
  }
  if (group === 'init') return [resolve(positional('path') ?? '.')];
  if (group === 'novel' || group === 'chapter' || group === 'growth' || group === 'status') {
    const project = await ctx.getProject();
    const resources = project ? [project.root, project.novelsPath] : [ctx.cwd];
    if (group === 'chapter' && project && positional('novel')) {
      const work = await resolveNovelPath(project, positional('novel')!);
      resources.push(work);
      if (option('volume'))
        resources.push(path.join(work, ...option('volume')!.split(/[\\/]/).map(sanitizeFileName)));
    }
    if (group === 'novel' && project && action !== 'create' && positional('name'))
      resources.push(await resolveNovelPath(project, positional('name')!));
    if (group === 'growth') {
      const folder =
        project && !ctx.cwd.startsWith(project.root + path.sep) ? project.root : ctx.cwd;
      resources.push((await resolveWorkScope(folder, { workName: option('novel') })).root);
    }
    if (group === 'novel' && action === 'export' && option('out'))
      resources.push(resolve(option('out')!));
    if (group === 'growth' && action === 'apply-sim' && positional('file'))
      resources.push(resolve(positional('file')!));
    return resources;
  }
  if (group === 'structure') {
    const project = await ctx.getProject();
    return [project?.root ?? (await findStructureConfigRoot(ctx.cwd)) ?? ctx.cwd];
  }
  if (group === 'lint' || group === 'stats') {
    const project = await ctx.getProject();
    if (group === 'stats' && action) return [project?.root ?? ctx.cwd];
    const target = positional('target') ?? project?.novelsPath ?? ctx.cwd;
    const resolved = await resolveStatsTargets(target, ctx.cwd, project);
    return [project?.root ?? ctx.cwd, resolved.path, ...(project ? [project.novelsPath] : [])];
  }
  return undefined;
}
