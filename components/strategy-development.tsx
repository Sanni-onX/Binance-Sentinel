'use client';

import { useEffect, useState } from 'react';
import {
  BookOpenCheck,
  Download,
  FlaskConical,
  History,
  Loader2,
  Save,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { DataMode } from '@/lib/types';
import type {
  StrategyResearch,
  StrategyOutcome,
} from '@/lib/strategy-research';

type RequestApi = <T>(path: string, body?: unknown) => Promise<T>;
const n = (value: number | null) =>
  value === null
    ? '--'
    : value.toLocaleString(undefined, { maximumFractionDigits: 6 });
const pct = (value: number | null) =>
  value === null ? '--' : `${value.toFixed(2)}%`;
const date = (value: number) => new Date(value).toLocaleString();
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export function StrategyDevelopment({
  mode,
  symbols,
  ready,
  request,
}: {
  mode: DataMode;
  symbols: string[];
  ready: boolean;
  request: RequestApi;
}) {
  const [symbol, setSymbol] = useState(symbols[0]);
  const [capital, setCapital] = useState(1000);
  const [days, setDays] = useState(180);
  const [horizon, setHorizon] = useState(7);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [strategies, setStrategies] = useState<StrategyResearch[]>([]);
  const [outcomes, setOutcomes] = useState<StrategyOutcome[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [fees, setFees] = useState('0');
  const [execution, setExecution] = useState<'paper' | 'actual'>('paper');
  const [openedAt, setOpenedAt] = useState(localNow);
  const [closedAt, setClosedAt] = useState(localNow);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    Promise.all([
      request<StrategyResearch[]>('strategies'),
      request<StrategyOutcome[]>('strategy/outcomes'),
    ])
      .then(([s, o]) => {
        if (active) {
          setStrategies(s);
          setOutcomes(o);
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : 'History unavailable.');
      });
    return () => {
      active = false;
    };
  }, [ready, request]);
  const records = strategies.filter((s) => s.mode === mode);
  const current = records.find((s) => s.id === selected) ?? records[0];
  const pair = symbols.includes(symbol) ? symbol : symbols[0];
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const develop = () =>
    run(async () => {
      const result = await request<StrategyResearch>('strategy/develop', {
        symbol: pair,
        mode,
        capital,
        days,
        horizon,
        allocation: 25,
        feeBps,
        slippageBps,
      });
      setStrategies((s) => [result, ...s]);
      setSelected(result.id);
    });
  const record = () =>
    run(async () => {
      if (!current) return;
      const result = await request<StrategyOutcome>('strategy/outcomes', {
        strategyId: current.id,
        execution: current.mode === 'demo' ? 'paper' : execution,
        entry: Number(entry),
        exit: Number(exit),
        quantity: Number(quantity),
        fees: Number(fees),
        openedAt: new Date(openedAt).getTime(),
        closedAt: new Date(closedAt).getTime(),
        notes,
      });
      setOutcomes((o) => [result, ...o]);
      setEntry('');
      setExit('');
      setQuantity('');
      setNotes('');
      setMessage('Outcome recorded.');
    });
  const exportRecord = () => {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              strategy: current,
              outcomes: outcomes.filter((o) => o.strategyId === current.id),
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinel-strategy-${current.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="development-lab">
      <div className="section-heading">
        <div>
          <h2>Strategy builder</h2>
          <p className="chart-caption">
            Conservative spot /{' '}
            {mode === 'demo'
              ? 'Synthetic sample data'
              : 'Binance closed daily candles'}
          </p>
        </div>
      </div>
      <div className="strategy-builder-shell">
        <aside className="builder-sidebar" aria-label="Strategy setup">
          <section className="lab-panel">
            <div className="lab-panel-heading">
              <FlaskConical size={18} />
              <h3>Build</h3>
            </div>
            <form
              className="development-controls"
              onSubmit={(e) => {
                e.preventDefault();
                void develop();
              }}
            >
              <label>
                Market
                <NativeSelect
                  value={pair}
                  onChange={(e) => setSymbol(e.target.value)}
                >
                  {symbols.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </NativeSelect>
              </label>
              <label htmlFor="research-capital">
                Capital / USDT
                <Input
                  id="research-capital"
                  type="number"
                  min="10"
                  max="10000000"
                  required
                  value={capital}
                  onChange={(e) => setCapital(Number(e.target.value))}
                />
              </label>
              <label htmlFor="research-days">
                Research window
                <NativeSelect
                  id="research-days"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                </NativeSelect>
              </label>
              <label htmlFor="research-horizon">
                Trade horizon
                <NativeSelect
                  id="research-horizon"
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                >
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                </NativeSelect>
              </label>
              <div className="compact-controls">
                <label htmlFor="research-fee">
                  Fee / bps
                  <Input
                    id="research-fee"
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={feeBps}
                    onChange={(e) => setFeeBps(Number(e.target.value))}
                  />
                </label>
                <label htmlFor="research-slip">
                  Slippage / bps
                  <Input
                    id="research-slip"
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={slippageBps}
                    onChange={(e) => setSlippageBps(Number(e.target.value))}
                  />
                </label>
              </div>
              <Button disabled={busy || !ready} type="submit">
                {busy ? <Loader2 className="spin" /> : <FlaskConical />}
                Develop strategy
              </Button>
            </form>
          </section>
          <section className="lab-panel">
            <div className="lab-panel-heading">
              <History size={18} />
              <h3>Saved work</h3>
            </div>
            {current ? (
              <div className="saved-strategy-tools">
                <label>
                  Strategy
                  <NativeSelect
                    value={current.id}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setEntry('');
                      setExit('');
                      setQuantity('');
                      setNotes('');
                    }}
                  >
                    {records.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} / {date(s.createdAt)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <Button
                  variant="outline"
                  title="Export strategy and outcomes"
                  aria-label="Export strategy and outcomes"
                  onClick={exportRecord}
                >
                  <Download />
                  Export
                </Button>
              </div>
            ) : (
              <p className="table-empty">
                No developed strategies for this data mode yet.
              </p>
            )}
          </section>
        </aside>
        <div className="builder-main">
          {error && (
            <p role="alert" className="negative">
              {error}
            </p>
          )}
          {message && <output>{message}</output>}
          {!current && (
            <div className="empty-state builder-empty">
              <FlaskConical size={28} />
              <h2>Generate the first strategy</h2>
              <p>
                Sentinel will select from conservative rule templates, validate
                the winner on held-out data, and save the result here.
              </p>
            </div>
          )}
          {current && (
            <>
              <section className="research-thesis">
                <div>
                  <h3>{current.name}</h3>
                  <p>{current.thesis}</p>
                </div>
                <span className="pill">
                  {current.mode === 'demo' ? 'Sample' : current.decision}
                </span>
                <p className="chart-caption">
                  Evidence through {date(current.dataThrough)}. Created{' '}
                  {date(current.createdAt)}.
                </p>
              </section>
              <div className="research-columns">
                <section className="lab-panel decision-panel">
                  <div className="lab-panel-heading">
                    <Target size={18} />
                    <h3>
                      {current.mode === 'demo'
                        ? `Sample / ${current.decision === 'BUY_SETUP' ? 'conditional setup' : 'wait'}`
                        : now > current.expiresAt
                          ? 'Expired setup'
                          : current.decision === 'BUY_SETUP'
                            ? 'Conditional buy setup'
                            : 'Wait'}{' '}
                      / {current.proposal.horizon} days
                    </h3>
                  </div>
                  <p>{current.reasons.join(' ')}</p>
                  <dl className="research-values">
                    <dt>Reference entry</dt>
                    <dd>{n(current.proposal.entry)} USDT</dd>
                    <dt>Stop</dt>
                    <dd>{n(current.proposal.stop)} USDT</dd>
                    <dt>Target</dt>
                    <dd>{n(current.proposal.target)} USDT</dd>
                    <dt>Indicative quantity</dt>
                    <dd>{n(current.proposal.quantity)}</dd>
                    <dt>Budget including costs</dt>
                    <dd>{n(current.proposal.notional)} USDT</dd>
                    <dt>Modeled stop loss</dt>
                    <dd>{n(current.proposal.risk)} USDT</dd>
                  </dl>
                  <p className="chart-caption">
                    Planned risk capped at 0.5% of capital. No order placed.
                  </p>
                  <p className="chart-caption">
                    {current.mode === 'demo'
                      ? 'Synthetic evidence is for demonstration only.'
                      : `Setup expires ${date(current.expiresAt)}.`}
                  </p>
                </section>
                <section className="lab-panel">
                  <div className="lab-panel-heading">
                    <BookOpenCheck size={18} />
                    <h3>Historical outlook</h3>
                  </div>
                  <dl className="research-values">
                    <dt>Similar windows</dt>
                    <dd>{current.outlook.observations}</dd>
                    <dt>Ended higher</dt>
                    <dd>{pct(current.outlook.upFrequency)}</dd>
                    <dt>Median move</dt>
                    <dd>{pct(current.outlook.medianPct)}</dd>
                    <dt>10th to 90th pct.</dt>
                    <dd>
                      {pct(current.outlook.lowPct)} to{' '}
                      {pct(current.outlook.highPct)}
                    </dd>
                  </dl>
                  <p className="chart-caption">
                    Similar historical regimes without trading costs. This is
                    not a calibrated forecast.{' '}
                    {current.outlook.observations < 30
                      ? 'Small sample: fewer than 30 observations.'
                      : ''}
                  </p>
                </section>
              </div>
              <section className="lab-panel">
                <div className="lab-panel-heading">
                  <BookOpenCheck size={18} />
                  <h3>Backtest evidence</h3>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Net return</th>
                        <th>Buy & hold</th>
                        <th>Drawdown</th>
                        <th>Completed trades</th>
                        <th>Profitable trades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Development', e: current.training },
                        { label: 'Held-out validation', e: current.validation },
                      ].map(({ label, e }) => (
                        <tr key={label}>
                          <td>
                            {label} / {e.input.days} days
                          </td>
                          <td>{pct(e.returnPct)}</td>
                          <td>{pct(e.benchmarkPct)}</td>
                          <td>{pct(e.maxDrawdown)}</td>
                          <td>{e.closedTrades}</td>
                          <td>{e.wins}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <details className="lab-panel">
                <summary>Candidate selection and assumptions</summary>
                <p>
                  Four trend-and-stop combinations ranked by development return
                  minus twice drawdown. The winner is locked before the last 30
                  days are evaluated. Backtests allocate{' '}
                  {current.rules.allocation}% per entry; the proposal may size
                  down further to include trading costs in its risk budget.
                </p>
                <ul>
                  {current.candidates.map((c) => (
                    <li key={c.name}>
                      {c.name}: return {pct(c.returnPct)}, drawdown{' '}
                      {pct(c.drawdown)}, score {n(c.score)}
                    </li>
                  ))}
                </ul>
                <ul>
                  {current.validation.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
              <section className="strategy-journal lab-panel">
                <div className="lab-panel-heading">
                  <Save size={18} />
                  <h3>Strategy journal</h3>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void record();
                  }}
                >
                  <div className="development-controls journal-controls">
                    <label>
                      Outcome type
                      <NativeSelect
                        value={current.mode === 'demo' ? 'paper' : execution}
                        onChange={(e) =>
                          setExecution(e.target.value as 'paper' | 'actual')
                        }
                      >
                        <option value="paper">Paper trade</option>
                        {current.mode === 'live' && (
                          <option value="actual">Actual / self-reported</option>
                        )}
                      </NativeSelect>
                    </label>
                    <label htmlFor="outcome-entry">
                      Entry price
                      <Input
                        id="outcome-entry"
                        type="number"
                        step="any"
                        min="0.000000000001"
                        required
                        value={entry}
                        onChange={(e) => setEntry(e.target.value)}
                      />
                    </label>
                    <label htmlFor="outcome-exit">
                      Exit price
                      <Input
                        id="outcome-exit"
                        type="number"
                        step="any"
                        min="0.000000000001"
                        required
                        value={exit}
                        onChange={(e) => setExit(e.target.value)}
                      />
                    </label>
                    <label htmlFor="outcome-quantity">
                      Quantity
                      <Input
                        id="outcome-quantity"
                        type="number"
                        step="any"
                        min="0.000000000001"
                        required
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </label>
                    <label htmlFor="outcome-fees">
                      Fees / USDT
                      <Input
                        id="outcome-fees"
                        type="number"
                        step="any"
                        min="0"
                        required
                        value={fees}
                        onChange={(e) => setFees(e.target.value)}
                      />
                    </label>
                    <label htmlFor="outcome-opened">
                      Opened
                      <Input
                        id="outcome-opened"
                        type="datetime-local"
                        required
                        value={openedAt}
                        onChange={(e) => setOpenedAt(e.target.value)}
                      />
                    </label>
                    <label htmlFor="outcome-closed">
                      Closed
                      <Input
                        id="outcome-closed"
                        type="datetime-local"
                        required
                        value={closedAt}
                        onChange={(e) => setClosedAt(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Outcome notes
                    <textarea
                      maxLength={2000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    <Save />
                    Record outcome
                  </Button>
                </form>
                <div className="table-scroll">
                  <table>
                    <caption>Recorded outcomes for this strategy</caption>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Closed</th>
                        <th>Net P&amp;L / USDT</th>
                        <th>Return on entry value</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcomes
                        .filter((o) => o.strategyId === current.id)
                        .map((o) => (
                          <tr key={o.id}>
                            <td>{o.execution} / self-reported</td>
                            <td>{date(o.closedAt)}</td>
                            <td
                              className={o.pnl >= 0 ? 'positive' : 'negative'}
                            >
                              {n(o.pnl)}
                            </td>
                            <td>{pct(o.returnPct)}</td>
                            <td className="journal-notes">{o.notes || '--'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!outcomes.some((o) => o.strategyId === current.id) && (
                  <p className="table-empty">No recorded outcomes yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
