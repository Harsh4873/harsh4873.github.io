# Profit Desk

## Decision

Profit Desk replaces the old Best Bets heuristic with a price-first decision
workflow. It does not ask which pick is most likely to win. It asks whether the
available evidence supports a positive return **at the current executable
price**, after uncertainty and portfolio limits.

The first policy version is intentionally `profit_desk_v1_shadow`:

- no pick is live-qualified;
- every displayed stake is `0u`;
- a slate may correctly say `Sit out`;
- research candidates are tracked prospectively without being presented as
  proven or profitable.

The policy must earn promotion from results recorded after its July 10, 2026
cutover. Historical tuning or backfilled cards never count as a live record.

## Why the previous shortlist was not enough

The previous Best Bets score combined model probability, reported edge, three
recent slate results, and BET/LEAN bonuses. That creates three material risks:

1. a high-probability favorite can rank highly even when its price has negative
   expected value;
2. a 2-0 or 3-0 source streak can look meaningful without shrinkage or an
   uncertainty penalty;
3. assumed odds can make a historical record look executable when no offered
   price was observed.

Profit Desk never uses raw model probability, model rank, recent win rate, or
consensus as permission to create an edge. Those fields may explain a candidate
only after market-relative lift is proven prospectively.

## Evidence audit at launch

The July 10 launch audit found 5,005 outcome-ledger rows and 2,406 settled
win/loss rows, but no certified executable team rows. Player props supplied 604
settled posted-market rows: 350 MLB rows had paired prices that could be
de-vigged, while 254 WNBA rows were one-sided and could not support a fair-market
residual.

After requiring paired prices, a quote timestamp before the event, and exact
flat-1u accounting, 284 rows across 17 dates returned +5.0%. A date-clustered
95% interval still ranged from -5.2% to +16.2%. After deduplicating identical
underlying sides, the estimate fell to +2.7% with a -6.3% to +13.7% interval.
The uncertainty crosses zero, recent chronological performance weakened, and no
active source passed the promotion gates. `liveQualified=0` is therefore a data
conclusion, not a placeholder.

## Evidence tiers

| Tier | Requirement | Allowed use |
| --- | --- | --- |
| A: certified executable | Immutable trusted publication before start plus observed executable odds | ROI and market-alpha evidence |
| B: posted two-sided | Fresh paired pregame quote with an exact no-vig conversion | Shadow market-alpha research |
| C: posted one-sided | Real offered price without the opposing price | Flat ROI tracking only; no market-alpha claim |
| D: assumed or synthetic | Assumed, proxy, default, synthetic, stale, or unattributed price | Context only; never profit evidence |

## Selection algorithm

For a candidate with offered decimal odds `d`:

1. Compute the exact break-even probability:

   `p_break_even = 1 / d`

2. Prefer an explicit selected-side no-vig probability. Otherwise, for a paired
   two-sided market, remove the overround:

   `p_market = implied_selected / (implied_selected + implied_opposite)`

   A one-sided implied probability is never mislabeled as no-vig.

3. For strictly earlier, version-compatible, verified observations, calculate
   residuals:

   `residual_i = outcome_i - p_market_i`

4. Shrink the broad source residual toward zero, then shrink the narrower
   source/version/sport/market/probability-band/direction residual toward that
   broad estimate. The prior prevents tiny samples from manufacturing alpha.

5. Estimate uncertainty around the residual and calculate:

   `p_est = clamp(p_market + alpha)`

   `EV = p_est * d - 1`

   `conservative_EV = p_low * d - 1`

   `Pr(EV > 0) = Pr(p_est > p_break_even)`

6. A research candidate clears the statistical gates only when all of the
   following are true:

   - fresh Tier A or B price;
   - explicit model and selection-policy versions (unversioned eras never pool
     into a qualifying sample);
   - at least 100 compatible source outcomes;
   - at least 40 compatible segment outcomes;
   - at least 20 distinct prior dates;
   - both chronological evidence halves are nonnegative;
   - probability of positive EV is at least 80%;
   - the conservative probability is at least two percentage points above
     break-even;
   - grading is supported and all checks use dates strictly before the slate.

7. Rank surviving research candidates by conservative EV, then probability of
   positive EV, price quality, and start time. Raw win probability is not a
   ranking input.

8. Keep no more than three shadow candidates per mode and no more than one
   market per canonical game/player exposure. Shadow stakes remain `0u`.

## Promotion and live measurement

Promotion is manual and requires a frozen policy version, prospectively settled
unique sides, exact observed-price flat-1u accounting, stable chronological
halves, and a date-clustered lower return bound above zero. Calibration must not
be worse than the market baseline. Once closing prices are captured reliably,
closing-line value should join ROI, Brier score, log loss, calibration error,
turnover, and drawdown as a guardrail.

The live dashboard must keep research/backtest results separate from the
post-cutover record. It must also grade rejected shadow candidates so coverage
and false-negative behavior can be measured instead of reporting only winners
that were published.

## Statistical references

- Glenn Brier, [Verification of Forecasts Expressed in Terms of Probability](https://doi.org/10.1175/1520-0493(1950)078%3C0001:VOFEIT%3E2.0.CO;2), 1950.
- Tilmann Gneiting and Adrian Raftery, [Strictly Proper Scoring Rules, Prediction, and Estimation](https://doi.org/10.1198/016214506000001437), 2007.
- J. L. Kelly Jr., [A New Interpretation of Information Rate](https://doi.org/10.1002/j.1538-7305.1956.tb03809.x), 1956.

Kelly sizing is deliberately disabled during shadow mode. Even after promotion,
any fractional-Kelly output should be calculated from the conservative
probability and capped; it is a risk policy, not evidence that the probability
estimate is correct.
