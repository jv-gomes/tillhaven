---
name: vip-stripe
description: Tillhaven's one-time VIP purchase — Stripe Checkout in payment mode, webhook-only fulfillment, idempotency, refunds/chargebacks, and the design constraints on what VIP benefits may be. Load when working on VIP, purchases, Stripe checkout, or webhook handling.
---

# VIP (One-Time Purchase)

## Payment model
- **Stripe Checkout** in **one-time payment mode** (`mode: 'payment'`). This is a single purchase, **not a subscription.** Do not use Stripe Billing, Prices with recurring intervals, or subscription webhooks.
- Once purchased, VIP is **30-day** on that account.

## Implementation requirements
- Create a Checkout Session server-side. Never construct payment data on the client.
- Handle fulfillment **exclusively via the `checkout.session.completed` webhook.** Do not grant VIP based on the browser redirecting to the success URL — that is trivially spoofable.
- **Verify the webhook signature** using the Stripe signing secret on every inbound webhook.
- Fulfillment must be **idempotent** — Stripe retries webhooks. Store the Stripe session/payment intent ID and ignore duplicates.
- Store a `purchases` record (player ID, Stripe payment intent ID, amount, currency, status, timestamp) for reconciliation and support.
- Handle refunds/chargebacks: on `charge.refunded` or `charge.dispute.created`, flag the account and revoke VIP.

## Pricing
The amount lives in the Stripe dashboard behind `STRIPE_VIP_PRICE_ID` and **must never be hardcoded in this repo**; the `purchases` row records what Stripe actually charged. The *multipliers* are set in `config/vip.ts` (`durationPercent: 80`) and are tunable, not blocking.

## VIP benefits — design constraints
Benefits must be **convenience and cosmetic**, never raw power or exclusive tradeable items. Reason: a player economy with informal RMT gets destroyed if paying players can mint tradeable value.

Acceptable:
- Faster crop growth / animal production (a modest multiplier)
- Additional inventory and chest slots
- Additional plot slots
- Exclusive **cosmetic** decorations and character options (non-tradeable)
- Quality-of-life: bulk harvest, auto-collect from animals

Not acceptable:
- Exclusive tradeable items or resources
- Direct gold grants
- Anything that lets a VIP account produce fundamentally different goods than a free account

## Testing
Integration tests for the Stripe webhook: valid signature, invalid signature, duplicate delivery, refund.

## Status
Phase 5 shipped VIP; the VIP UI is hidden as of Phase 11 and benefits/UI rework is a Phase 14 backlog item.
