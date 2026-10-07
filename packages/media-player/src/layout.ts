/** 播放器根元素的类名（从 VideoPlayer.tsx 拆出，便于单独测试） */
export interface PlayerRootFlags {
  compact: boolean;
  showControls: boolean;
  audioOnly: boolean;
  /** 还不知道画面比例、也没有封面：先用占位尺寸 */
  pending: boolean;
  className?: string;
}

export function playerRootClass(
  styles: Readonly<Record<string, string>>,
  flags: PlayerRootFlags
): string {
  return [
    styles.player,
    flags.compact ? styles.compact : '',
    flags.showControls ? styles.controlsVisible : '',
    flags.audioOnly ? styles.audioMode : '',
    flags.pending ? styles.pending : '',
    flags.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}
