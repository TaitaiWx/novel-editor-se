/**
 * 正文排序映射（StoryOrderMap）的解析与重映射工具
 */
import type { StoryOrderMap } from '@/render/utils/workspace';
import { replacePathPrefix } from './fileTreeUtils';

export function parseStoryOrderMap(raw: string | null): StoryOrderMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([path, value]) => [
        path,
        Array.from(
          new Set(
            Array.isArray(value)
              ? value.filter(
                  (item): item is string => typeof item === 'string' && item.trim().length > 0
                )
              : []
          )
        ),
      ])
    );
  } catch {
    return {};
  }
}

export function remapStoryOrderMapPaths(
  storyOrderMap: StoryOrderMap,
  oldPath: string,
  newPath: string
): StoryOrderMap {
  return Object.fromEntries(
    Object.entries(storyOrderMap).map(([parentPath, orderedPaths]) => [
      replacePathPrefix(parentPath, oldPath, newPath),
      Array.from(
        new Set(orderedPaths.map((itemPath) => replacePathPrefix(itemPath, oldPath, newPath)))
      ),
    ])
  );
}

export function moveStoryPathRelative(
  orderedPaths: string[],
  sourcePath: string,
  targetPath: string,
  mode: 'before' | 'after'
): string[] {
  const nextPaths = [...orderedPaths];
  const sourceIndex = nextPaths.indexOf(sourcePath);
  const targetIndex = nextPaths.indexOf(targetPath);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return orderedPaths;
  }

  const [movedPath] = nextPaths.splice(sourceIndex, 1);
  const nextTargetIndex = nextPaths.indexOf(targetPath);
  if (!movedPath || nextTargetIndex < 0) {
    return orderedPaths;
  }
  nextPaths.splice(mode === 'after' ? nextTargetIndex + 1 : nextTargetIndex, 0, movedPath);
  return nextPaths;
}
