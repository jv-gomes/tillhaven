import { ApiRequestError } from './api.js';

/**
 * Turns a machine-readable error code into something a player can read
 * (CLAUDE.md §10 — the client reacts to the CODE, never to English text from
 * the server).
 *
 * The server's own message is a developer-facing fallback. Anything a player
 * is expected to act on gets its wording decided here, next to the UI it
 * appears in.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  NETWORK: 'Could not reach the server. Check your connection and try again.',
  INTERNAL: 'Something went wrong on our end. Try again in a moment.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  VALIDATION_FAILED: 'Some of that input was not valid.',

  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  SESSION_EXPIRED: 'Your session has ended. Sign in again.',
  INVALID_CREDENTIALS: 'That email or password is not right.',
  EMAIL_TAKEN: 'There is already an account with that email.',
  USERNAME_TAKEN: 'That farm name is taken. Try another.',

  NOT_FOUND: 'That is not on your farm.',
  FORBIDDEN: 'You cannot do that.',
  NOT_OWNER: 'That is not yours.',

  PLOT_OCCUPIED: 'Something is already growing there.',
  PLOT_EMPTY: 'There is nothing growing there.',
  PLOT_LOCKED: 'That plot is not cleared yet.',
  PLOT_NOT_TILLED: 'That soil needs tilling first. Use the hoe.',
  PLOT_ALREADY_TILLED: 'That soil is already tilled.',
  PLOT_ALREADY_UNLOCKED: 'That plot is already cleared.',
  PLOT_CAP_REACHED: 'Your farm cannot grow any further.',
  UPGRADE_MAX_TIER: 'That is already as good as it gets.',
  CROP_NOT_READY: 'That is not ready to harvest yet.',
  UNKNOWN_CROP: 'That crop does not exist.',
  IDLE_CROP_REQUIRED: 'Pick a crop for your farmer to plant.',

  INVENTORY_FULL: 'Your bag is full. Sell or store something first.',
  INSUFFICIENT_ITEMS: "You don't have enough of that.",
  INSUFFICIENT_GOLD: "You can't afford that.",

  TRADE_NOT_FOUND: 'That trade is not yours, or no longer exists.',
  TRADE_NOT_ELIGIBLE: 'Trading needs an older, more established farm. Check back later.',
  TRADE_ALREADY_CONFIRMED: 'You already confirmed this offer.',
  TRADE_OFFER_CHANGED: 'The offer changed — confirm the new one to continue.',
  TRADE_PARTNER_LEFT: 'That farmer is no longer available.',
  TRADE_ITEM_MISSING: 'They no longer have everything they offered. The trade was cancelled.',
  TRADE_NOT_READY: 'Both farmers need to confirm before this can go through.',
  TRADE_RATE_LIMITED: "You've completed a lot of trades today. Try again tomorrow.",
  TRADE_SELF: 'You cannot trade with yourself.',
  TRADE_ALREADY_OPEN: 'Finish or cancel your current trade first.',
  TRADE_EXPIRED: 'This trade timed out.',
};

export function messageFor(err: unknown): string {
  if (err instanceof ApiRequestError) {
    return MESSAGES[err.code] ?? 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}

/** The field a validation error belongs to, when the server named one. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiRequestError) || !err.details) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(err.details)) {
    out[key] = String(value);
  }
  return out;
}

export function codeOf(err: unknown): string | undefined {
  return err instanceof ApiRequestError ? err.code : undefined;
}
