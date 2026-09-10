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
| `modules/decor/service.ts` | **−** | Buying farm decoration at its catalogue price (T-15.18) |
| `modules/progression/service.ts` | **+** | `grantReward` paying a claimed milestone (T-30.07). The single place milestone **and future quest** rewards move value — Phase 33 uses it unchanged rather than growing a second grant |

That is *all* of it today. **Every priced sink in the game is wired.**

## Faucets — where gold enters

| Source | Amount | Constant | Wired | Notes |
|---|---|---|---|---|
| New account | 500 | `STARTING_GOLD` | yes | Once per account. The only unconditional gold faucet. |
| Shipping box | `quantity × shopSellPrice` | `items.ts` | yes | The same price the merchant pays, `SHIPPING_PAYOUT_MS` (10 min) later. Not a second faucet — it is the sell price, moved in time — so it changes WHEN gold arrives, never how much (T-11.02) |
| Starter kit | wooden hoe, wooden watering can, 4× parsnip seeds, 2× leek seeds | `STARTING_ITEMS` | yes | An **item** faucet, not a gold one. The seeds are worth **64g** of goods (was 180g before T-31.05 — see the first-session section for why the reduction is deliberate); the two tools are worth **nothing** — they cannot be sold or traded, and the merchant does not stock them (T-8.06), so they add no value to the economy, only the ability to farm at all. Exists so a new player can till, water, plant **and harvest** before finding the shop. |
| Selling leek | 35 each | `items.ts` | yes | |
| Selling potato | 90 each | `items.ts` | yes | |
| Selling strawberry | 95 each | `items.ts` | yes | |
| Selling onion | 110 each | `items.ts` | yes | |
| Selling parsnip | 9 each | `items.ts` | yes | |
| Selling carrot | 21 each | `items.ts` | yes | |
| Selling rice | 22 each | `items.ts` | yes | |
| Selling asparagus | 58 each | `items.ts` | yes | |
| Selling broccoli | 142 each | `items.ts` | yes | |
| Selling cauliflower | 313 each | `items.ts` | yes | |
| Selling cabbage | 566 each | `items.ts` | yes | |
| Selling eggs | 60 each | `items.ts` | yes | |
| Selling milk | 190 each | `items.ts` | yes | |
| Selling wood | 5 each | `items.ts` | yes | Chopping (Phase 20). **Capped by regrowth, not by effort**: 5 trees × `WOOD_PER_TREE` (3) × three 8h cycles = 45 wood/day = **225g/day at absolute maximum**, and no amount of clicking raises it. Priced deliberately below every crop because wood's real job is to be a crafting input, and a material that sells well is a material nobody crafts with — revisit when there is something to build. `trees.test.ts` and `config.test.ts` assert both the daily cap and that it stays under one mature onion plot's day |
| Fishing | **32-71g per cast** | `config/fish.ts` | yes | T-34.01/T-34.04. Eighteen river fish, priced inside the crops' own 9-566g band because that is what a player chooses between. **Expected value per cast is 32g at farm level 1 rising to 71g at level 9** — above a single idle plot (14-57 g/hr) and well below a whole farm, which is the shape active play should have. Rarity and value move together and `fish.test.ts` refuses an inversion; the rarest fish is 1 in 198, inside a declared `RAREST_MIN_ODDS`/`RAREST_MAX_ODDS` band so it cannot drift into a lottery. **The per-cast rate is not yet a per-HOUR rate** — that needs a cast duration, which arrives with T-34.03, and T-34.09 is where fishing gets balanced against farming properly. Fish are sellable and tradeable, never buyable: a fish you can buy is a fish nobody needs to catch |
| Selling carp | 30 each | `config/fish.ts` | yes | |
| Selling chub | 26 each | `config/fish.ts` | yes | |
| Selling perch | 34 each | `config/fish.ts` | yes | |
| Selling sunfish | 28 each | `config/fish.ts` | yes | |
| Selling shad | 40 each | `config/fish.ts` | yes | |
| Selling bullhead_catfish | 75 each | `config/fish.ts` | yes | |
| Selling large_mouth_bass | 95 each | `config/fish.ts` | yes | |
| Selling walleye | 88 each | `config/fish.ts` | yes | |
| Selling pike | 110 each | `config/fish.ts` | yes | |
| Selling tiger_trout | 120 each | `config/fish.ts` | yes | |
| Selling sturgeon | 220 each | `config/fish.ts` | yes | |
| Selling dorado | 260 each | `config/fish.ts` | yes | |
| Selling ghost_catfish | 195 each | `config/fish.ts` | yes | |
| Selling bone_fish | 240 each | `config/fish.ts` | yes | |
| Selling zombie_fish | 380 each | `config/fish.ts` | yes | |
| Selling dynamite_fish | 340 each | `config/fish.ts` | yes | |
| Selling faeries_fish | 430 each | `config/fish.ts` | yes | |
| Selling golden_fish | 540 each | `config/fish.ts` | yes | |

| Milestone rewards | seeds and feed, plus **250g once** | `config/milestones.ts` | yes | **Fourteen** one-time goals — sixteen until the MVP re-scope, which removed `level_11` and `level_13` because the levels they celebrated no longer unlock anything (the crop table stops at cabbage, Lv 9). **Thirteen pay in goods, not gold** — D-18 found the first-session problem is a *wait*, and gold does not shorten a wait; seeds put more in the ground, which is what makes the next session sooner. The single gold payment is `level_5`, worth **250g once per account**, and it is there because level 5 is the trade gate (`TRADE_MIN_FARM_LEVEL`) — the milestone doubles as the only announcement a player gets that trading has opened. **A one-time faucet is still a faucet, so here is the whole of it, once per account** (recounted for the re-scope): **250g** in gold, and 9 leek + 5 potato + 3 asparagus + 2 strawberry + 2 cauliflower + 4 onion + 2 cabbage seeds and 13 chicken feed, which at the merchant's *buy* prices is **2,623g** of goods — a lifetime total of **2,873g** of purchasing power per account. **That is 2,374g down from T-31.07's 5,247g**, and the fall is entirely the removed crops: four rewards pointed at tomato, blackberry, aubergine and watermelon seeds costing 94-547g a packet, and they were re-pointed at spring crops that cost less. The board did not get stingier; the expensive things it paid in stopped existing. Every one of those items is still **unsellable** (`shopSellPrice: null`), so it is gold the player never has to *spend*, not gold they can extract, and nothing on the board is tradeable value they could not have bought (§6) |

**Farm level grants no gold.** Levelling awards experience only
(`config/level.ts`), deliberately: experience is bought with time, and a
gold-paying level would make it buyable. See T-2.09.

**VIP grants no gold, ever** (§7). If a row for it appears here, something has
gone wrong.

## Sinks — where gold leaves

| Sink | Amount | Constant | Wired | Notes |
|---|---|---|---|---|
| Wooden axe | 200 | `items.ts` | yes | The **only tool the merchant sells**, because it is the only tool registration does not hand out (T-20.05). One-off, unsellable, untradeable. Priced against what it unlocks rather than against the other tools: ~1 day of full chopping to break even, and it must cost more than the priciest seed packet — it opened at 150g and `config.test.ts` rejected it for undercutting onion seeds |
| Leek seeds | 20 | `items.ts` | yes | |
| Potato seeds | 50 | `items.ts` | yes | |
| Strawberry seeds | 100 | `items.ts` | yes | |
| Onion seeds | 160 | `items.ts` | yes | |
| Parsnip seeds | 6 | `items.ts` | yes | spring, 12m |
| Carrot seeds | 12 | `items.ts` | yes | spring, 30m |
| Rice seeds | 24 | `items.ts` | yes | spring, 1h |
| Asparagus seeds | 64 | `items.ts` | yes | spring, 2.5h |
| Broccoli seeds | 78 | `items.ts` | yes | spring, 3h |
| Cauliflower seeds | 172 | `items.ts` | yes | spring, 6h |
| Cabbage seeds | 311 | `items.ts` | yes | spring, 10h |
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
| Interior furniture | 180 – 2,500 each | `furniture.ts` | yes | 14 pieces, 11,580g for one of everything. Placing and removing are free — furniture is conserved, so redecorating costs nothing. **Unreachable in-game since T-11.05** unregistered the Interior scene; the sink is live but nothing can spend into it until T-16.12 re-registers the scene. T-16.08 re-measured all 14 against real art (they had been cropping an unrelated house exterior since T-7.07) and renamed three where the crop no longer matched the label — "Bunk Bed" → **Four-poster Bed**, `window`/"Window" → `mirror`/**Standing Mirror** (the pack has no window art at all), "Table" → **Round Table**. Prices are untouched, so the 11,580g total is unchanged |
| Farm decoration | 15 – 400 each | `decor.ts` | yes | 11 pieces, 1,210g for one of everything (T-15.18). Deliberately cheap next to the interior catalogue: this is the first cosmetic sink a new farm can actually reach, and it competes with seeds rather than with a barn. Conserved like furniture — picking a piece back up returns it to storage, so redecorating is free |
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

Every figure assumes a **prompt** harvest, which is a ceiling nobody actually
hits — coming back late is the whole premise of the game.

The rates are deliberately close together: the choice should be about how often
you can check in, not about one crop being correct. Leek suits a lunch break,
cabbage overnight. The full table is below; the four-crop summary that used to
sit here was a subset of it and is gone rather than left to drift out of step.

### Every crop, priced (re-scoped)

**Eleven crops, all spring.** The MVP re-scope cut the other nine — wheat,
beetroot, tomato, hot pepper, blackberry, aloe, aubergine, melon and watermelon
— along with the eighteen items they carried. The band tightens with them: the
range was 15-28 g/hr over twenty crops and is now **15-25.5 g/hr over eleven**,
still rising with how long you commit. The top of the range went with
watermelon; nothing was repriced.

**The invariant is about the visit, not the hour**, and the shipped table is
why. Onion (8h, 21.25 g/hr) earns less per hour than strawberry (4h, 22.50) and
is not a trap, because it is harvested once where strawberry is harvested twice
— and in an idle game a *visit* is the scarce resource. So the rule enforced by
`config.test.ts` is **a longer crop always pays more per harvest than every
shorter one**, which is what makes committing to ten hours a choice rather than
a penalty. Durations are all distinct, so that ordering is total.

Seed cost is 48-67% of gross revenue on every crop, also enforced (the rule is
30-70%) — a seed too cheap makes the crop free money, and one too dear makes it
a trap.

**Not all of it is on sale at once.** The merchant stocks five crops at farm
level 1 — parsnip, carrot, leek, rice, potato, which is 12 minutes to 2 hours —
and unlocks the rest in duration order up to cabbage at level 9 (it was level 13
before the re-scope; the top four unlock levels went with the crops that
occupied them). That is the first thing in the game farm level is *spent* on
rather than merely earned. The gate is on **buying only** — a milestone can hand
a level-1 player potato seeds, and produce is always sellable.

| Crop | Unlocks at | Grows in | Yield | Seed | Sells for | Profit / harvest | g/hr | Seed as % of gross |
|---|---|---|---|---|---|---|---|---|
| Parsnip | start | 12m | 1 | 6 | 9 each | 3 | 15.00 | 67% |
| Carrot | start | 30m | 1 | 12 | 21 each | 9 | 18.00 | 57% |
| Leek | start | 45m | 1 | 20 | 35 each | 15 | 20.00 | 57% |
| Rice | start | 1h | 2 | 24 | 22 each | 20 | 20.00 | 55% |
| Potato | start | 2h | 1 | 50 | 90 each | 40 | 20.00 | 56% |
| Asparagus | Lv 2 | 2.5h | 2 | 64 | 58 each | 52 | 20.80 | 55% |
| Broccoli | Lv 2 | 3h | 1 | 78 | 142 each | 64 | 21.33 | 55% |
| Strawberry | Lv 3 | 4h | 2 | 100 | 95 each | 90 | 22.50 | 53% |
| Cauliflower | Lv 5 | 6h | 1 | 172 | 313 each | 141 | 23.50 | 55% |
| Onion | Lv 7 | 8h | 3 | 160 | 110 each | 170 | 21.25 | 48% |
| Cabbage | Lv 9 | 10h | 1 | 311 | 566 each | 255 | 25.50 | 55% |

Every crop is spring, so the season column is gone — a column with one value in
every row is decoration. `season.ts` still carries all four seasons in the type
with three of them empty, which is the shape the game grows back into rather
than a table that has to be rebuilt.

**These are modelled from config, not measured from play**, like everything
else here.

### Energy, and what it actually constrains (MVP re-scope)

Energy is the first hard limit on **action** the game has had. Until the
re-scope, the only thing between a player and more farming was a growth timer:
you could till, plant and water every plot you owned the moment you owned it,
and the wait was for the crop rather than for you.

**Supply and demand, both per hour.** The cap is 40 at level 1, rising 10 every
ten levels to 60 at the level cap. Sleeping restores the whole bar in ten real
minutes and **there is no cooldown on sleeping**, so the supply is:

| Level | Cap | Bars per real hour | Energy per hour |
|---|---|---|---|
| 1-10 | 40 | 6 | **240** |
| 11-20 | 50 | 6 | 300 |
| 21-30 | 60 | 6 | 360 |

Demand is one plant (2) + one water per four hours of growth (2 each, from
`WATER_DURATION_MS`) + one harvest (1), per plot per crop cycle. Tilling is
paid once, since harvesting leaves the soil tilled:

| Crop | Energy per cycle | Per plot per hour | 6 plots | 20 plots |
|---|---|---|---|---|
| Parsnip (12m) | 5 | 25.00 | 150 | **500** |
| Leek (45m) | 5 | 6.67 | 40 | 133 |
| Potato (2h) | 5 | 2.50 | 15 | 50 |
| Strawberry (4h) | 5 | 1.25 | 7.5 | 25 |
| Cabbage (10h) | 9 | 0.90 | 5.4 | 18 |

**The finding: energy binds the opening and then dissolves.** Against a supply
of 240/hr, a full twenty-plot farm of anything slower than parsnip demands
18-133/hr — comfortably affordable. Only parsnip on many plots exceeds the
supply, and only because a twelve-minute crop is farmed five times an hour.
That is not a bug, and it is not a number to quietly change: the brief asked for
*"at the start the player cannot do very much"* and for sleeping to be the only
recovery at ten minutes a bar, and this is exactly what those two decisions
produce together. **The cap is on burst, not on daily throughput.**

Where it does bind is the number the base cap was chosen against:

| The opening | Energy |
|---|---|
| Till six starting plots | 12 |
| Plant and water all six | 24 |
| **Total** | **36 of 40** |

Four points left — not enough to till a seventh plot if one were unlocked, and
not enough to re-water before sleeping. A new player can work their whole farm
exactly once, which is the brief's sentence expressed as a number.

**If it should bind harder later, the lever is `SLEEP_DURATION_MS`, not the
cap.** Doubling the cap doubles the burst and changes the sustainable rate not
at all; doubling the sleep halves the supply per hour across every level at
once. Recorded here because the intuitive knob is the wrong one.

**Idle mode spends energy too**, by decision — the offline simulator stops with
`out_of_energy` and does not resume until the player sleeps. A player who leaves
for a day comes back to a farm that stopped when the bar ran out, which is the
intended consequence and the one most worth watching in a playtest.

### The trade gate, re-measured (MVP re-scope)

`TRADE_MIN_FARM_LEVEL` is **5**, which is **494 XP** (`FARM_LEVEL_XP[4]`), and
`TRADE_MIN_ACCOUNT_AGE_MS` is **24 hours**. Both are checked for both parties,
at invite time and again at execution. This is not a balance number: it is what
makes throwaway-account scamming expensive to run at scale, so a re-scope that
adds an action limit owes a re-measurement rather than an assumption.

**The headline: energy does not move the gate, and neither did cutting nine
crops.** `xpForDuration` awards `floor(ms / XP_PER_UNIT_MS)`, so experience is
paid for **time**, never for the crop — every crop in the game pays exactly
**12 XP/hr per plot**, and so does every animal:

| Source | Interval | XP per collection | XP/hr |
|---|---|---|---|
| Every crop except parsnip | 30m – 10h | 6 – 120 | **12.00** |
| Parsnip | 12m | 2 | **10.00** |
| Chicken | 1.5h | 18 | **12.00** |
| Cow | 6h | 72 | **12.00** |

Parsnip is the only exception and it errs the *safe* way: 12 minutes is not a
whole multiple of the 5-minute unit, so `floor` pays 2 XP where 2.4 was earned.
`level.test.ts` enforces the asymmetry — a hard ceiling at 12 XP/hr and a loose
floor — precisely because rounding down costs a player a fraction while rounding
up mints eligible alts.

So the XP cost of the gate is a function of **cultivated slots**, not of the
crop table:

| Farm | XP/hr | Full cultivation to level 5 |
|---|---|---|
| 6 starting plots | 72 | **6.9 h** |
| 6 plots + a starting coop of 4 chickens | 120 | 4.1 h |
| 10 plots | 120 | 4.1 h |
| All 20 plots | 240 | 2.1 h |

**Why energy leaves this untouched.** The gate's cost is elapsed time with the
plots full, and keeping six plots full of anything from leek upward costs 5-40
energy an hour against a supply of 240. An attacker sustaining a level-5 climb
is nowhere near the cap. Energy would have to bind the *sustained* rate to
strengthen the gate, and per the section above it binds the burst.

**The one case where an attacker meets the bar at all** is parsnip
micro-farming: five cycles an hour on six plots is 150 energy/hr, or 62% of the
level-1 supply. They still make it — 150 is under 240. It would take **ten plots
of parsnip** (250/hr) to outrun a level-1 bar, and a level-1 account has six.
So the fastest grind in the game is the only one energy is even visible in, and
it is not slowed.

**The conclusion is unchanged: the 24-hour account age is the binding
constraint, not the experience.** Even at 20 plots the XP is 2.1 hours of work,
and no amount of gold or energy shortens 24 hours. The gate costs an attacker
**~8 human-hours of active attention per account** (T-31.08 measured 8.2 h with
parsnip as the starter; the re-scope did not touch parsnip, the XP formula or
the level table, so the figure stands).

**What would change it, and what would not.** Fewer crops: no. Higher prices:
no — gold buys no XP anywhere. Energy: no, per above. More *plots* or more
*animals*: yes, linearly, which is why `VIP_BENEFITS.bonusPlotSlots` and any
future cap increase are XP changes as well as convenience ones. A shorter
`SLEEP_DURATION_MS`: no, in the direction that matters — more energy cannot make
a crop grow faster. A new XP source that is not gated on elapsed time: yes, and
it would be the first thing in the game to break the rule the whole control
rests on.

### The trade gate, re-measured after quests (T-33.08)

Phase 33 added quests — the first system in the game that **pays a player for an
action rather than for a wait**. The section above named exactly that as the one
thing that would break the control, so this is a security re-measurement rather
than a tuning note.

**Quests pay no experience. Verified, and now pinned by a test.**
`turnInQuest` calls `grantXp(…, 0)` — a read dressed as a grant so every paying
action returns the same `{ experience, farmLevel }` shape — and
`modules/quests/routes.integration.test.ts` asserts a turn-in leaves
`players.experience` untouched, for an authored quest and a rotating request.
Break-tested by making a quest pay 50 XP: both assertions fail. Without that
test the property survives only as an argument, and a future task that decides
quests ought to pay XP would not be *wrong* on its own terms — it would just be
reopening a security decision without knowing it.

**The indirect path is gold → plots → XP per hour, and it was measured rather
than dismissed.** In 24 hours a level-1 account can take every authored quest
(**2,998g**, of which **1,000g** is net of what the goods would have sold for)
and four rotations of three requests (**4,447g**, net **1,384g**) — a net
**2,384g** that Phase 33 added and nothing else would have paid. Against
`plotUnlockCost` (250, 1000, 2250, 4000 for plots 7-10) that funds **two extra
plots**, with 1,134g left over and the third plot 1,116g out of reach.

**Two extra plots move the elapsed time and not the gate:**

| Starter crop | Harvests to 494 XP | Elapsed at 6 plots | Elapsed at 8 plots |
|---|---|---|---|
| Parsnip (12 min) | 247 | 8.2 h | 6.2 h |
| Leek (45 min) | 55 | 6.9 h | 5.2 h |
| Cauliflower (6 h) | 7 | 7.0 h | 5.3 h |

**The number that matters is the middle column, and it does not change.**
`xpForHarvest` pays per crop, so reaching 494 XP costs the same number of
harvest ACTIONS whichever way the farm is shaped — 247 parsnip harvests at six
plots, 247 at eight. Plots buy parallelism, not fewer actions. So Phase 33 moves
the *elapsed* time from 8.2 h to 6.2 h and leaves the attacker's **~8 human-hours
of active attention** where T-31.08 measured it. Both figures remain far under
the 24-hour account age, which is still the binding constraint.

**Recommendation: no change to `TRADE_MIN_FARM_LEVEL`.** It stays at 5. The gate
did not get cheaper in the currency it is denominated in — attention and wall
clock — and raising it would cost every legitimate new player real time to
defend against a saving the attacker did not make.

**What to re-measure next time.** The rotating board is the new thing worth
watching: it is capped at three requests per six hours today, and both that cap
and `DAILY_REQUEST_MARGIN` are levers that scale the net gold above linearly. A
phase that raises either owes this measurement again. So does anything that
lowers `plotUnlockCost`, because the whole indirect path runs through it.

### The first session, minute by minute (T-18.18)

What a brand-new account actually has, from `STARTING_GOLD`, `STARTING_ITEMS`,
`STARTING_PLOTS` and `newFarmPlots()`. Modelled from config like everything else
here, and worth writing down because the QA audit's F-1 described a starting
state the code does not produce.

**Re-scoped: energy is now the binding constraint on the opening**, where it
used to be the growth timer alone. The gold and the seeds are unchanged; what
changed is that the player runs out of *actions* before they run out of things
worth doing, and the column tracking that is the point of the table.

| Time | Energy | State |
|---|---|---|
| 0:00 | **40 / 40** | 500g, 6 unlocked plots, **all empty and untilled**, hoe + can + **4 parsnip seeds** + 2 leek seeds. **The goal board is open** (T-30.09) naming the next three: till one plot, till all six, harvest once |
| ~0:01 | 38 | First plot tilled (−2) → `break_ground` claimable → **+2 leek seeds** |
| ~0:03 | **4 / 40** | Six plots tilled (−10 more), planted (−12) and watered (−12) → `six_beds` claimable → **+3 leek seeds**. The starting seeds exactly fill the plots. **Four points left: the farm is worked and the farmer is spent** |
| 0:03–0:13 | 4 → **40** | **The first thing a new player does is go to bed.** Ten minutes in the house, which is also the twelve-minute parsnip wait — the two timers were sized against each other, so the rest is free rather than an interruption |
| 0:15 | 36 | **4 parsnips → 36g** (−4 to harvest). The loop closes inside the first sitting: tilled, planted, watered, slept, harvested. `first_yield` → **+2 potato seeds**, and the four freed plots take four of the five spare leek seeds (−8 plant, −8 water) → **20** |
| 0:45 | 18 | 2 leeks → 70g (−2). Total 606g |
| 1:00 | 14 | The 4 leeks planted at 0:15 → 140g (−4). Total 746g, enough for a 400g chicken with change — which is also `first_livestock`, **+5 chicken feed** |

**The first hour costs 26 of a 40-point bar and one sleep**, and the sleep lands
inside a wait the player already had. That is the shape the numbers were chosen
for: energy is felt at 0:03 as *"I have done everything I can do"* rather than at
0:20 as *"I cannot do the thing I came here for"*. A new player who tries to
till a seventh plot at 0:03 is refused — but there is no seventh plot at level 1,
so the refusal they actually meet is trying to re-water, which the ten minutes
in bed makes unnecessary anyway (`WATER_DURATION_MS` is four hours).

**Two corrections to F-1.** New farms are *not* pre-planted — `newFarmPlots()`
creates every plot empty and untilled, so the "three already have crops" in the
audit was the auditor's own play state. And a new player holds **500g**, not
100g; 100g is what remains *after* choosing to buy a chicken, which is a choice
available at minute zero and better taken at 0:45.

**The 42-minute hole is now a 12-minute one, and D-18 is decided** (T-31.05).
D-18 costed three fixes: (a) a fast starter crop, (b) a mature starting hen,
(c) a first-harvest milestone reward — and recommended (a) or nothing, because
(b) and (c) both add gold to a problem that is not about gold. Phase 31 took
(a). Parsnip ripens in **12 minutes**, so the first thing a new player plants
finishes while they are still there, and the loop the whole game is made of is
completed once before anyone decides whether to come back.

**The floor is about five minutes, and it is a security floor rather than a
design one.** `xpForDuration` awards `max(1, floor(ms / XP_PER_UNIT_MS))`, so a
crop shorter than five minutes still pays a whole experience point and would
beat every other crop on XP per hour — and XP is the anti-alt control behind
`TRADE_MIN_FARM_LEVEL` (`config/level.ts`). `level.test.ts` refuses any crop
under `XP_PER_UNIT_MS`. **The hole can be made small; it cannot be made zero.**

**The opening is deliberately a little poorer in gold**, which is the trade
D-18's own diagnosis asks for. The kit's goods value falls from 180g to 64g
(parsnip seed is 6g against potato's 50g), and the one-hour position is 746g
where the old kit reached 820g at the two-hour mark. What was bought with that
is a completed harvest at 0:15 instead of an empty field until 0:45. The
constraint on the opening is **plots and time, not gold** — 500 starting gold
already buys eighty-three parsnip seeds and there are six plots to put them in.

**Potato left the kit and still arrives in the first session**, as the
`first_yield` milestone reward for completing that first harvest — a reward for
finishing the loop rather than a two-hour plot a new player cannot check on.

**What the goal board changed, and what it did not** (T-30.09/T-30.10). The
hole is still 42 minutes long: no milestone shortens a growth timer, and none
of them was ever supposed to. What changed is that the wait is now *named* —
at 0:03 the player has a list of four things they are working toward instead of
a field and no information. Two second-order effects are worth recording
because they are the kind of thing that goes unnoticed until it is a balance
problem:

- **The early seeds arrive with nowhere to plant them.** `break_ground` and
  `six_beds` pay 5 leek seeds by 0:03, and the starting seeds already fill all
  six plots exactly. So the reward's real effect lands at 0:45, when the first
  plot frees up — or immediately, if the player spends 250g on the 7th plot,
  which the board has just given them a reason to do. That is a *better*
  outcome than the seeds being instantly consumable, and it is an accident of
  the numbers rather than a design; if `STARTING_PLOTS` ever grows, re-check it.
- **It shortens the trade gate slightly**, which is a security change and not a
  balance one (`config/level.ts`: XP exists primarily as the anti-alt control
  behind `TRADE_MIN_FARM_LEVEL`). The board grants **no experience at all** —
  `claimMilestone` calls `grantXp(tx, id, 0)` purely to read the current total —
  so the effect is indirect: 1,305g of free seeds is more crops planted, and
  more crops harvested is more XP. It does not change what level 5 costs in
  *time*, and the 24-hour account age is untouched, so throwaway-account
  scamming is no cheaper to run at scale.

### Animals, per animal per hour

Net of feed. A feeding lasts 24h and covers a bounded number of cycles, so an
animal cannot bank more than `feedDuration / interval` while you are away.

| Animal | Cost | Produce | Gross/hr | Feed/hr | **Net/hr** | Payback | Per collection | Max/day |
|---|---|---|---|---|---|---|---|---|
| Chicken | 400 | 60g / 1.5h | 40.0 | 0.6 | **39.4** | 10.2h | 60g | 945g |
| Cow | 2,000 | 190g / 6h | 31.7 | 1.7 | **30.0** | 66.7h | 190g | 720g |

### Gold per hour, player to player

Unchanged by the re-scope, and checked rather than assumed: the removed crops
were all summer and fall, so no row here referred to one, and every rate below
is still the crop it names. **Energy does not appear** — per the energy section,
keeping twenty plots of onion fed costs about 18 energy an hour against a supply
of 240, so it never binds a mature farm's earnings.

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

And in `config/energy.test.ts` (MVP re-scope):

- **A new farmer can work every starting plot exactly once**, and not twice.
  Both directions, because the first is the brief's *"cannot do very much"* and
  the second is the limit having any meaning.
- **Finishing work never costs more than starting it** — harvesting and
  collecting are cheaper than tilling, planting and watering, so a player is
  never refused the reward for farming they already did.
- **The cap does not grow into irrelevance**: at the level cap it is still
  within 2x of level 1. What makes a big farm big is plots, not stamina.

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
- **Whether energy is felt at all after the first session.** The model above
  says it binds the opening and then dissolves, because sleep is unlimited at
  ten minutes a bar. Whether that reads as *"a gentle opening"* or as *"a
  mechanic that stopped mattering"* is a question for a playtest, not for
  arithmetic. If it needs to bind harder, the lever is `SLEEP_DURATION_MS`.
- **Whether idle mode stopping at `out_of_energy` is the right feel.** A player
  who leaves overnight comes back to a farm that stopped when the bar ran out.
  That is the decision as taken; it is also the single most likely thing in this
  re-scope to be wrong.
