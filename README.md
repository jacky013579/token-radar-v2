[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jacky013579/token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jacky013579/token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar v2

A token launch radar: a program that reads the sealed DefiLlama snapshot of
14 Nov 2026 (758 protocols) and writes a dashboard ranking the protocols
that record no token yet by what their launch would be worth, each with a
concrete farm plan.

## The model

A log-space regression fitted on the snapshot's own tokenised protocols
(128 with a positive market cap and TVL, R² ≈ 0.20): `log(market cap)` on
`log(TVL)`, `log(age)` and `log(chains)`, plus a shrunk category offset (the
median residual of the protocol's category, shrunk by n / (n + 5)) and a
bounded momentum tilt from seven-day TVL growth (the protocol's growth
percentile inside the board, mapped to a factor inside [0.85, 1.15]).

Growth enters as a tilt rather than a fitted coefficient on purpose: the
snapshot's single seven-day window is a market-wide drawdown (median change
about −8%), and the raw fitted coefficient on that week is negative and
unstable — it would rank a protocol that lost 70% of its TVL in a week above
the field. The level still comes from the regression.

## Who is on the board

A protocol is eligible when the snapshot records no token for it at all
(`mcap_usd`, `gecko_id` and `symbol` all null) and it is not a wrapped,
staked or bridged product of a token that already trades — the watchlist's
own rule, without the $50M floor. That gives 198 protocols: the 40 on the
watchlist plus 158 smaller ones that pass the same test. Protocols whose
token already trades are set aside and used only to fit the model.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, builds the board, writes
  `board.json`, `data.js`, the dashboard, the screenshots and `dossier.json`.
- `lib/model.ts` — the model, the board, the farm plans and the gate checks.
- `vendor/makefun-board.ts` — the kit's dossier library, copied verbatim.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (no network).
- `screenshots/` — the board, a detail view and a filtered view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Two runs on the same snapshot write the same bytes: nothing here reads the
clock, the network or a random source.
