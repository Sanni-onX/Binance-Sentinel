'use client';
import { StrategyDevelopment } from './strategy-development';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Unplug,
  Wallet,
  X,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Pie,
  PieChart,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  ActivityEntry,
  ConnectionStatus,
  DataMode,
  Evaluation,
  MarketSnapshot,
  Portfolio,
  SavedReport,
  StrategyInput,
} from '@/lib/types';
import type { Proposal } from '@/lib/orders';
import Link from 'next/link';

const navigation = [
  ['Overview', LayoutDashboard],
  ['Portfolio', Wallet],
  ['Strategy lab', FlaskConical],
  ['Reports', FileText],
  ['Agent OS', Link2],
] as const;
type View = (typeof navigation)[number][0];
const money = (n: number | null | undefined) =>
  n == null
    ? '--'
    : new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const date = (v: string | number) =>
  new Date(v).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const colors = [
  '#c3a03a',
  '#168c8b',
  '#7288bd',
  '#a989a2',
  '#7c9682',
  '#848992',
];
const DEFAULT_TRACKED_SYMBOLS = ['BTCUSDT', 'BNBUSDT'];
const MAX_TRACKED_SYMBOLS = 8;
const pairLabel = (symbol: string) => symbol.replace(/USDT$/, '');
function normalizePair(input: string) {
  const pair = input.trim().toUpperCase();
  if (!pair) return '';
  return pair.endsWith('USDT') ? pair : `${pair}USDT`;
}
function loadTrackedSymbols() {
  if (typeof window === 'undefined') return DEFAULT_TRACKED_SYMBOLS;
  const saved = localStorage.getItem('sentinel:tracked-symbols');
  if (!saved) return DEFAULT_TRACKED_SYMBOLS;
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_TRACKED_SYMBOLS;
    const next = parsed
      .filter((s): s is string => typeof s === 'string')
      .map(normalizePair)
      .filter(Boolean)
      .slice(0, MAX_TRACKED_SYMBOLS);
    return next.length ? [...new Set(next)] : DEFAULT_TRACKED_SYMBOLS;
  } catch {
    return DEFAULT_TRACKED_SYMBOLS;
  }
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Sentinel API timed out. Check the Railway deployment logs and retry.'
        : 'Sentinel API is unreachable. Confirm the Railway deployment is running and APP_ORIGIN matches this domain.',
    );
  }
  const text = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    if (!response.ok)
      throw new Error(text || `Sentinel API returned HTTP ${response.status}.`);
    throw new Error('Sentinel API returned an unexpected non-JSON response.');
  }
  if (!response.ok)
    throw new Error((result as { error?: string }).error || 'Request failed.');
  return result as T;
}
function download(name: string, body: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Empty({
  icon: Icon = Activity,
  title,
  detail,
  action,
}: {
  icon?: typeof Activity;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  positive,
}: {
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small
        className={
          positive === undefined ? '' : positive ? 'positive' : 'negative'
        }
      >
        {detail}
      </small>
    </div>
  );
}
function ReportBody({ body }: { body: string }) {
  return (
    <div className="report-body">
      {body.split('\n\n').map((p, i) =>
        p.startsWith('# ') ? (
          <h2 key={i}>{p.slice(2)}</h2>
        ) : p.startsWith('## ') ? (
          <section key={i}>
            <h3>{p.split('\n')[0].slice(3)}</h3>
            <p>{p.split('\n').slice(1).join('\n')}</p>
          </section>
        ) : (
          <p key={i}>{p}</p>
        ),
      )}
    </div>
  );
}

export default function SentinelDashboard() {
  const [view, setView] = useState<View>('Overview');
  const [mode, setMode] = useState<DataMode>('live');
  const [ready, setReady] = useState(false);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [trackedSymbols, setTrackedSymbols] = useState(loadTrackedSymbols);
  const [pairInput, setPairInput] = useState('');
  const [marketError, setMarketError] = useState('');
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>({
    connected: false,
    tokenPresent: false,
    tools: [],
    aiConfigured: false,
    aiStatus: 'OpenAI key and model missing',
    oauthReady: false,
    oauthMode: 'local_only',
    oauthStatus: 'Needs public HTTPS metadata',
  });
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(
    null,
  );
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluations, setEvaluations] = useState<
    (Evaluation & { id: string })[]
  >([]);
  const [strategy, setStrategy] = useState<StrategyInput>({
    symbol: 'BTCUSDT',
    strategy: 'trend',
    days: 90,
    capital: 1000,
    allocation: 25,
    feeBps: 10,
    slippageBps: 5,
  });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [chartDays, setChartDays] = useState(30);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<
    { message: string; answer: string; engine: string }[]
  >([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [order, setOrder] = useState({ symbol: 'BTCUSDT', amount: '10.00' });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [receipt, setReceipt] = useState<unknown>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const navigate = useCallback((next: View) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.replaceState({}, '', url);
  }, []);
  const loadRecords = useCallback(async () => {
    const [r, a, e] = await Promise.all([
      api<SavedReport[]>('reports'),
      api<ActivityEntry[]>('activity'),
      api<(Evaluation & { id: string })[]>('evaluations'),
    ]);
    setReports(r);
    setActivity(a);
    setEvaluations(e);
  }, []);
  const refreshMarket = useCallback(async () => {
    const token = ++generation.current;
    setLoadingMarket(true);
    setMarket((previous) => (previous?.mode === mode ? previous : null));
    setMarketError('');
    try {
      const params = new URLSearchParams({
        mode,
        symbols: trackedSymbols.join(','),
      });
      const result = await api<MarketSnapshot>(`market?${params.toString()}`);
      if (token === generation.current) setMarket(result);
    } catch (e) {
      if (token === generation.current) {
        setMarket(null);
        setMarketError(
          e instanceof Error ? e.message : 'Market data unavailable.',
        );
      }
    } finally {
      if (token === generation.current) setLoadingMarket(false);
    }
  }, [mode, trackedSymbols]);
  const addTrackedPair = () => {
    const symbol = normalizePair(pairInput);
    if (!symbol) return;
    if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
      setNotice('Use a Binance USDT pair such as ETH or SOLUSDT.');
      return;
    }
    if (trackedSymbols.includes(symbol)) {
      setPairInput('');
      return;
    }
    if (trackedSymbols.length >= MAX_TRACKED_SYMBOLS) {
      setNotice(`Track at most ${MAX_TRACKED_SYMBOLS} pairs at once.`);
      return;
    }
    setTrackedSymbols((current) => [...current, symbol]);
    setPairInput('');
  };
  const removeTrackedPair = (symbol: string) => {
    if (trackedSymbols.length <= 1) return;
    const next = trackedSymbols.filter((s) => s !== symbol);
    setTrackedSymbols(next);
    if (strategy.symbol === symbol)
      setStrategy((current) => ({ ...current, symbol: next[0] }));
  };
  const task = async (name: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };
  useEffect(() => {
    let active = true;
    const initial = new URL(window.location.href).searchParams.get('view');
    void (async () => {
      try {
        const session = await api<{
          aiConfigured: boolean;
          aiStatus?: string;
          tradingEnabled: boolean;
          oauthReady: boolean;
          oauthMode?: string;
          oauthStatus?: string;
        }>('session');
        if (!active) return;
        if (navigation.some(([n]) => n === initial)) setView(initial as View);
        setConnection((c) => ({
          ...c,
          aiConfigured: session.aiConfigured,
          aiStatus: session.aiStatus,
          oauthReady: session.oauthReady,
          oauthMode: session.oauthMode,
          oauthStatus: session.oauthStatus,
        }));
        setTradingEnabled(session.tradingEnabled);
        setReady(true);
        await loadRecords();
        const status = await api<ConnectionStatus>('binance/status');
        if (active) setConnection((c) => ({ ...c, ...status }));
        const history = await api<typeof chat>('chat');
        if (active) setChat(history);
        if (status.connected) {
          const p = await api<Portfolio>('portfolio');
          if (active) setPortfolio(p);
        }
      } catch (e) {
        if (active) {
          setNotice(e instanceof Error ? e.message : 'Startup failed.');
          setLoadingMarket(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [loadRecords]);
  useEffect(() => {
    localStorage.setItem(
      'sentinel:tracked-symbols',
      JSON.stringify(trackedSymbols),
    );
  }, [trackedSymbols]);
  const invalidateMarket = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (!ready) return;
    queueMicrotask(() => {
      void refreshMarket();
    });
    const timer = setInterval(() => {
      void refreshMarket();
    }, 60000);
    return () => {
      clearInterval(timer);
      invalidateMarket();
    };
  }, [ready, refreshMarket, invalidateMarket]);
  const generateReport = async () => {
    await task('report', async () => {
      const r = await api<SavedReport>('reports/generate', {
        mode,
        symbols: trackedSymbols,
      });
      setSelectedReport(r);
      await loadRecords();
      navigate('Reports');
    });
  };
  const evaluate = async () => {
    await task('evaluate', async () => {
      const e = await api<Evaluation>('strategy/evaluate', {
        ...strategy,
        mode,
      });
      setEvaluation(e);
      await loadRecords();
    });
  };
  const ask = async (value = message) => {
    if (!value.trim()) return;
    await task('chat', async () => {
      setChatOpen(true);
      const result = await api<{ answer: string; engine: string }>(
        'agent/ask',
        { message: value, mode, symbols: trackedSymbols },
      );
      setChat((c) => [...c, { message: value, ...result }]);
      setMessage('');
      await loadRecords();
    });
  };
  const connect = async () => {
    await task('connect', async () => {
      const result = await api<{ url: string }>('binance/connect', {});
      const url = new URL(result.url);
      if (
        url.hostname !== 'accounts.binance.com' &&
        url.origin !== window.location.origin
      )
        throw new Error('Unexpected authorization URL.');
      window.location.assign(url.href);
    });
  };
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'open_sentinel_view',
          description:
            'Navigate Sentinel to Overview, Portfolio, Strategy lab, Reports, or Agent OS.',
          inputSchema: {
            type: 'object',
            properties: {
              view: { type: 'string', enum: navigation.map(([n]) => n) },
            },
            required: ['view'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: async (input: unknown) => {
            const next = (input as { view?: View })?.view;
            if (!navigation.some(([n]) => n === next))
              throw new Error('Unknown view.');
            navigate(next!);
            return { view: next };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [navigate]);
  const primaryAssets = market?.assets.slice(0, 4) || [];
  const activeEvaluation = evaluation;
  const chart =
    primaryAssets[0]?.candles.slice(-chartDays).map((c, i) => {
      const point: Record<string, number> = { time: c.time };
      for (const asset of primaryAssets) {
        const candles = asset.candles.slice(-chartDays);
        point[asset.symbol] = (candles[i].close / candles[0].close - 1) * 100;
      }
      return point;
    }) || [];
  const headline = market
    ? market.assets.every((a) => a.trend === 'Rising')
      ? 'Momentum is building. Stay selective.'
      : market.assets.some((a) => a.trend === 'Falling')
        ? 'Protect your room to maneuver.'
        : 'A mixed market rewards patience.'
    : 'Waiting for a clear market picture.';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <BarChart3 size={23} />
          </span>
          <span>
            Sentinel<span className="brand-caption">BINANCE AGENT OS</span>
          </span>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(([name, Icon]) => (
            <button
              key={name}
              className={`nav-item ${view === name ? 'active' : ''}`}
              onClick={() => navigate(name)}
              aria-current={view === name ? 'page' : undefined}
            >
              <Icon size={18} />
              {name}
              {name === 'Agent OS' && (
                <span
                  className={`status-dot ${connection.connected ? 'connected' : ''}`}
                />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-agent">
          <Bot size={20} />
          <span>
            Sentinel analyst
            <small>
              {connection.aiConfigured
                ? 'AI connected'
                : connection.aiStatus || 'Structured analytics'}
            </small>
          </span>
          <button
            title="Open analyst"
            aria-label="Open analyst"
            onClick={() => setChatOpen(true)}
          >
            <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <div>
            Conservative profile<small>Spot markets only</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> {view}
          </div>
          <div className="topbar-actions">
            <span className={`pill ${mode === 'demo' ? 'sample-pill' : ''}`}>
              <span
                className={`status-dot ${market && mode === 'live' ? 'connected' : ''}`}
              />
              {mode === 'demo'
                ? 'Sample data'
                : market
                  ? 'Live markets'
                  : 'Market feed pending'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              title="Open analyst"
              aria-label="Open analyst"
              onClick={() => setChatOpen(true)}
            >
              <Bot />
            </Button>
          </div>
        </header>
        <div className="page-body">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === 'Overview'
                  ? 'MARKET INTELLIGENCE'
                  : view === 'Portfolio'
                    ? 'ACCOUNT & EXPOSURE'
                    : view === 'Strategy lab'
                      ? 'RESEARCH & EVALUATION'
                      : view === 'Reports'
                        ? 'YOUR RESEARCH ARCHIVE'
                        : 'BINANCE CONNECTION'}
              </p>
              <h1>
                {view === 'Overview'
                  ? 'Your market, in focus.'
                  : view === 'Portfolio'
                    ? 'Every asset. A clearer picture.'
                    : view === 'Strategy lab'
                      ? 'Test the thesis.'
                      : view === 'Reports'
                        ? 'Intelligence, on record.'
                        : 'Connected by design.'}
              </h1>
              <p className="subtle">
                {view === 'Overview'
                  ? 'Tracked pairs and your portfolio.'
                  : view === 'Portfolio'
                    ? 'Actual balances from your Agentic spot account.'
                    : view === 'Strategy lab'
                      ? 'Conservative spot strategies. Measurable outcomes.'
                      : view === 'Reports'
                        ? 'Market reviews, portfolio insights and decision records.'
                        : 'Binance Agent OS / Track B workspace'}
              </p>
            </div>
            <div className="heading-actions">
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh market data"
                title="Refresh market data"
                disabled={loadingMarket || !ready}
                onClick={() => void refreshMarket()}
              >
                <RefreshCw className={loadingMarket ? 'spin' : ''} />
              </Button>
              {view === 'Agent OS' ? (
                <Button
                  disabled={Boolean(busy) || !ready}
                  onClick={() => void connect()}
                >
                  <Link2 />
                  {busy === 'connect'
                    ? 'Connecting...'
                    : connection.connected
                      ? 'Reconnect'
                      : 'Connect Binance'}
                </Button>
              ) : (
                <Button
                  disabled={Boolean(busy) || !market}
                  onClick={() => void generateReport()}
                >
                  {busy === 'report' ? (
                    <Loader2 className="spin" />
                  ) : (
                    <FileText />
                  )}
                  Generate report
                </Button>
              )}
            </div>
          </div>
          {notice && (
            <div className="notice" role="alert">
              <CircleHelp size={17} />
              <span>{notice}</span>
              <button
                onClick={() => setNotice('')}
                aria-label="Dismiss notification"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="data-toolbar">
            <div className="segmented" aria-label="Market data source">
              {(['live', 'demo'] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={mode === m ? 'selected' : ''}
                >
                  {m === 'live' ? 'Live Binance' : 'Sample data'}
                </button>
              ))}
            </div>
            <span className="data-timestamp">
              {loadingMarket
                ? 'Refreshing market snapshot...'
                : market
                  ? `${mode === 'demo' ? 'Synthetic / ' : ''}${date(market.asOf)}`
                  : 'No market snapshot'}
            </span>
          </div>
          <form
            className="pair-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              addTrackedPair();
            }}
          >
            <div className="tracked-pairs" aria-label="Tracked market pairs">
              {trackedSymbols.map((symbol) => (
                <span className="pair-chip" key={symbol}>
                  {pairLabel(symbol)}
                  <button
                    type="button"
                    title={`Remove ${symbol}`}
                    aria-label={`Remove ${symbol}`}
                    disabled={trackedSymbols.length <= 1}
                    onClick={() => removeTrackedPair(symbol)}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
            <label htmlFor="tracked-pair-input" className="pair-input">
              <Input
                id="tracked-pair-input"
                value={pairInput}
                onChange={(e) => setPairInput(e.target.value)}
                placeholder="Add pair, e.g. ETH"
                maxLength={20}
              />
            </label>
            <Button
              type="submit"
              variant="outline"
              disabled={!pairInput.trim()}
            >
              Add pair
            </Button>
          </form>
          {marketError && (
            <div className="notice" role="alert">
              <Activity size={17} />
              <span>{marketError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMode('demo')}
              >
                Use sample data
              </Button>
            </div>
          )}
          {view === 'Overview' && (
            <>
              <div className="metric-grid">
                {trackedSymbols.slice(0, 2).map((symbol) => {
                  const asset = market?.assets.find((a) => a.symbol === symbol);
                  return (
                    <Metric
                      key={symbol}
                      label={`${pairLabel(symbol)} / USDT`}
                      value={asset ? money(asset.price) : '--'}
                      detail={
                        asset
                          ? `${pct(asset.change)} past 24h`
                          : 'Awaiting market data'
                      }
                      positive={asset ? asset.change >= 0 : undefined}
                    />
                  );
                })}
                <Metric
                  label="Portfolio value / USDT"
                  value={portfolio ? money(portfolio.total) : '--'}
                  detail={
                    portfolio
                      ? `${portfolio.holdings.length} assets / ${portfolio.unpriced} unpriced`
                      : 'Account not connected'
                  }
                />
                <Metric
                  label="Risk profile"
                  value="Conservative"
                  detail="Spot only / Approval required"
                />
              </div>
              <div className="overview-grid">
                <section className="market-panel">
                  <div className="section-heading">
                    <div>
                      <h2>Market performance</h2>
                      <p className="chart-caption">
                        Price change from period start
                      </p>
                    </div>
                    <div className="segmented small">
                      {[7, 30, 90].map((d) => (
                        <button
                          key={d}
                          className={chartDays === d ? 'selected' : ''}
                          aria-pressed={chartDays === d}
                          onClick={() => setChartDays(d)}
                        >
                          {d}D
                        </button>
                      ))}
                    </div>
                  </div>
                  {chart.length ? (
                    <>
                      <ChartContainer
                        className="performance-chart"
                        config={Object.fromEntries(
                          primaryAssets.map((a, i) => [
                            a.symbol,
                            { label: pairLabel(a.symbol), color: colors[i] },
                          ]),
                        )}
                      >
                        <ComposedChart
                          data={chart}
                          margin={{ top: 15, right: 8, left: -15, bottom: 8 }}
                        >
                          <CartesianGrid
                            vertical={false}
                            strokeDasharray="3 4"
                          />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })
                            }
                            axisLine={false}
                            tickLine={false}
                            minTickGap={35}
                          />
                          <YAxis
                            tickFormatter={(v) => `${v.toFixed(0)}%`}
                            axisLine={false}
                            tickLine={false}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(_, payload) =>
                                  new Date(
                                    payload[0]?.payload.time,
                                  ).toLocaleDateString()
                                }
                              />
                            }
                          />
                          {primaryAssets.map((asset, i) => (
                            <Line
                              key={asset.symbol}
                              type="linear"
                              dataKey={asset.symbol}
                              stroke={colors[i]}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          ))}
                        </ComposedChart>
                      </ChartContainer>
                      <div className="chart-legend">
                        {primaryAssets.map((asset, i) => (
                          <span key={asset.symbol}>
                            <i style={{ background: colors[i] }} />
                            {pairLabel(asset.symbol)}
                          </span>
                        ))}
                        <span className="legend-note">
                          Closed daily candles /{' '}
                          {mode === 'demo'
                            ? 'Synthetic sample'
                            : 'Binance Spot'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title={
                        loadingMarket
                          ? 'Fetching market data'
                          : 'Market data unavailable'
                      }
                      detail="Tracked pair daily price performance"
                    />
                  )}
                </section>
                <section className="brief-panel">
                  <div className="brief-label">
                    <Bot size={17} />
                    <span className="eyebrow">SENTINEL BRIEF</span>
                    <span className="pill">
                      {mode === 'demo' ? 'SAMPLE' : 'DAILY'}
                    </span>
                  </div>
                  <h2>{headline}</h2>
                  <p className="subtle">
                    {market
                      ? `${primaryAssets.map((a) => `${pairLabel(a.symbol)} is ${a.trend.toLowerCase()}`).join(', ')}. Review momentum alongside existing exposure before adding a position.`
                      : 'Your brief will appear when market data is available.'}
                  </p>
                  <div className="brief-check">
                    <ShieldCheck size={17} />
                    <div>
                      Capital preservation first
                      <small>Review exposure before any new order.</small>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!market || Boolean(busy)}
                    onClick={() =>
                      void ask(
                        `Analyze ${trackedSymbols.map(pairLabel).join(', ')} market changes and implications for a conservative portfolio.`,
                      )
                    }
                  >
                    Ask Sentinel <ArrowUpRight />
                  </Button>
                </section>
              </div>
              <section className="watchlist">
                <div className="section-heading">
                  <h2>
                    Market watchlist{' '}
                    <span className="count">
                      {String(trackedSymbols.length).padStart(2, '0')}
                    </span>
                  </h2>
                  <span className="muted-text">USDT quoted / 24h</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Last price</th>
                        <th>24h change</th>
                        <th>24h volume</th>
                        <th>RSI (14D)</th>
                        <th>Daily trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {market?.assets.map((a, i) => (
                        <tr key={a.symbol}>
                          <td aria-label={a.symbol}>
                            <div className="asset-cell">
                              <span className={`coin coin-${i}`}>
                                {pairLabel(a.symbol).slice(0, 2)}
                              </span>
                              <span>
                                {pairLabel(a.symbol)}
                                <small>{a.symbol}</small>
                              </span>
                            </div>
                          </td>
                          <td>{money(a.price)}</td>
                          <td
                            className={a.change >= 0 ? 'positive' : 'negative'}
                          >
                            {pct(a.change)}
                          </td>
                          <td>
                            {new Intl.NumberFormat('en-US', {
                              notation: 'compact',
                              maximumFractionDigits: 2,
                            }).format(a.volume)}
                          </td>
                          <td>{a.rsi.toFixed(1)}</td>
                          <td>
                            <span className={`trend ${a.trend.toLowerCase()}`}>
                              {a.trend}
                            </span>
                          </td>
                        </tr>
                      )) || (
                        <tr>
                          <td colSpan={6}>Awaiting market data</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="bottom-row">
                <div className="inline-prompt">
                  <FlaskConical size={23} />
                  <div>
                    <h3>Put a strategy to the test.</h3>
                    <p>Compare performance, drawdown and execution costs.</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Open strategy lab"
                    aria-label="Open strategy lab"
                    onClick={() => navigate('Strategy lab')}
                  >
                    <ArrowRight />
                  </Button>
                </div>
                <div className="inline-prompt">
                  <Link2 size={23} />
                  <div>
                    <h3>
                      {connection.connected
                        ? 'Agent OS connected'
                        : 'Your portfolio belongs here.'}
                    </h3>
                    <p>
                      {connection.connected
                        ? `${connection.tools.length} Binance tools discovered.`
                        : 'Authorize your Binance Agentic account.'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Open Binance connection"
                    aria-label="Open Binance connection"
                    onClick={() => navigate('Agent OS')}
                  >
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            </>
          )}
          {view === 'Portfolio' && (
            <>
              <div className="section-heading">
                <h2>{portfolio?.scope || 'Agentic spot account'}</h2>
                <Button
                  variant="outline"
                  disabled={!connection.connected || Boolean(busy)}
                  onClick={() =>
                    void task('portfolio', async () => {
                      setPortfolio(await api<Portfolio>('portfolio'));
                      await loadRecords();
                    })
                  }
                >
                  <RefreshCw className={busy === 'portfolio' ? 'spin' : ''} />
                  Refresh balances
                </Button>
              </div>
              {!portfolio ? (
                <Empty
                  icon={Wallet}
                  title="Connect your actual portfolio"
                  detail="Your balances will appear after Binance authorization and an account refresh."
                  action={
                    <Button onClick={() => navigate('Agent OS')}>
                      <Link2 />
                      Connect Binance
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className="metric-grid">
                    <Metric
                      label="Priced portfolio / USDT"
                      value={money(portfolio.total)}
                      detail={date(portfolio.asOf)}
                    />
                    <Metric
                      label="Funded assets"
                      value={String(portfolio.holdings.length)}
                      detail={`${portfolio.unpriced} assets without a USDT price`}
                    />
                    <Metric
                      label="Largest allocation"
                      value={`${portfolio.holdings[0]?.weight?.toFixed(1) || 0}%`}
                      detail={portfolio.holdings[0]?.asset || 'No holdings'}
                    />
                    <Metric
                      label="Available USDT"
                      value={money(
                        Number(
                          portfolio.holdings.find((h) => h.asset === 'USDT')
                            ?.free || 0,
                        ),
                      )}
                      detail="Available for spot orders"
                    />
                  </div>
                  <div className="portfolio-layout">
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Asset</th>
                            <th>Available</th>
                            <th>Locked</th>
                            <th>Value / USDT</th>
                            <th>Weight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolio.holdings.map((h) => (
                            <tr key={h.asset}>
                              <td>{h.asset}</td>
                              <td>{h.free}</td>
                              <td>{h.locked}</td>
                              <td>{money(h.value)}</td>
                              <td>
                                {h.weight === null
                                  ? '--'
                                  : `${h.weight.toFixed(1)}%`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!portfolio.holdings.length && (
                        <Empty
                          title="This account is empty"
                          detail="Fund your Agentic sub-account through Binance to populate your portfolio."
                        />
                      )}
                    </div>
                    {portfolio.total > 0 && (
                      <ChartContainer
                        className="allocation-chart"
                        config={{ value: { label: 'USDT' } }}
                      >
                        <PieChart>
                          <Pie
                            data={portfolio.holdings.filter(
                              (h) => h.value !== null,
                            )}
                            dataKey="value"
                            nameKey="asset"
                            innerRadius={65}
                            outerRadius={90}
                            stroke="none"
                          ></Pie>
                          <ChartTooltip content={<ChartTooltipContent />} />
                        </PieChart>
                      </ChartContainer>
                    )}
                  </div>
                  {portfolio.holdings.some(
                    (h) =>
                      (h.weight ?? 0) > 50 &&
                      !['USDT', 'USDC', 'FDUSD'].includes(h.asset),
                  ) && (
                    <div className="notice">
                      <ShieldCheck size={18} />
                      <span>
                        Single-asset concentration exceeds the 50% review
                        threshold.
                      </span>
                    </div>
                  )}
                </>
              )}
              <section className="order-section">
                <div>
                  <p className="eyebrow">SPOT ORDER</p>
                  <h2>Prepare a measured entry.</h2>
                  <p className="subtle">
                    Maximum 25 USDT per order, within portfolio limits.
                  </p>
                </div>
                <form
                  className="order-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task('stage', async () =>
                      setProposal(await api<Proposal>('orders/stage', order)),
                    );
                  }}
                >
                  <label htmlFor="order-symbol">
                    Asset
                    <NativeSelect
                      id="order-symbol"
                      value={order.symbol}
                      onChange={(e) =>
                        setOrder({ ...order, symbol: e.target.value })
                      }
                    >
                      <option value="BTCUSDT">BTC / USDT</option>
                      <option value="BNBUSDT">BNB / USDT</option>
                    </NativeSelect>
                  </label>
                  <label htmlFor="order-amount">
                    Spend / USDT
                    <Input
                      required
                      type="number"
                      min="0.01"
                      max="25"
                      step="0.01"
                      id="order-amount"
                      value={order.amount}
                      onChange={(e) =>
                        setOrder({ ...order, amount: e.target.value })
                      }
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={
                      !connection.connected ||
                      !tradingEnabled ||
                      Boolean(busy) ||
                      mode === 'demo'
                    }
                  >
                    <ArrowRight />
                    Review buy order
                  </Button>
                </form>
                <span className="muted-text">
                  {!tradingEnabled
                    ? 'Live trading is disabled.'
                    : mode === 'demo'
                      ? 'Switch to live data to prepare an order.'
                      : 'Market buy / Explicit confirmation required'}
                </span>
              </section>
              {receipt !== null && (
                <section className="receipt">
                  <h2>Exchange response</h2>
                  <pre>{JSON.stringify(receipt, null, 2)}</pre>
                </section>
              )}
            </>
          )}
          {view === 'Strategy lab' && (
            <>
              <StrategyDevelopment
                mode={mode}
                symbols={trackedSymbols}
                ready={ready}
                request={api}
              />
              <div className="strategy-layout">
                <form
                  className="strategy-controls"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void evaluate();
                  }}
                >
                  <h2>Evaluation parameters</h2>
                  <label htmlFor="strategy-symbol">
                    Market
                    <NativeSelect
                      id="strategy-symbol"
                      value={strategy.symbol}
                      onChange={(e) =>
                        setStrategy({
                          ...strategy,
                          symbol: e.target.value as StrategyInput['symbol'],
                        })
                      }
                    >
                      {trackedSymbols.map((symbol) => (
                        <option value={symbol} key={symbol}>
                          {pairLabel(symbol)} / USDT
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label htmlFor="strategy-type">
                    Strategy
                    <NativeSelect
                      id="strategy-type"
                      value={strategy.strategy}
                      onChange={(e) =>
                        setStrategy({
                          ...strategy,
                          strategy: e.target.value as StrategyInput['strategy'],
                        })
                      }
                    >
                      <option value="trend">50-day trend filter</option>
                      <option value="dca">Weekly staged entry</option>
                      <option value="hold">Buy and hold</option>
                    </NativeSelect>
                  </label>
                  <label htmlFor="strategy-days">
                    Evaluation window
                    <NativeSelect
                      id="strategy-days"
                      value={strategy.days}
                      onChange={(e) =>
                        setStrategy({
                          ...strategy,
                          days: Number(e.target.value),
                        })
                      }
                    >
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="180">180 days</option>
                    </NativeSelect>
                  </label>
                  <label htmlFor="strategy-capital">
                    Starting capital / USDT
                    <Input
                      type="number"
                      required
                      min="10"
                      max="10000000"
                      id="strategy-capital"
                      value={strategy.capital}
                      onChange={(e) =>
                        setStrategy({
                          ...strategy,
                          capital: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label htmlFor="strategy-allocation">
                    Allocation <span>{strategy.allocation}%</span>
                    <input
                      aria-label="Strategy allocation"
                      type="range"
                      min="5"
                      max="80"
                      step="5"
                      id="strategy-allocation"
                      value={strategy.allocation}
                      onChange={(e) =>
                        setStrategy({
                          ...strategy,
                          allocation: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="form-pair">
                    <label htmlFor="strategy-fee">
                      Fee / bps
                      <Input
                        required
                        type="number"
                        min="0"
                        max="100"
                        id="strategy-fee"
                        value={strategy.feeBps}
                        onChange={(e) =>
                          setStrategy({
                            ...strategy,
                            feeBps: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label htmlFor="strategy-slippage">
                      Slippage / bps
                      <Input
                        required
                        type="number"
                        min="0"
                        max="100"
                        id="strategy-slippage"
                        value={strategy.slippageBps}
                        onChange={(e) =>
                          setStrategy({
                            ...strategy,
                            slippageBps: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <Button type="submit" disabled={Boolean(busy) || !ready}>
                    {busy === 'evaluate' ? (
                      <Loader2 className="spin" />
                    ) : (
                      <FlaskConical />
                    )}
                    Run evaluation
                  </Button>
                  <p className="muted-text">
                    {mode === 'demo'
                      ? 'Synthetic sample candles'
                      : 'Binance closed daily candles'}
                  </p>
                </form>
                <section className="strategy-results">
                  {!activeEvaluation ? (
                    <Empty
                      icon={FlaskConical}
                      title="A thesis needs evidence."
                      detail="No evaluation has been run in this view."
                    />
                  ) : (
                    <>
                      <div className="section-heading">
                        <div>
                          <h2>
                            {activeEvaluation.input.symbol} /{' '}
                            {activeEvaluation.input.strategy === 'trend'
                              ? 'Trend filter'
                              : activeEvaluation.input.strategy === 'dca'
                                ? 'Weekly staged entry'
                                : 'Buy and hold'}
                          </h2>
                          <p className="chart-caption">
                            {activeEvaluation.source} /{' '}
                            {activeEvaluation.input.days} days
                          </p>
                        </div>
                        <Button
                          size="icon"
                          variant="outline"
                          title="Download evaluation JSON"
                          aria-label="Download evaluation JSON"
                          onClick={() =>
                            download(
                              'sentinel-evaluation.json',
                              JSON.stringify(activeEvaluation, null, 2),
                              'application/json',
                            )
                          }
                        >
                          <ArrowDownToLine />
                        </Button>
                      </div>
                      <div className="result-metrics">
                        <div>
                          <span>Total return</span>
                          <strong
                            className={
                              activeEvaluation.returnPct >= 0
                                ? 'positive'
                                : 'negative'
                            }
                          >
                            {pct(activeEvaluation.returnPct)}
                          </strong>
                        </div>
                        <div>
                          <span>Max drawdown</span>
                          <strong>
                            {activeEvaluation.maxDrawdown.toFixed(2)}%
                          </strong>
                        </div>
                        <div>
                          <span>Benchmark</span>
                          <strong>{pct(activeEvaluation.benchmarkPct)}</strong>
                        </div>
                      </div>
                      <ChartContainer
                        className="performance-chart"
                        config={{
                          strategy: { label: 'Strategy', color: colors[1] },
                          benchmark: { label: 'Benchmark', color: '#a9adb5' },
                        }}
                      >
                        <ComposedChart
                          data={activeEvaluation.curve}
                          margin={{ left: 0, right: 10, top: 10 }}
                        >
                          <CartesianGrid
                            vertical={false}
                            strokeDasharray="3 4"
                          />
                          <XAxis
                            dataKey="time"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })
                            }
                            minTickGap={40}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            domain={['auto', 'auto']}
                            tickFormatter={(v) =>
                              Math.round(v).toLocaleString()
                            }
                            axisLine={false}
                            tickLine={false}
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Area
                            type="linear"
                            dataKey="strategy"
                            stroke={colors[1]}
                            fill="#168c8b"
                            fillOpacity={0.06}
                            strokeWidth={2}
                            isAnimationActive={false}
                          />
                          <Line
                            type="linear"
                            dataKey="benchmark"
                            stroke="#a9adb5"
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive={false}
                          />
                        </ComposedChart>
                      </ChartContainer>
                      <div className="chart-legend">
                        <span>
                          <i style={{ background: colors[1] }} />
                          Strategy
                        </span>
                        <span>
                          <i style={{ background: '#a9adb5' }} />
                          Same-allocation benchmark
                        </span>
                      </div>
                      <div className="evaluation-detail">
                        <span>
                          Final value{' '}
                          <b>{money(activeEvaluation.finalValue)} USDT</b>
                        </span>
                        <span>
                          Fees <b>{money(activeEvaluation.fees)} USDT</b>
                        </span>
                        <span>
                          Transactions <b>{activeEvaluation.trades}</b>
                        </span>
                        <span>
                          Sharpe / zero cash return{' '}
                          <b>{activeEvaluation.sharpe?.toFixed(2) ?? 'N/A'}</b>
                        </span>
                      </div>
                      <div className="evaluation-verdict">
                        <ShieldCheck size={19} />
                        {activeEvaluation.verdict}
                      </div>
                      <details>
                        <summary>Evaluation assumptions</summary>
                        <ul>
                          {activeEvaluation.assumptions.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </details>
                    </>
                  )}
                </section>
              </div>
              <section className="history-section">
                <div className="section-heading">
                  <h2>Recent evaluations</h2>
                  <span className="muted-text">
                    Saved in this workspace session
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>Strategy</th>
                        <th>Window</th>
                        <th>Source</th>
                        <th>Return</th>
                        <th>Drawdown</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {evaluations.map((e) => (
                        <tr key={e.id}>
                          <td>{e.input.symbol}</td>
                          <td>{e.input.strategy}</td>
                          <td>{e.input.days}D</td>
                          <td>{e.mode === 'demo' ? 'Sample' : 'Binance'}</td>
                          <td
                            className={
                              e.returnPct >= 0 ? 'positive' : 'negative'
                            }
                          >
                            {pct(e.returnPct)}
                          </td>
                          <td>{e.maxDrawdown.toFixed(2)}%</td>
                          <td>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Open evaluation"
                              aria-label="Open evaluation"
                              onClick={() => setEvaluation(e)}
                            >
                              <ArrowUpRight />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!evaluations.length && (
                    <p className="table-empty">No saved evaluations yet.</p>
                  )}
                </div>
              </section>
            </>
          )}
          {view === 'Reports' && (
            <div className="reports-layout">
              <section className="reports-list">
                <div className="section-heading">
                  <h2>Saved reports</h2>
                  <span className="count">{reports.length}</span>
                </div>
                {reports.map((r) => (
                  <button
                    key={r.id}
                    className={`report-item ${selectedReport?.id === r.id ? 'selected' : ''}`}
                    onClick={() => setSelectedReport(r)}
                  >
                    <FileText size={20} />
                    <span>
                      {r.title}
                      <small>
                        {date(r.createdAt)} /{' '}
                        {r.mode === 'demo' ? 'Sample' : 'Binance'}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
                {!reports.length && (
                  <Empty
                    icon={FileText}
                    title="Your first report starts here."
                    detail="Generate a review from the current market snapshot."
                  />
                )}
              </section>
              <section className="report-reader">
                {selectedReport ? (
                  <>
                    <div className="section-heading">
                      <span className="pill">
                        {selectedReport.mode === 'demo'
                          ? 'SYNTHETIC SAMPLE'
                          : 'BINANCE DATA'}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        title="Download report"
                        aria-label="Download report"
                        onClick={() =>
                          download(
                            `sentinel-report-${selectedReport.id}.md`,
                            selectedReport.body,
                          )
                        }
                      >
                        <ArrowDownToLine />
                      </Button>
                    </div>
                    <ReportBody body={selectedReport.body} />
                  </>
                ) : (
                  <Empty
                    icon={FileText}
                    title="Choose a report"
                    detail="Your saved market and portfolio reviews appear here."
                  />
                )}
              </section>
            </div>
          )}
          {view === 'Agent OS' && (
            <>
              <section className="connection-section">
                <div className="connection-title">
                  <span className="connection-icon">
                    <Link2 size={28} />
                  </span>
                  <div>
                    <h2>Binance Agent OS</h2>
                    <p className="subtle">Agentic account / Remote MCP</p>
                  </div>
                  <span
                    className={`pill ${connection.connected ? 'positive' : ''}`}
                  >
                    {connection.connected
                      ? 'Connected'
                      : connection.tokenPresent
                        ? 'Authorization saved'
                        : 'Not connected'}
                  </span>
                </div>
                <div className="connection-details">
                  <div>
                    <span>Market data</span>
                    <strong>
                      {market && mode === 'live'
                        ? 'Live public API'
                        : mode === 'demo'
                          ? 'Sample mode'
                          : 'Unavailable'}
                    </strong>
                  </div>
                  <div>
                    <span>Account access</span>
                    <strong>
                      {connection.connected
                        ? 'Authorized tools available'
                        : connection.oauthStatus || 'Authorization required'}
                    </strong>
                  </div>
                  <div>
                    <span>Execution</span>
                    <strong>
                      {tradingEnabled ? 'Confirmation required' : 'Disabled'}
                    </strong>
                  </div>
                  <div>
                    <span>Analyst</span>
                    <strong>
                      {connection.aiConfigured
                        ? connection.aiStatus || 'AI provider configured'
                        : connection.aiStatus || 'Structured analytics'}
                    </strong>
                  </div>
                </div>
                {connection.error && (
                  <p className="notice">{connection.error}</p>
                )}
                <div className="connection-actions">
                  <Button
                    disabled={Boolean(busy) || !ready}
                    onClick={() => void connect()}
                  >
                    <Link2 />
                    Authorize Binance
                  </Button>
                  <Button
                    variant="outline"
                    disabled={Boolean(busy) || !ready}
                    onClick={() =>
                      void task('verify', async () => {
                        const s = await api<ConnectionStatus>('binance/status');
                        setConnection((c) => ({ ...c, ...s }));
                        if (s.connected)
                          setNotice(
                            `Connection verified. ${s.tools.length} tools discovered.`,
                          );
                        else setNotice(s.error || 'No active authorization.');
                      })
                    }
                  >
                    <RefreshCw className={busy === 'verify' ? 'spin' : ''} />
                    Verify connection
                  </Button>
                  {connection.tokenPresent && (
                    <Button
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void task('disconnect', async () => {
                          await api('binance/disconnect', {});
                          setPortfolio(null);
                          setConnection((c) => ({
                            ...c,
                            connected: false,
                            tokenPresent: false,
                            tools: [],
                          }));
                          await loadRecords();
                        })
                      }
                    >
                      <Unplug />
                      Disconnect
                    </Button>
                  )}
                </div>
                {!connection.oauthReady && (
                  <p className="connection-note">
                    Binance authorization needs Sentinel to be reachable over
                    public HTTPS or registered once by the app builder.
                  </p>
                )}
                <a
                  className="external-link"
                  href="https://developers.binance.com/en/docs/agent-native/mcp-server/agentic"
                  target="_blank"
                  rel="noreferrer"
                >
                  Binance connection documentation <ArrowUpRight size={14} />
                </a>
              </section>
              <div className="integration-grid">
                <section>
                  <div className="section-heading">
                    <h2>Connection milestones</h2>
                  </div>
                  {[
                    ['Market snapshot', Boolean(market && mode === 'live')],
                    ['Binance authorization', connection.tokenPresent],
                    ['MCP tools verified', connection.connected],
                    ['Actual portfolio loaded', Boolean(portfolio)],
                  ].map(([label, done]) => (
                    <div className="milestone" key={String(label)}>
                      {done ? (
                        <CheckCircle2 size={18} className="positive" />
                      ) : (
                        <span className="milestone-circle" />
                      )}
                      <span>{label}</span>
                      <small>{done ? 'Verified' : 'Pending'}</small>
                    </div>
                  ))}
                  <p className="muted-text milestone-note">
                    Track B trade eligibility must be verified through Binance.
                    Sample runs do not qualify as live trades.
                  </p>
                </section>
                <section>
                  <div className="section-heading">
                    <h2>Account controls</h2>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="control-line">
                    <span>Single order cap</span>
                    <b>25 USDT</b>
                  </div>
                  <div className="control-line">
                    <span>Order / portfolio cap</span>
                    <b>5%</b>
                  </div>
                  <div className="control-line">
                    <span>Available USDT reserve</span>
                    <b>20%</b>
                  </div>
                  <div className="control-line">
                    <span>Single-asset exposure cap</span>
                    <b>50%</b>
                  </div>
                  <a
                    className="external-link"
                    href="https://www.binance.com/en/my/sub-account/asset-management/transfer?asset=BTC"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Manage funding on Binance <ArrowUpRight size={14} />
                  </a>
                </section>
              </div>
              {connection.tools.length > 0 && (
                <section className="history-section">
                  <h2>Discovered tools</h2>
                  <div className="tool-list">
                    {connection.tools.map((t) => (
                      <div key={t.name}>
                        <code>{t.name}</code>
                        <span className="pill">
                          {t.readOnly ? 'Read-only' : 'Action'}
                        </span>
                        <p>{t.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section className="history-section">
                <div className="section-heading">
                  <h2>Activity ledger</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Download activity"
                    aria-label="Download activity"
                    onClick={() =>
                      download(
                        'sentinel-activity.json',
                        JSON.stringify(activity, null, 2),
                        'application/json',
                      )
                    }
                  >
                    <ArrowDownToLine />
                  </Button>
                </div>
                {activity.length ? (
                  activity.map((a) => (
                    <div className="activity-row" key={a.id}>
                      <Clock3 size={16} />
                      <div>
                        <strong>{a.action}</strong>
                        <p>{a.detail}</p>
                      </div>
                      <time>{date(a.createdAt)}</time>
                    </div>
                  ))
                ) : (
                  <p className="table-empty">No activity recorded yet.</p>
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Sentinel / Conservative by design
            </span>
            <span>
              {connection.connected
                ? 'Agent OS connected'
                : 'Agent OS not connected'}
            </span>
          </footer>
        </div>
      </main>
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="analyst-dialog">
          <DialogTitle>
            <span className="dialog-heading">
              <Bot size={22} />
              Sentinel analyst
            </span>
          </DialogTitle>
          <DialogDescription>
            {connection.aiConfigured
              ? 'AI analyst with market and portfolio context'
              : connection.aiStatus ||
                'Structured analytics / AI provider not configured'}
          </DialogDescription>
          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}
          <div className="chat-messages" aria-live="polite">
            {!chat.length ? (
              <div className="chat-intro">
                <h2>What needs a closer look?</h2>
                <div className="suggestions">
                  {[
                    `Analyze ${trackedSymbols.map(pairLabel).join(', ')}`,
                    'Review my portfolio exposure',
                    'Develop a conservative strategy',
                  ].map((s) => (
                    <Button
                      variant="outline"
                      key={s}
                      disabled={Boolean(busy) || !market}
                      onClick={() => void ask(s)}
                    >
                      {s}
                      <ArrowUpRight />
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              chat.map((c, i) => (
                <div className="chat-turn" key={i}>
                  <div className="chat-question">{c.message}</div>
                  <div className="chat-answer">
                    <Bot size={16} />
                    <p>{c.answer}</p>
                  </div>
                  <small>{c.engine}</small>
                </div>
              ))
            )}
            {busy === 'chat' && (
              <p className="chat-pending">
                <Loader2 size={16} className="spin" />
                Reviewing available evidence...
              </p>
            )}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <Input
              aria-label="Message Sentinel"
              placeholder="Ask about markets, exposure or a strategy..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
            />
            <Button
              type="submit"
              size="icon"
              title="Send message"
              aria-label="Send message"
              disabled={Boolean(busy) || !message.trim() || !market}
            >
              <Send />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={proposal !== null}
        onOpenChange={(open) => {
          if (!open && proposal && !busy) {
            void api('orders/cancel', { id: proposal.id });
            setProposal(null);
          }
        }}
      >
        <DialogContent className="order-dialog">
          <DialogTitle>Confirm live spot purchase</DialogTitle>
          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}
          <DialogDescription>
            This action spends real funds in your Binance Agentic account.
          </DialogDescription>
          {proposal && (
            <>
              <div className="order-summary">
                <div>
                  <span>Market</span>
                  <b>{proposal.symbol}</b>
                </div>
                <div>
                  <span>Side / type</span>
                  <b>BUY / MARKET</b>
                </div>
                <div>
                  <span>Spend</span>
                  <b>{proposal.quoteOrderQty} USDT</b>
                </div>
                <div>
                  <span>Reference price</span>
                  <b>{money(proposal.referencePrice)} USDT</b>
                </div>
                <div>
                  <span>Expires</span>
                  <b>{date(proposal.expiresAt)}</b>
                </div>
              </div>
              <p className="subtle">
                Final fill price may differ. Exchange fees apply.
              </p>
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  void task('confirm', async () => {
                    const result = await api('orders/confirm', {
                      id: proposal.id,
                      confirmed: true,
                    });
                    setReceipt(result);
                    setProposal(null);
                    setPortfolio(await api<Portfolio>('portfolio'));
                    await loadRecords();
                  })
                }
              >
                {busy === 'confirm' ? <Loader2 className="spin" /> : <Check />}
                Confirm purchase
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
