import { useEffect, useState } from 'react';
import { loadAvatarSource } from '@/render/utils/characterAvatar';

export interface AvatarCharacter {
  name: string;
  avatar?: string;
}

/**
 * 人物头像 → 可直接显示 / 作首帧参考的地址（data URL / http）：
 * 头像可能是 data URL，也可能是作品内的相对路径（资料/人物头像/…），后者经 read-file-binary 读取。
 * 没有头像或读取失败的人物不在结果里（界面显示首字圆标并提示补图）。
 */
export function useResolvedAvatars(
  characters: readonly AvatarCharacter[],
  workPath: string | null
): Record<string, string> {
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const withAvatar = characters.filter((item) => item.avatar?.trim());
    if (withAvatar.length === 0) {
      setAvatars({});
      return;
    }
    void Promise.all(
      withAvatar.map(async (item) => {
        const source = await loadAvatarSource(item.avatar, workPath).catch(() => null);
        return source ? ([item.name, source] as const) : null;
      })
    ).then((entries) => {
      if (cancelled) return;
      setAvatars(
        Object.fromEntries(
          entries.filter((entry): entry is readonly [string, string] => entry !== null)
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [characters, workPath]);

  return avatars;
}
