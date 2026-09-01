import type { SelfPlayer } from '@tillhaven/shared/types';
import type { Appearance } from '@tillhaven/shared/schemas';
import { api, idempotencyKey } from './api.js';

/**
 * Player-level API wrapper (everything that is not farm, inventory or trade).
 *
 * As everywhere else, the client sends an intent and renders what comes back
 * (CLAUDE.md §4.1) — the saved appearance the UI keeps is the SERVER's echo,
 * never the object that was sent.
 */

/**
 * Saves the cosmetic character appearance.
 *
 * One key per Save click, reused if that click is retried (§4.5). Appearance
 * is cosmetic, so a double-apply would be harmless — the key is here because
 * "every state-changing endpoint accepts one" is the rule, and an endpoint
 * that only mostly honours it is the one that gets copied next.
 */
export function saveAppearance(
  appearance: Appearance,
  key = idempotencyKey(),
): Promise<{ player: SelfPlayer }> {
  return api.put<{ player: SelfPlayer }>('/player/appearance', {
    appearance,
    idempotencyKey: key,
  });
}
