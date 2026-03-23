// In-memory cache of bot-sent messages keyed by Teams activity ID.
// Used to resolve full quoted text when users reply-with-quote (#166).
// This is process-local and ephemeral — cache misses fall back to
// the truncated preview extracted from the HTML blockquote.

const MAX_ENTRIES = 200;

/** activity ID → sent message text */
const cache = new Map<string, string>();

/**
 * Store a sent message's text keyed by its Teams activity ID.
 * Evicts oldest entries when cache exceeds MAX_ENTRIES.
 */
export function cacheSentMessage(activityId: string, text: string): void {
  if (!activityId || !text) return;

  // Evict oldest if at capacity (Map iterates in insertion order)
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(activityId, text);
}

/**
 * Look up the full text of a previously-sent bot message by activity ID.
 * Returns undefined on cache miss (e.g. after container restart).
 */
export function getSentMessage(activityId: string): string | undefined {
  return cache.get(activityId);
}
