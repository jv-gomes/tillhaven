---
name: trading-system
description: Requirements and defensive design for Tillhaven's player-to-player trading system — trade window, dual confirmation, atomic execution, row locking, audit log, rate limits, and the RMT out-of-scope policy. Load when working on trade code, the trade UI, or trade_log.
---

# Trading System

Trading is the highest-risk system in the project. It is where duping, scamming, and exploits happen. Build it defensively.

Cross-cutting rules still apply from `CLAUDE.md`: §4.1 (client is never trusted), §4.3 (all mutations atomic), §4.5 (idempotency), §8 (security), §13 (definition of done).

## Requirements
- **Two-party trade window** with items and gold offered from both sides
- **Dual confirmation:** both players must confirm. Any change to the offer after a confirmation **resets both confirmations.**
- **Atomic execution:** the entire swap is one database transaction. Either both sides receive everything, or nothing moves.
- **Row-level locking** on both players' inventories during execution to prevent concurrent-trade duping
- **Server-side re-validation at execution time:** the server must re-verify both players still own everything they offered. Never trust the state captured when the window opened.
- **Full audit log:** every completed trade is written to an immutable `trade_log` table with both player IDs, all items, gold amounts, and timestamp. This is what lets you investigate scam reports.
- **Rate limiting:** cap trades per account per time window
- **Trade history visible to the player** — both for their own records and as a light reputation signal

## Eligibility
A player may not open or accept a trade until their account is at least **24 hours old** *and* their farm has reached **level 5**. Both conditions, checked for both parties, at invite time and again at execution. Constants: `TRADE_MIN_ACCOUNT_AGE_MS` and `TRADE_MIN_FARM_LEVEL` in `config/economy.ts`.

## Explicitly out of scope
The game does **not** implement, host, facilitate, or take a cut of any real-money trading between players. Any RMT that occurs happens informally outside the platform and is not a supported feature. Do not build escrow-for-cash, currency-for-cash listings, or any integration toward that purpose. The Terms of Service should state that RMT is unsupported and done at the player's own risk.

## Testing
Integration tests for trade must cover: happy path, offer changed after confirm, item removed mid-trade, concurrent trades with the same item, inventory full on receipt.

## Status
Phase 4 shipped the system; the trade UI is hidden as of Phase 11 (T-11.05) and re-enabling is a Phase 14 backlog item. Server code stays intact.
