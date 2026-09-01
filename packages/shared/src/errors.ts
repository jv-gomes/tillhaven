/**
 * Machine-readable error codes (CLAUDE.md §10).
 *
 * The client reacts to the CODE, never to the English message. Never remove or
 * repurpose a code once it ships — add a new one instead.
 */
export const ErrorCode = {
  // --- auth / session ---
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // --- authorization ---
  FORBIDDEN: 'FORBIDDEN',
  NOT_OWNER: 'NOT_OWNER',

  // --- validation / transport ---
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',

  // --- farm / crops ---
  PLOT_OCCUPIED: 'PLOT_OCCUPIED',
  PLOT_EMPTY: 'PLOT_EMPTY',
  PLOT_LOCKED: 'PLOT_LOCKED',
  /** Soil has to be hoed before a seed goes in (T-9.02, CLAUDE.md §5.2). */
  PLOT_NOT_TILLED: 'PLOT_NOT_TILLED',
  /** Already hoed. Tilling twice is a no-op the player should hear about. */
  PLOT_ALREADY_TILLED: 'PLOT_ALREADY_TILLED',
  CROP_NOT_READY: 'CROP_NOT_READY',
  UNKNOWN_CROP: 'UNKNOWN_CROP',
  PLOT_ALREADY_UNLOCKED: 'PLOT_ALREADY_UNLOCKED',
  PLOT_CAP_REACHED: 'PLOT_CAP_REACHED',

  // --- idle mode (CLAUDE.md §5.3) ---
  /**
   * Told to plant, but not told what. Refused rather than accepted-and-ignored:
   * a farmer standing in a tilled field sowing nothing looks like a bug, and
   * the player would have no way to tell it from one.
   */
  IDLE_CROP_REQUIRED: 'IDLE_CROP_REQUIRED',

  // --- animals ---
  ANIMAL_NOT_MATURE: 'ANIMAL_NOT_MATURE',
  ANIMAL_UNFED: 'ANIMAL_UNFED',
  NOTHING_TO_COLLECT: 'NOTHING_TO_COLLECT',
  ANIMAL_CAP_REACHED: 'ANIMAL_CAP_REACHED',

  // --- inventory ---
  INVENTORY_FULL: 'INVENTORY_FULL',
  INSUFFICIENT_ITEMS: 'INSUFFICIENT_ITEMS',
  INSUFFICIENT_GOLD: 'INSUFFICIENT_GOLD',
  UNKNOWN_ITEM: 'UNKNOWN_ITEM',
  STACK_LIMIT_EXCEEDED: 'STACK_LIMIT_EXCEEDED',

  // --- upgrades (chest, house) ---
  UPGRADE_MAX_TIER: 'UPGRADE_MAX_TIER',

  // --- shop ---
  ITEM_NOT_FOR_SALE: 'ITEM_NOT_FOR_SALE',
  ITEM_NOT_SELLABLE: 'ITEM_NOT_SELLABLE',

  // --- trade (CLAUDE.md §6) ---
  TRADE_NOT_FOUND: 'TRADE_NOT_FOUND',
  TRADE_NOT_ELIGIBLE: 'TRADE_NOT_ELIGIBLE',
  TRADE_ALREADY_CONFIRMED: 'TRADE_ALREADY_CONFIRMED',
  TRADE_OFFER_CHANGED: 'TRADE_OFFER_CHANGED',
  TRADE_PARTNER_LEFT: 'TRADE_PARTNER_LEFT',
  TRADE_ITEM_MISSING: 'TRADE_ITEM_MISSING',
  TRADE_NOT_READY: 'TRADE_NOT_READY',
  TRADE_RATE_LIMITED: 'TRADE_RATE_LIMITED',
  TRADE_SELF: 'TRADE_SELF',
  TRADE_ALREADY_OPEN: 'TRADE_ALREADY_OPEN',
  TRADE_EXPIRED: 'TRADE_EXPIRED',

  // --- vip / payments (CLAUDE.md §7) ---
  VIP_ALREADY_ACTIVE: 'VIP_ALREADY_ACTIVE',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  ACCOUNT_FLAGGED: 'ACCOUNT_FLAGGED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP status for each code, so route handlers never hand-pick one. */
const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  SESSION_EXPIRED: 401,

  FORBIDDEN: 403,
  NOT_OWNER: 403,

  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  INTERNAL: 500,

  PLOT_OCCUPIED: 409,
  PLOT_EMPTY: 409,
  PLOT_LOCKED: 403,
  PLOT_NOT_TILLED: 409,
  PLOT_ALREADY_TILLED: 409,
  CROP_NOT_READY: 409,
  UNKNOWN_CROP: 400,
  PLOT_ALREADY_UNLOCKED: 409,
  PLOT_CAP_REACHED: 409,

  IDLE_CROP_REQUIRED: 400,

  ANIMAL_NOT_MATURE: 409,
  ANIMAL_UNFED: 409,
  NOTHING_TO_COLLECT: 409,
  ANIMAL_CAP_REACHED: 409,

  INVENTORY_FULL: 409,
  INSUFFICIENT_ITEMS: 409,
  INSUFFICIENT_GOLD: 409,
  UNKNOWN_ITEM: 400,
  STACK_LIMIT_EXCEEDED: 409,

  UPGRADE_MAX_TIER: 409,

  ITEM_NOT_FOR_SALE: 400,
  ITEM_NOT_SELLABLE: 400,

  TRADE_NOT_FOUND: 404,
  TRADE_NOT_ELIGIBLE: 403,
  TRADE_ALREADY_CONFIRMED: 409,
  TRADE_OFFER_CHANGED: 409,
  TRADE_PARTNER_LEFT: 409,
  TRADE_ITEM_MISSING: 409,
  TRADE_NOT_READY: 409,
  TRADE_RATE_LIMITED: 429,
  TRADE_SELF: 400,
  TRADE_ALREADY_OPEN: 409,
  TRADE_EXPIRED: 409,

  VIP_ALREADY_ACTIVE: 409,
  PAYMENT_FAILED: 402,
  WEBHOOK_SIGNATURE_INVALID: 400,
  ACCOUNT_FLAGGED: 403,
};

/**
 * The only error type that may cross the API boundary. Anything else becomes a
 * generic INTERNAL so internals are never leaked to the client (CLAUDE.md §4.1).
 */
export class GameError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Safe to show the player. Must not contain internals, IDs of other players, etc. */
  readonly details: Record<string, string | number> | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, string | number>,
  ) {
    super(message ?? code);
    this.name = 'GameError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, string | number> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isGameError(e: unknown): e is GameError {
  return e instanceof GameError;
}
