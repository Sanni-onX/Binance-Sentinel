# Strategy Lab workflow

## Develop a strategy

Choose any tracked USDT pair, research capital, 90 or 180 days of history,
a 3/7/14-day trade horizon, and fee/slippage assumptions. Select **Develop
strategy**. This works without an OpenAI key: the calculations are deterministic.

The engine develops four long-only spot candidates: a 20- or 50-day moving-average
filter combined with a 3% or 5% stop. Each has a target twice the stop distance
and the chosen maximum holding period. Position allocation is capped at 25%,
and reduced so the pre-cost stop risk is at most 0.5% of research capital.

Candidates are backtested on the earlier part of the selected history and ranked
by net return minus twice maximum drawdown. The selected rules are then locked
and evaluated on the last 30 days, starting in cash. The engine never uses that
held-out period to choose the winning candidate. It also displays buy-and-hold
at the same allocation. Repeatedly tuning on the same validation period can
still overfit it; this is a single chronological holdout, not walk-forward testing.

The resulting strategy is saved automatically with its rules, inputs, source,
data date, candidate scores, development results and validation results.

## Trade proposal and outlook

A conditional buy setup requires a positive net return in development and
validation, validation drawdown no greater than 10%, at least three completed
validation trades, an active trend signal, and fresh live candles. Otherwise
the decision is **Wait**, with reasons. A wait result still shows the selected
rules and indicative levels for inspection.

Entry is a reference based on the last closed price. Stop, target, quantity,
cost-inclusive budget, modeled stop risk and holding period are calculated.
Sizing includes estimated fees and slippage and may be smaller than backtest
allocation. Actual entry at the next open requires updated levels and sizing.
Live setups expire within 24 hours and must be regenerated. No order is placed.

The historical outlook examines non-overlapping forward windows in the same
above/below-moving-average regime. It reports the frequency of a higher ending
price, median move and 10th/90th percentiles. These are historical analogues,
not calibrated future probabilities or a trained machine-learning forecast.
They do not model news, macro events or order-book conditions.

Signals use prior closed candles and fills use the following open. Stops account
for adverse opening gaps. If both stop and target are touched in one daily candle,
the engine assumes the stop fills first. Target fills use the target price.
Fees and slippage apply on entry and exit. Open positions are marked to market;
daily-close drawdown can understate intraday risk.

## Strategy journal

Select a saved strategy to inspect its original evidence or export it with its
recorded outcomes. Record a completed paper or actual trade with entry/exit
prices, quantity, total fees, opening/closing dates and notes. Sentinel calculates:

`net P&L = (exit - entry) * quantity - total fees`

`return = net P&L / (entry * quantity)`

Actual outcomes are explicitly self-reported, not verified exchange fills.
Synthetic strategies only accept paper outcomes. Each outcome belongs to the
saved strategy and its owning session. Backtest results and journal results
are displayed separately. Outcome records are append-only.

History is stored in the database under the existing Sentinel browser session.
That session currently lasts seven days; clearing cookies or changing devices
does not recover its records. Export provides a portable copy. Account-linked
cross-device history and automatic Binance fill reconciliation are not included.

## Analyst and manual testing

The AI analyst receives recent saved strategy summaries and their journal
outcomes as evidence when OpenAI is configured. The structured fallback directs
strategy questions to the development workflow. Chat does not trigger research
or execute a trade automatically.

The original manual evaluation form remains available below development for
testing buy-and-hold, staged entries and a trend filter. Its evaluation history
is separate from developed strategy records.

## Verification

Unit tests cover chronological selection isolation, wait decisions, position
risk caps, ambiguous stops, gap fills, and fee-adjusted outcomes. API tests cover
generation, persistence, session isolation and synthetic/actual separation.
No live orders are needed for any of these tests.
