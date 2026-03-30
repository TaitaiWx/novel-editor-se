type KeyboardEventLike = {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
};

export function isImeComposing(event: KeyboardEventLike | null | undefined): boolean {
  if (!event) return false;

  const nativeEvent = event.nativeEvent;
  return Boolean(
    event.isComposing ||
      nativeEvent?.isComposing ||
      event.keyCode === 229 ||
      nativeEvent?.keyCode === 229 ||
      event.which === 229 ||
      nativeEvent?.which === 229
  );
}
