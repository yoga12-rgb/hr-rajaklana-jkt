/** Clear a form draft only when it still contains the value just saved. */
export function clearSavedFollowupDraft<T>(drafts: Record<string, T>, key: string, submitted: T, fieldWasSaved = true): Record<string, T> {
  if (!fieldWasSaved || drafts[key] !== submitted) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}
