# Economy ledger

Every gold faucet and every sink in Tillhaven, in one place.

> `CLAUDE.md` §5.6: *"An idle economy dies from unlogged faucets."*
>
> **Update this file in the same commit as any price change.** If a number here
> disagrees with `packages/shared/src/config/`, the config wins and this file is
> wrong — fix it.

Source of truth: `packages/shared/src/config/{economy,items,animals,level}.ts`.

Every figure below is **modelled from config**, not measured from play — there
is no play data yet. Measuring real sessions and retuning against them is
**T-6.01**; this file is the baseline it will be compared against.

## Where gold moves in the code

The complete list. Anything that writes `players.gold` must appear here, and
`docs.test.ts` fails the build if a file moves gold without being listed.

| File | Direction | What |
|---|---|---|
| `modules/auth/service.ts` | **+** | `STARTING_GOLD` on registration |
| `modules/shop/service.ts` | **−** | Buying an item at `shopBuyPrice` |
| `modules/shop/service.ts` | **+** | Selling an item at `shopSellPrice` |
| `modules/animals/service.ts` | **−** | Buying an animal at `purchasePrice` |
| `modules/farm/expansion.ts` | **−** | Unlocking a plot at `plotUnlockCost(index)` |
| `modules/farm/upgrades.ts` | **−** | `chargeGold`, the shared deduction both upgrade tracks go through |
| `modules/house/service.ts` | **−** | Buying furniture at its catalogue price |
| `modules/inventory/chest.ts` | — | Chooses the chest tier and its price; charges via `upgrades.ts` |
| `modules/shop/service.ts` | **−** | Buying the next backpack tier at `BACKPACK_TIERS[n].cost` (T-10.03) |
| `modules/shipping/service.ts` | **+** | Settling a shipment: `quantity × shopSellPrice`, credited on read (T-11.02) |
| `modules/farm/house.ts` | — | Chooses the house tier and its price; charges via `upgrades.ts` |

That is *all* of it today. **Every priced sink in the game is wired.**

## Faucets — where gold enters

| Source | Amount | Constant | Wired | Notes |
|---|---|---|---|---|
| New account | 500 | `STARTING_GOLD` | yes | Once per account. The only unconditional gold faucet. |
| Shipping box | `quantity × shopSellPrice` | `items.ts` | yes | The same price the merchant pays, `SHIPPING_PAYOUT_MS` (10 min) later. Not a second faucet — it is the sell price, moved in time — so it changes WHEN gold arrives, never how much (T-11.02) |
| Starter kit | wooden hoe, wooden watering can, 4× leek seeds, 2× potato seeds | `STARTING_ITEMS` | yes | An **item** faucet, not a gold one. The seeds are worth 180g of goods; the two tools are worth **nothing** — they cannot be bought, sold or traded (T-8.06), so they add no value to the economy, only the ability to farm at all. Exists so a new player can till, water and plant before finding the shop. |
| Selling leek | 35 each | `items.ts` | yes | |
| Selling potato | 90 each | `items.ts` | yes | |
| Selling strawberry | 95 each | `items.ts` | yes | |
| Selling onion | 110 each | `items.ts` | yes | |
| Selling eggs | 60 each | `items.ts` | yes | |
| Selling milk | 190 each | `items.ts` | yes | |

**Farm level grants no gold.** Levelling awards experience only
(`config/level.ts`), deliberately: experience is bought with time, and a
gold-paying level would make it buyable. See T-2.09.

**VIP grants no gold, ever** (§7). If a row for it appears here, something has
gone wrong.

## Sinks — where gold leaves

| Sink | Amount | Constant | Wired | Notes |
|---|---|---|---|---|
| Leek seeds | 20 | `items.ts` | yes | |
| Potato seeds | 50 | `items.ts` | yes | |
| Strawberry seeds | 100 | `items.ts` | yes | |
| Onion seeds | 160 | `items.ts` | yes | |
| Chicken feed | 15 | `items.ts` | yes | Recurring, per 24h per chicken |
| Hay | 40 | `items.ts` | yes | Recurring, per 24h per cow |
| Chicken | 400 | `animals.ts` | yes | |
| Cow | 2,000 | `animals.ts` | yes | |
| Plot expansion | `250·n²` | `plotUnlockCost` | yes | 253,750g to buy all 14 purchasable plots. Priced by the plot's place in the authored unlock order; any order may be bought |
| Chest tier 1/2/3 | 2k / 10k / 40k | `CHEST_TIERS` | yes | 52,000g for all three. Bought strictly in order — the endpoint takes no target tier |
| Backpack tier 1/2 | 2k / 10k | `BACKPACK_TIERS` | yes | 12,000g for both. 12 → 24 → 36 slots. Priced level with the chest's first two tiers on purpose: carry more or store more is meant to be a real choice (T-10.03) |
| Coop tier 1/2 | 4k / 20k | `COOP_TIERS` | yes | 24,000g for both. Chicken cap 4 → 8 → 12, live on the very next purchase. Bought strictly in order. Each tier draws a visibly bigger coop since T-12.02b |
| Barn tier 1/2 | 10k / 40k | `BARN_TIERS` | yes | 50,000g for both. Cow cap 2 → 4 → 6. Dearer per animal than the coop because a cow is worth five chickens at purchase. Per-tier art since T-12.02b |
| House tier 1/2 | 5k / 25k | `HOUSE_TIERS` | yes | 30,000g for both. Bought in order. **Buys nothing observable since T-12.02**: bag slots went to the backpack (T-10.03) and the animal cap to the coop and barn, and there is still one house look for every tier. Live endpoint, no shop row — see gap 3 below |
| Decorations | 180 – 2,500 each | `furniture.ts` | yes | 14 pieces, 11,580g for one of everything. Placing and removing are free — furniture is conserved, so redecorating costs nothing |
| VIP decorations | 800 / 1,200 | `furniture.ts` | yes | Included above. Cost gold like anything else; VIP is the gate, not the currency. **Never tradeable** (§7) |

Total lifetime sink: **433,330g** (359,330g before T-12.02 added the coop and
barn), almost all of it plot expansion — and all of it is live today. Furniture is the only sink you can spend on repeatedly without
limit, since nothing stops a player buying a tenth rug.

### Plot expansion is bounded by the map, not by a constant

`MAX_PLOTS` is **derived**: it is the number of plot markers in the authored
farm map, generated into `plots.generated.ts` by `pnpm plots`. Every plot must
stand on a cell someone painted soil under, so the map decides how much
expansion the economy can sell.

At the current map that is **20 plots** — 6 free, 14 purchasable. Marking more
cells raises both the cap and the total sink, so **re-check that 253,750g
whenever the map's plot count changes.**

`VIP_BENEFITS.bonusPlotSlots` (4) grants plots *on top of* `MAX_PLOTS`, and
those need authored positions too. T-3.03 **clamped**: `plotCapFor` caps at the
number of cells the map actually marks, so a VIP cannot buy a plot with nowhere
to stand. Nothing is broken today because VIP is not purchasable until Phase 5,
but **T-5.06 must author `bonusPlotSlots` more cells** and re-run `pnpm plots`,
or the bonus it advertises does nothing. A test in
`expansion.integration.test.ts` says so and starts failing when the map grows.

## Rates

### Crops, per plot per hour

Assumes a prompt harvest, which is a ceiling nobody actually hits — coming back
late is the whole premise of the game.

| Crop | Seed | Grows | Yield | Revenue | Profit | Profit/hr |
|---|---|---|---|---|---|---|
| Leek | 20 | 45 min | 1 | 35 | 15 | 20.0 |
| Potato | 50 | 2 hr | 1 | 90 | 40 | 20.0 |
| Strawberry | 100 | 4 hr | 2 | 190 | 90 | 22.5 |
| Onion | 160 | 8 hr | 3 | 330 | 170 | 21.3 |

Deliberately close together: the choice should be about how often you can check
in, not about one crop being correct. Leek suits a lunch break, onion overnight.

### Animals, per animal per hour

Net of feed. A feeding lasts 24h and covers a bounded number of cycles, so an
animal cannot bank more than `feedDuration / interval` while you are away.

| Animal | Cost | Produce | Gross/hr | Feed/hr | **Net/hr** | Payback | Per collection | Max/day |
|---|---|---|---|---|---|---|---|---|
| Chicken | 400 | 60g / 1.5h | 40.0 | 0.6 | **39.4** | 10.2h | 60g | 945g |
| Cow | 2,000 | 190g / 6h | 31.7 | 1.7 | **30.0** | 66.7h | 190g | 720g |

### Gold per hour, player to player

| Stage | Setup | Rate |
|---|---|---|
| New (6 plots, leek, prompt) | starting farm | ~120 g/h |
| New (6 plots, onion) | starting farm | ~128 g/h |
| Mature (20 plots, onion) | every plot bought | ~425 g/h |
| Mature (20 plots + 4 chickens) | coop at tier 0 | ~583 g/h |
| Mature (20 plots + 12 chickens) | coop at tier 2 (24,000g) | ~897 g/h |

Time to afford, at the new-player rate (~128 g/h):

| Milestone | Cost | Time |
|---|---|---|
| First chicken | 400 | 3h |
| First cow | 2,000 | 16h |
| Chest tier 1 | 2,000 | 16h |
| Backpack tier 1 | 2,000 | 16h |
| House tier 1 | 5,000 | 39h |
| 7th plot | 250 | 2h |
| 20th plot | 49,000 | 384h |

## Findings that need a decision

Recorded here rather than fixed quietly, because both are balance calls.

### 1. The cow is strictly dominated by the chicken

The cow costs **5× more** and earns **less**, at every check-in frequency:

- net 30.0 g/h against the chicken's 39.4
- payback 66.7h against 10.2h
- at one visit a day: 720g against 945g
- per animal-cap slot — the resource that is actually scarce — 30.0 against 39.4

Its only distinguishing feature is 190g per collection versus 60g, and that is
not an advantage when a single daily visit collects a whole feed window either
way. There is currently **no reason to ever buy a cow**, which makes the milk
half of the game dead content.

Fixing it is a balance decision for **T-6.01**, not a silent edit here. The
obvious levers are raising the milk price, shortening the cow's interval, or
dropping its purchase price toward the chicken's. Milk at ~300g would put the
two level per hour while keeping the cow the low-attention option.

### 2. Animals dwarf plot expansion as an investment

Six chickens cost 2,400g and return ~236 g/h forever. The fourteen purchasable
plots cost 253,750g and return ~298 g/h. Per gold invested that is **84×** in
the chickens' favour, and the chicken cap is the only thing stopping animals
from being the entire game.

T-12.02 split that one cap into two — 4 chickens and 2 cows at tier 0, rising
to 12 and 6 — and put both behind gold. That does not change the ratio; it
prices it. Filling the coop now costs 24,000g of building plus 4,800g of birds
for ~472 g/h, which is still an order of magnitude better than plots, so the
observation below stands. It does mean the cap is no longer a flat wall: it is
a sink, and one a player will hit long before they are buying plots.

That may be fine — the cap is doing exactly the job a cap is for — but it means
plot expansion is a prestige sink rather than an economic choice, and the late
game is "buy plots because there is nothing else to spend on". Worth confirming
that is the intent when T-3.03 wires plot buying up.

### 3. The house is now a sink that buys nothing

T-10.03 moved bag slots to the backpack; T-12.02 moved the animal cap to the
coop and barn. Between them they left `HOUSE_TIERS` with 30,000g of price and
no effect at all — and the art gap below means the tiers do not even look
different. It is now the **only** building of the three like that: T-12.02b
gave the coop and the barn a distinct look per tier, so a house that still
does not is now a lone exception rather than the way this game does buildings.
The endpoint and its tests are intact and the shop deliberately
does not list it. Either Phase 14 gives the house per-tier art (which would
make it an honest cosmetic sink, the same shape as a decoration) or
`HOUSE_TIERS` should be cut to tier 0.

### 4. Tier 2 of the house has no art of its own

This was true of the old pack's `house.png` (a bare-walled shell plus the same
house with a chimney, gable window, flower box and door — two looks for three
`HOUSE_TIERS`) and, after the T-7.07 asset migration, it is true again for a
different reason: the new pack's tiny-house kit turned out to hold no
complete pre-built house at all among its wall/roof/gable parts, only a row
of solid-colour silhouettes, of which `OBJ_TINY_HOUSE_LOOK` is the first (see
`assets.ts`). Every tier draws the same one. So, same conclusion either way:
**the 25,000g tier-2 upgrade buys capacity and no visible change.**

Either tier 2 needs art, or `HOUSE_TIERS` should stop at tier 1 and its
bonuses be folded in. A balance-and-art call for T-6.01 / T-6.07 / T-7.11.

### 5. Decoration is the only unbounded sink

Every other sink runs out: plots, tiers and animals all cap. Furniture does not
— a player can buy the same rug forever. That is deliberate (it gives late-game
gold somewhere to go) but it means **furniture prices are the lever that decides
whether gold inflates**, and they are currently set by feel rather than
measurement. T-6.01 should check whether a mature player's income makes them
trivial.

## Invariants

Asserted in `packages/shared/src/config/config.test.ts` (prices) and
`apps/server/src/modules/shop/shop.integration.test.ts` (the endpoints honouring
them). Both fail CI:

- **The shop never buys back at or above its own sale price.** Buy-then-sell
  must always lose gold, or round-tripping is a faucet.
- **Every crop's yield sells for more than its seed costs.** A crop that loses
  money is a trap, not a choice.
- **Plot costs grow superlinearly**, so expansion stays a real sink at any stage.
- **All prices are non-negative integers.** No floats for gold, ever (§10).

And in `docs.test.ts`:

- **Every file that writes `players.gold` is listed in this document.** This is
  the enforceable version of "no unlogged faucets" — a new gold path fails the
  build until it is written down here.

## Still to measure — T-6.01

Everything above is arithmetic on config. What real sessions still have to say:

- Whether players actually harvest promptly enough for the crop rates to hold
- Net gold in circulation over a week, and whether it inflates
- Whether the cow fix, once chosen, makes milk worth collecting
- Whether the opening hour needs the starter kit at all once onboarding exists
