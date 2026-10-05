import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import {
  createEmptyStoryIdeaDraft,
  draftToStoryIdeaUpdatePayload,
  serializeStoryIdeaDraft,
  toStoryIdeaDraft,
  type StoryIdeaCardDraft,
} from '../story-idea';
import type { useStoryIdeaCards } from '../useStoryIdeaCards';

type StoryIdeaCardsApi = ReturnType<typeof useStoryIdeaCards>;

/**
 * 当前创意卡草稿：切卡时载入草稿、外部更新时同步、编辑后 450ms 自动保存。
 */
export function useStoryIdeaDraft({
  activeCard,
  loadOutputs,
  updateCard,
}: {
  activeCard: StoryIdeaCardRow | null;
  loadOutputs: StoryIdeaCardsApi['loadOutputs'];
  updateCard: StoryIdeaCardsApi['updateCard'];
}) {
  const [draftCardId, setDraftCardId] = useState<number | null>(null);
  const [draft, setDraft] = useState<StoryIdeaCardDraft>(createEmptyStoryIdeaDraft());
  const [lastSavedSignature, setLastSavedSignature] = useState(() =>
    serializeStoryIdeaDraft(createEmptyStoryIdeaDraft())
  );
  const [saving, setSaving] = useState(false);

  const draftSignature = useMemo(() => serializeStoryIdeaDraft(draft), [draft]);
  const isDirty = draftSignature !== lastSavedSignature;

  useEffect(() => {
    if (!activeCard) {
      const empty = createEmptyStoryIdeaDraft();
      setDraft(empty);
      setDraftCardId(null);
      setLastSavedSignature(serializeStoryIdeaDraft(empty));
      return;
    }
    if (draftCardId !== activeCard.id) {
      const nextDraft = toStoryIdeaDraft(activeCard);
      setDraft(nextDraft);
      setDraftCardId(activeCard.id);
      setLastSavedSignature(serializeStoryIdeaDraft(nextDraft));
    }
  }, [activeCard, draftCardId]);

  useEffect(() => {
    if (!activeCard) return;
    void loadOutputs(activeCard.id);
  }, [activeCard, loadOutputs]);

  useEffect(() => {
    if (!activeCard || isDirty) return;
    const nextDraft = toStoryIdeaDraft(activeCard);
    const nextSignature = serializeStoryIdeaDraft(nextDraft);
    if (nextSignature !== lastSavedSignature) {
      setDraft(nextDraft);
      setLastSavedSignature(nextSignature);
    }
  }, [activeCard, isDirty, lastSavedSignature]);

  useEffect(() => {
    if (!activeCard || !isDirty) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      void updateCard(activeCard.id, draftToStoryIdeaUpdatePayload(draft))
        .then(() => {
          setLastSavedSignature(draftSignature);
        })
        .finally(() => {
          setSaving(false);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeCard, draft, draftSignature, isDirty, updateCard]);

  const setField = useCallback(
    <K extends keyof StoryIdeaCardDraft>(key: K, value: StoryIdeaCardDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return { draft, setDraft, saving, setField };
}
