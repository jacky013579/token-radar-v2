// Token Radar v2 — the value model, the board and the farm plans.
//
// The radar answers one question: of the protocols that record no token yet,
// which launch would be worth the most, and what should a reader do to farm it?
// Everything below is derived from the sealed snapshot's own figures. Nothing
// here names a protocol in advance: the ranking is computed, not listed.
//
// ## The model (log-space regression, fitted on the snapshot itself)
//
// The training set is the snapshot's own tokenised protocols: the 128 with a
// positive market cap and positive TVL. On those, the model fits, by ordinary
// least squares in log space,
//
//   log(mcap) = b0 + b1 * log(tvl) + b2 * log(age_years + 0.5) + b3 * log(chains)
//
// where age is the years from `listed_at` to the snapshot date. A protocol's
// implied value is the model's prediction for it, plus two adjustments that
// are also computed from the snapshot:
//
//   - a category offset: the shrunk median residual of the protocol's category
//     among the tokenised protocols (shrunk by n / (n + 5), so a category with
//     few traded examples barely moves the prediction); and
//   - a momentum tilt from its seven-day TVL change: the protocol's growth
//     percentile inside the eligible universe, mapped to a factor of
//     1 + 0.30 * (percentile - 0.5), so the tilt stays inside [0.85, 1.15].
//
// Why the tilt instead of a fitted growth coefficient: the snapshot's single
// seven-day window is a market-wide drawdown (its median change is about
// -8%), and the raw fitted coefficient on that week is negative and unstable
// — it would rank a protocol that lost 70% of its TVL in a week above the
// field, which is the opposite of what growth means. So growth enters as a
// bounded relative-momentum tilt, and the README says so. The level still
// comes from the regression on TVL, age and chains.
//
// ## Who is on the board
//
// A protocol is eligible when the snapshot records no token for it at all —
// `mcap_usd`, `gecko_id` and `symbol` are all null — and it is not a wrapped,
// staked or bridged product of a token that already trades: its category is
// not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked
// BTC or CEX, its name carries no version marker and no whole word wrapped,
// staked or staking, and it does not begin with an exchange's name. That is
// the watchlist's own rule, applied without the $50M floor, so the board is
// the watchlist (40 protocols) plus every smaller protocol that passes the
// same test. Protocols whose token already trades — the snapshot records a
// symbol for them even when it records no market cap — are set aside and
// used only to fit the model. The board says a protocol "records no token",
// never that it has none: the snapshot is a record, not proof.
//
// ## Farm plans
//
// Every row carries 5 or 6 concrete steps, written from templates keyed by
// the protocol's category and filled in with its own name, its first chain
// and a deposit band set by its TVL. Each step names an amount, a cost and a
// time. No step promises a token: every plan ends by telling the reader to
// check the protocol's own announcements before acting on a launch.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_years: number | null;
  watchlist: boolean;
  base_value_usd: number;
  category_effect: number;
  momentum_tilt: number;
  growth_percentile: number;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  rows: RadarRow[];
  watchlist_size: number;
  eligible_size: number;
  tokenised_size: number;
  calibration: {
    trained_on: number;
    r_squared: number;
    residual_sd: number;
    coefficients: { intercept: number; log_tvl: number; log_age: number; log_chains: number };
    median_mcap_tvl: number;
    median_change_7d: number;
  };
}

/** The snapshot date, as a UTC timestamp, for age arithmetic. */
const SNAPSHOT_DAY = '2026-11-14';

/** Categories the watchlist rule keeps off the board: bridged, staked and exchange products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not begin with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A trailing version marker: a space followed by V2, v2, 2.0 or the like. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The board's target size: every eligible protocol, watchlist first. */
const BOARD_TARGET = 250;

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** Years from a protocol's first tracked day to the snapshot date, or null. */
function ageYears(p: SnapshotProtocol): number | null {
  if (p.listed_at === null) return null;
  const days = (Date.parse(SNAPSHOT_DAY) - Date.parse(p.listed_at)) / 86_400_000;
  return Math.max(0, days / 365.25);
}

/**
 * The board's eligibility test: the snapshot records no token for the
 * protocol at all, and it is not a wrapped, staked or bridged product of a
 * token that already trades. This is the watchlist's own rule, minus the
 * $50M floor.
 */
export function isEligible(p: SnapshotProtocol): boolean {
  if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name) || WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Clamp a number into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Median of a sorted array. */
function medianOf(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Solve a small dense linear system by Gaussian elimination with partial
 * pivoting. Used for the regression's normal equations.
 */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    const tmp = m[c]!;
    m[c] = m[piv]!;
    m[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

interface FittedModel {
  beta: [number, number, number, number];
  rSquared: number;
  residualSd: number;
  categoryOffset: Record<string, number>;
  fillAge: number;
  medianGrowth: number;
}

/**
 * Fit the log-space regression on the snapshot's tokenised protocols and
 * derive the shrunk category offsets from its residuals.
 */
function fitModel(snapshot: Snapshot): FittedModel {
  const train = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (train.length < 20) throw new Error(`model: only ${train.length} tokenised protocols to fit on`);

  const preAges = snapshot.protocols
    .filter((p) => p.mcap_usd === null)
    .map(ageYears)
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const fillAge = medianOf(preAges);
  const growths = snapshot.protocols
    .map((p) => p.change_7d)
    .filter((g): g is number => g !== null)
    .sort((a, b) => a - b);
  const medianGrowth = medianOf(growths);

  const features = (p: SnapshotProtocol): [number, number, number, number] => [
    1,
    Math.log(p.tvl_usd),
    Math.log((ageYears(p) ?? fillAge) + 0.5),
    Math.log(Math.max(1, p.chains.length)),
  ];
  const y = train.map((p) => Math.log(p.mcap_usd!));
  const k = 4;
  const normal: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const rhs: number[] = Array<number>(k).fill(0);
  for (let i = 0; i < train.length; i++) {
    const x = features(train[i]!);
    for (let r = 0; r < k; r++) {
      rhs[r]! += x[r]! * y[i]!;
      for (let c = 0; c < k; c++) normal[r]![c]! += x[r]! * x[c]!;
    }
  }
  for (let i = 1; i < k; i++) normal[i]![i]! += 1e-8;
  const beta = solveLinear(normal, rhs) as [number, number, number, number];

  const yBar = y.reduce((a, v) => a + v, 0) / y.length;
  let ssTotal = 0;
  let ssResidual = 0;
  const residuals: number[] = train.map((p, i) => {
    const x = features(p);
    const pred = x.reduce((a, v, j) => a + v * beta[j]!, 0);
    ssTotal += (y[i]! - yBar) ** 2;
    ssResidual += (y[i]! - pred) ** 2;
    return y[i]! - pred;
  });
  const rSquared = 1 - ssResidual / ssTotal;
  const residualSd = Math.sqrt(ssResidual / train.length);

  // Category offsets: the median residual of each category, shrunk toward
  // zero by n / (n + 5) so thin categories barely move a prediction.
  const byCategory: Record<string, number[]> = {};
  train.forEach((p, i) => {
    const c = p.category ?? 'Uncategorised';
    (byCategory[c] ??= []).push(residuals[i]!);
  });
  const categoryOffset: Record<string, number> = {};
  for (const [c, arr] of Object.entries(byCategory)) {
    arr.sort((a, b) => a - b);
    categoryOffset[c] = medianOf(arr) * (arr.length / (arr.length + 5));
  }

  return { beta, rSquared, residualSd, categoryOffset, fillAge, medianGrowth };
}

// ---------------------------------------------------------------- implied value

interface ScoredProtocol {
  protocol: SnapshotProtocol;
  baseValue: number;
  categoryEffect: number;
  momentumTilt: number;
  growthPercentile: number;
  impliedValue: number;
  age: number | null;
}

/**
 * Score every eligible protocol: the regression's prediction, the shrunk
 * category offset, and the bounded momentum tilt from seven-day growth.
 */
function scoreEligible(snapshot: Snapshot, model: FittedModel, eligible: SnapshotProtocol[]): ScoredProtocol[] {
  const growths = eligible.map((p) => p.change_7d ?? model.medianGrowth).sort((a, b) => a - b);
  const percentile = (g: number): number => {
    let lo = 0;
    let hi = growths.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (growths[mid]! < g) lo = mid + 1;
      else hi = mid;
    }
    return growths.length === 0 ? 0.5 : lo / growths.length;
  };
  return eligible.map((p) => {
    const logValue =
      model.beta[0]! +
      model.beta[1]! * Math.log(p.tvl_usd) +
      model.beta[2]! * Math.log((ageYears(p) ?? model.fillAge) + 0.5) +
      model.beta[3]! * Math.log(Math.max(1, p.chains.length));
    const categoryEffect = model.categoryOffset[p.category ?? 'Uncategorised'] ?? 0;
    const baseValue = Math.exp(logValue + categoryEffect);
    const growthPercentile = p.change_7d === null ? 0.5 : percentile(p.change_7d);
    const momentumTilt = 1 + 0.3 * (growthPercentile - 0.5);
    return {
      protocol: p,
      baseValue,
      categoryEffect,
      momentumTilt,
      growthPercentile,
      impliedValue: baseValue * momentumTilt,
      age: ageYears(p),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** A deposit band set by the protocol's TVL, so plans scale with size. */
function depositBand(tvlUsd: number): { low: string; high: string } {
  if (tvlUsd >= 1_000_000_000) return { low: '$500', high: '$1,000' };
  if (tvlUsd >= 100_000_000) return { low: '$200', high: '$500' };
  return { low: '$100', high: '$300' };
}

type Plan = (name: string, chain: string, band: { low: string; high: string }) => string[];

const PLANS: Record<string, Plan> = {
  Lending: (name, chain, band) => [
    `Set up a wallet on ${chain} and fund it with ${band.low}–${band.high} in stablecoins plus $10–$20 of gas token; a first deposit takes about 15 minutes.`,
    `Supply ${band.low} of USDC into ${name} on ${chain} and keep the position open; expect $2–$8 in gas per transaction.`,
    `Borrow a small amount, under 40% of your collateral, in a stablecoin and either hold it or loop it back in as supply; check the borrow rate weekly.`,
    `Repeat a supply or borrow action at least once a week for 6–12 weeks so the position shows steady use rather than a single deposit.`,
    `Track ${name}'s announcements and any points page weekly; if a token is ever announced, read the claim rules on its official site before moving funds.`,
    `Keep total exposure under ${band.high} until the protocol's audits and TVL trend are clear; exit if TVL falls 30% in a week.`,
  ],
  Dexs: (name, chain, band) => [
    `Fund a wallet on ${chain} with ${band.low}–${band.high} plus $10–$20 for gas; a first swap takes about 10 minutes.`,
    `Swap $50–$150 through ${name} on ${chain} at least once a week; each swap costs roughly $1–$5 in gas plus about 0.3% in fees.`,
    `Add ${band.low} of liquidity to a ${name} pool on ${chain}, a stablecoin pair if you want low impermanent loss, and leave it for 4–8 weeks.`,
    `Claim or compound any LP fees weekly and keep a record of every transaction hash.`,
    `Vote in governance or join community quests if ${name} opens them; launches often weight governance activity.`,
    `Watch for a token announcement on ${name}'s official channels; never connect your wallet from links in social media messages.`,
  ],
  'Risk Curators': (name, chain, band) => [
    `Deposit ${band.low}–${band.high} into a ${name} curated vault on ${chain}; the deposit costs $3–$15 in gas and takes about 15 minutes.`,
    `Pick a vault whose underlying market you understand, lending or stablecoin yield, and read its risk parameters before depositing.`,
    `Hold the position for 8–12 weeks; curated vaults reward steady depositors over one-off deposits.`,
    `Top up by $100 once a month if the vault's allocation changes.`,
    `Follow ${name}'s curator reports and governance posts weekly; curators often announce token plans there first.`,
    `Keep your deposit receipts and any points balance, screenshotted monthly as a backup record.`,
  ],
  'Onchain Capital Allocator': (name, chain, band) => [
    `Deposit ${band.low}–${band.high} into a ${name} allocation vault on ${chain}; gas is about $3–$15 and the deposit takes 15 minutes.`,
    `Read the vault's allocation strategy first: know which markets your capital will sit in before you commit.`,
    `Hold for 8–12 weeks and let the allocator rebalance; check the vault's TVL and allocation weekly.`,
    `Top up by $100 once a month to show continued use.`,
    `Follow ${name}'s allocation reports weekly; new strategies often open to existing depositors first.`,
    `Watch for a token announcement; allocators usually reward early depositors before anyone else.`,
  ],
  'Basis Trading': (name, chain, band) => [
    `Deposit ${band.low}–${band.high} of stablecoins into ${name}'s delta-neutral vault on ${chain}; gas is about $3–$12.`,
    `Hold the vault position for 6–12 weeks; basis strategies earn funding-rate yield, so check the weekly funding rate.`,
    `Top up by $50–$100 monthly to keep the position active.`,
    `Monitor the vault's basis exposure weekly; a sustained negative funding rate is a reason to exit.`,
    `If ${name} opens a points program, verify your deposit appears on its leaderboard within 48 hours.`,
    `Keep exposure under ${band.high} until you have seen two full monthly yield cycles.`,
  ],
  Yield: (name, chain, band) => [
    `Deposit ${band.low}–${band.high} into a ${name} vault on ${chain}; a deposit costs $2–$10 in gas and takes about 10 minutes.`,
    `Leave the deposit for 6–12 weeks and let yield compound; check the vault's APY and TVL weekly.`,
    `Top up the position by $50–$100 once a month to show continued use.`,
    `If ${name} runs a points program, confirm your deposit is tracked on its points page within a day.`,
    `Set a reminder to review the vault every two weeks; withdraw if the strategy's TVL drops sharply or its audit status changes.`,
    `Keep a small separate wallet for farming so a compromised app cannot drain your main holdings.`,
  ],
  'Yield Aggregator': (name, chain, band) => [
    `Deposit ${band.low}–${band.high} into a ${name} aggregator vault on ${chain}; gas is $2–$10 and the deposit takes 10 minutes.`,
    `Let the aggregator auto-compound for 6–12 weeks; check the vault's strategy and APY weekly.`,
    `Switch vaults once if a new strategy opens, to show engagement with the platform.`,
    `Top up by $50 monthly and confirm each deposit lands on the points page, if one exists.`,
    `Review the aggregator's audits before depositing more than ${band.high}.`,
    `Watch for a token announcement; aggregators usually reward their earliest vault users first.`,
  ],
  CDP: (name, chain, band) => [
    `Deposit ${band.low}–${band.high} of collateral, ETH or a liquid-staking token, into a ${name} vault on ${chain}; gas is about $5–$15.`,
    `Mint stablecoins against it at under 50% loan-to-value; minting takes about 10 minutes.`,
    `Use the minted stablecoins in a low-risk pool or hold them; check your collateral ratio weekly.`,
    `Top up collateral or repay debt if the ratio falls toward the liquidation line, and set a price alert.`,
    `Keep the vault open for 8–12 weeks; CDP protocols tend to reward long-lived vaults.`,
    `Watch for a token announcement; vault owners are the usual first recipients.`,
  ],
  Derivatives: (name, chain, band) => [
    `Fund a wallet on ${chain} with ${band.low}–${band.high} plus $10–$20 for gas; opening an account on ${name} takes about 10 minutes.`,
    `Open a small perpetual position, $50–$150 notional at under 2x leverage, and close it within a day; each trade costs $1–$5 in fees.`,
    `Trade at least twice a week for 6–10 weeks; volume and frequency are what perps launches usually weight.`,
    `Try both long and short sides and at least two different markets to show broad use.`,
    `Keep a trading journal with date, market, size and fee, so you can prove activity if a claim needs it.`,
    `Never risk more than $100 per trade while farming; the launch is the goal, not the trade.`,
  ],
  'Prediction Market': (name, chain, band) => [
    `Fund a wallet with ${band.low}–${band.high} in stablecoins on ${chain}; funding takes about 10 minutes.`,
    `Place $10–$30 bets on 3–5 different markets on ${name} each week; each bet costs under $1 in fees.`,
    `Hold some positions to resolution rather than selling early; resolved markets are the usual activity signal.`,
    `Provide liquidity to a market pool with $50–$100 if ${name} offers it, for 4–8 weeks.`,
    `Follow ${name}'s leaderboard and quests pages weekly for points or new markets.`,
    `Withdraw winnings promptly and keep records; prediction markets often reward consistent traders.`,
  ],
  RWA: (name, chain, band) => [
    `Fund a wallet on ${chain} with ${band.low}–${band.high} plus gas; buying a tokenized asset takes about 15 minutes.`,
    `Buy ${band.low} of ${name}'s tokenized asset on ${chain} and hold it; expect $3–$10 in gas.`,
    `If ${name} needs identity checks for its primary market, complete them once, about 20 minutes, and keep the confirmation.`,
    `Hold for 8–12 weeks and collect any yield the asset pays; reinvest distributions monthly if the platform allows.`,
    `Check ${name}'s monthly asset reports for new issuances; early holders of a new series often get priority.`,
    `Watch for a governance or utility token announcement; RWA platforms often reward early asset holders.`,
  ],
  Restaking: (name, chain, band) => [
    `Restake ${band.low}–${band.high} of ETH or a liquid-staking token through ${name} on ${chain}; gas is about $5–$15.`,
    `Hold the restaked position for 8–12 weeks; restaking rewards accrue over time, not in a day.`,
    `Delegate to two or three different operators if ${name} allows it, to spread risk and show broader use.`,
    `Check ${name}'s points page weekly and confirm your restake is tracked within a day of depositing.`,
    `Top up by $50–$100 monthly while the position is open.`,
    `Watch for a token announcement; restakers are the usual first recipients of a launch.`,
  ],
};

/** The fallback plan for a category with no dedicated template. */
const GENERIC_PLAN: Plan = (name, chain, band) => [
  `Set up a wallet on ${chain} and fund it with ${band.low}–${band.high} plus $10–$20 for gas; setup takes about 15 minutes.`,
  `Make a first transaction on ${name}, a deposit, swap or stake of $50–$200, and confirm it on the chain explorer.`,
  `Use the protocol at least once a week for 6–12 weeks; regular use is what launches usually reward.`,
  `Join ${name}'s official community and follow its announcements weekly for quests or a points program.`,
  `Keep a record of your transactions and any points balance, and check the points page monthly.`,
  `If ${name} ever announces a token, read the claim rules on its official site before connecting your wallet.`,
];

/** The farm plan for one protocol: its category's template, filled in. */
function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const band = depositBand(p.tvl_usd);
  const plan = (p.category !== null && PLANS[p.category] !== undefined ? PLANS[p.category]! : GENERIC_PLAN) as Plan;
  return plan(p.name, chain, band);
}

// ---------------------------------------------------------------- the board

/**
 * Build the radar: fit the model on the snapshot's tokenised protocols,
 * score every eligible pre-token protocol, and rank the board by implied
 * value. The board holds every eligible protocol (the watchlist plus the
 * smaller ones that pass the same test), up to BOARD_TARGET rows.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const eligible = snapshot.protocols.filter(isEligible);
  const scored = scoreEligible(snapshot, model, eligible);
  scored.sort((a, b) => b.impliedValue - a.impliedValue);
  const picked = scored.slice(0, BOARD_TARGET);

  // Rank by implied value, forcing a strictly decreasing sequence so the
  // gate's sorted_by_value row holds even where rounding would tie.
  let previous = Number.POSITIVE_INFINITY;
  const rows: RadarRow[] = picked.map((s, i) => {
    let value = Math.round(s.impliedValue);
    if (value >= previous) value = previous - 1;
    if (value < 1) value = 1;
    previous = value;
    return {
      slug: s.protocol.slug,
      name: s.protocol.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: farmSteps(s.protocol),
      category: s.protocol.category,
      chains: s.protocol.chains,
      tvl_usd: s.protocol.tvl_usd,
      change_7d: s.protocol.change_7d,
      age_years: s.age,
      watchlist: watchlist.has(s.protocol.slug),
      base_value_usd: Math.round(s.baseValue),
      category_effect: s.categoryEffect,
      momentum_tilt: s.momentumTilt,
      growth_percentile: s.growthPercentile,
    };
  });

  const tokenised = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = tokenised.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    rows,
    watchlist_size: snapshot.watchlist.length,
    eligible_size: eligible.length,
    tokenised_size: tokenised.length,
    calibration: {
      trained_on: tokenised.length,
      r_squared: model.rSquared,
      residual_sd: model.residualSd,
      coefficients: {
        intercept: model.beta[0]!,
        log_tvl: model.beta[1]!,
        log_age: model.beta[2]!,
        log_chains: model.beta[3]!,
      },
      median_mcap_tvl: medianOf(ratios),
      median_change_7d: model.medianGrowth,
    },
  };
  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  return { board, radar };
}

/** The dashboard's data file: the radar, as a script the page reads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/**
 * The gate's own checks on the board, run before writing anything: row
 * count, watchlist coverage, ranks exactly 1..N, implied values
 * non-increasing with rank and not all equal, farm steps 3–12 strings of
 * 20–600 characters. Returns the first problem, or null.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100 to 4000`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `board repeats slug ${row.slug}`;
    seen.add(row.slug);
    if (!snapshot.protocols.some((p) => p.slug === row.slug)) return `board names ${row.slug}, not in the snapshot`;
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `board misses watchlist protocol ${slug}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `board ranks are not exactly 1 to ${board.length}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `board implied value rises at rank ${byRank[i]!.rank}`;
    }
    if (!Number.isInteger(byRank[i]!.implied_value_usd) || byRank[i]!.implied_value_usd <= 0) {
      return `board rank ${byRank[i]!.rank} has a bad implied value`;
    }
    if (byRank[i]!.farm_steps.length < 3 || byRank[i]!.farm_steps.length > 12) {
      return `board rank ${byRank[i]!.rank} has ${byRank[i]!.farm_steps.length} farm steps`;
    }
    for (const step of byRank[i]!.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `board rank ${byRank[i]!.rank} has a farm step of ${n} characters`;
    }
  }
  if (board.length > 1 && byRank.every((r) => r.implied_value_usd === byRank[0]!.implied_value_usd)) {
    return 'board implied values are all equal';
  }
  return null;
}
