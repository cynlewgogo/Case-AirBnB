import { useMemo, useState } from 'react';
import {
  AlertTriangle, TrendingDown, TrendingUp, Activity,
  DollarSign, Users, Zap, Clock, CheckCircle, X,
  BarChart2, GitBranch, Search, Map,
} from 'lucide-react';
import { getDashboardData, CITY_COLORS, CITIES, ANOMALY_DATE } from './data/index.js';
import { CityGBVChart, PriceCompChart as PriceChart, FunnelStageChart } from './components/Charts.jsx';
import { RootCauseExplorer } from './components/RootCauseExplorer.jsx';

// ── Utilities ────────────────────────────────────────────────────────────────
const fmt$ = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(2)}M`
                  : v >= 1000    ? `$${(v / 1000).toFixed(0)}K`
                  :                `$${v.toFixed(0)}`;
const fmtPct = (v, digits = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
const fmtN = (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v));

// ── Primitive components ─────────────────────────────────────────────────────
function Card({ children, className = '', glow = false }) {
  return (
    <div className={`bg-[#111218] border border-[#1E2030] rounded-xl ${glow ? 'ring-1 ring-[#FF385C]/30 shadow-[0_0_24px_rgba(255,56,92,0.08)]' : ''} ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={14} className="text-[#8B8D9E]" />
      <span className="text-xs font-semibold text-[#8B8D9E] uppercase tracking-widest">{label}</span>
    </div>
  );
}

function Delta({ value, inverse = false, size = 'sm' }) {
  const isNeg = value < 0;
  const isBad = inverse ? !isNeg : isNeg;
  const color = Math.abs(value) < 0.005 ? 'text-[#8B8D9E]'
              : isBad ? 'text-[#FF385C]' : 'text-[#34D399]';
  const Icon = isNeg ? TrendingDown : TrendingUp;
  const szCls = size === 'lg' ? 'text-base' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${szCls} ${color}`}>
      <Icon size={size === 'lg' ? 14 : 11} />
      {fmtPct(value)}
    </span>
  );
}

// ── Alert Banner ─────────────────────────────────────────────────────────────
function AlertBanner({ onDismiss }) {
  return (
    <div className="bg-[#FF385C]/10 border-b border-[#FF385C]/30 px-6 py-3 flex items-center gap-4">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-[#FF385C] pulse-red" />
        <span className="text-[#FF385C] text-xs font-bold uppercase tracking-wider">Live Incident</span>
      </div>
      <div className="flex-1 text-sm text-white/90">
        <span className="font-semibold">London GBV tracking −31% below forecast</span>
        <span className="text-white/60 mx-2">·</span>
        <span className="text-white/60">Root cause identified: </span>
        <span className="font-medium text-[#FF385C]">PRICE_ALGO_V12</span>
        <span className="text-white/60"> deployed Mar 3 · Click-to-book conversion −38%</span>
        <span className="text-white/60 mx-2">·</span>
        <span className="text-white/60 text-xs">Detected Mar 4 · Day +1</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#FF385C]/20 text-[#FF385C] font-semibold">HIGH</span>
        <button onClick={onDismiss} className="text-white/40 hover:text-white/70 transition-colors">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, sub, delta, inverse = false, highlight = false, note }) {
  return (
    <Card className={`p-5 ${highlight ? 'glow' : ''}`} glow={highlight}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${highlight ? 'bg-[#FF385C]/15' : 'bg-[#1A1D27]'}`}>
          <Icon size={16} className={highlight ? 'text-[#FF385C]' : 'text-[#8B8D9E]'} />
        </div>
        {delta !== undefined && <Delta value={delta} inverse={inverse} size="sm" />}
      </div>
      <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
      <div className="text-xs text-[#8B8D9E] mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-[#4A4D60] mt-1">{sub}</div>}
      {note && <div className="text-[11px] text-[#FF385C]/70 mt-1 italic">{note}</div>}
    </Card>
  );
}

// ── Anomaly Heatmap ───────────────────────────────────────────────────────────
const HEATMAP_METRICS = [
  { key: 'gbv',             label: 'GBV' },
  { key: 'bookings',        label: 'Bookings' },
  { key: 'nightlyRate',     label: 'Rate' },
  { key: 'avgBookingValue', label: 'ABV' },
  { key: 'sessions',        label: 'Sessions' },
];

function heatColor(z) {
  if (!z || Math.abs(z) < 2.5) return { bg: '#1A1D27', text: '#4A4D60' };
  const abs = Math.abs(z);
  if (z < 0) {
    if (abs > 6) return { bg: 'rgba(255,56,92,0.30)', text: '#FF385C' };
    if (abs > 4) return { bg: 'rgba(255,56,92,0.20)', text: '#FF7A95' };
    return       { bg: 'rgba(255,56,92,0.10)', text: '#FF9EAF' };
  }
  if (abs > 4) return { bg: 'rgba(52,211,153,0.20)', text: '#34D399' };
  return             { bg: 'rgba(52,211,153,0.10)', text: '#6DE4B9' };
}

function AnomalyHeatmap({ heatmap }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left text-[#8B8D9E] font-medium py-2 pr-4 pl-0 w-24">Market</th>
            {HEATMAP_METRICS.map(m => (
              <th key={m.key} className="text-center text-[#8B8D9E] font-medium py-2 px-2">{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CITIES.map(city => (
            <tr key={city} className="border-t border-[#1E2030]">
              <td className="py-2.5 pr-4 pl-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CITY_COLORS[city] }} />
                  <span className="text-white font-medium">{city}</span>
                </div>
              </td>
              {HEATMAP_METRICS.map(m => {
                const cell = heatmap[city]?.[m.key];
                const z = cell?.z ?? 0;
                const { bg, text } = heatColor(z);
                return (
                  <td key={m.key} className="py-2 px-1 text-center">
                    <span
                      className="inline-block w-full rounded-md py-1 px-2 font-mono font-semibold text-[11px]"
                      style={{ backgroundColor: bg, color: text }}
                      title={`z = ${z.toFixed(2)}, ${cell?.pct ? fmtPct(cell.pct) : '—'}`}
                    >
                      {Math.abs(z) < 2.5 ? '—' : z.toFixed(1)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#1E2030]">
        <span className="text-[#4A4D60] text-[10px]">z-score scale:</span>
        {[
          { bg: 'rgba(255,56,92,0.30)', label: 'z < −6', text: '#FF385C' },
          { bg: 'rgba(255,56,92,0.20)', label: 'z < −4', text: '#FF7A95' },
          { bg: 'rgba(255,56,92,0.10)', label: 'z < −2.5', text: '#FF9EAF' },
          { bg: '#1A1D27',              label: 'Normal',    text: '#4A4D60' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.bg, border: '1px solid rgba(255,255,255,0.05)' }} />
            <span className="text-[10px]" style={{ color: s.text }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Metric Funnel ─────────────────────────────────────────────────────────────
function FunnelNode({ level, label, value, delta, isBreak, isLeaf, connector = true }) {
  const indent = `${level * 20}px`;
  return (
    <div className="flex items-center gap-0" style={{ paddingLeft: indent }}>
      {level > 0 && (
        <div className="flex flex-col items-center mr-2 flex-shrink-0">
          <div className="w-px h-3 bg-[#1E2030]" />
          <div className="w-3 h-px bg-[#1E2030]" />
        </div>
      )}
      <div className={`flex items-center justify-between flex-1 py-2 px-3 rounded-lg mb-1 border
        ${isBreak ? 'border-[#FF385C]/40 bg-[#FF385C]/8 shadow-[0_0_12px_rgba(255,56,92,0.1)]'
                  : isLeaf ? 'border-[#1E2030] bg-[#1A1D27]/50'
                           : 'border-[#1E2030] bg-transparent'}`}>
        <div className="flex items-center gap-2">
          {isBreak && <AlertTriangle size={11} className="text-[#FF385C] flex-shrink-0" />}
          <span className={`text-xs font-medium ${isBreak ? 'text-[#FF385C]' : 'text-white'}`}>{label}</span>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <span className={`text-xs font-mono ${isBreak ? 'text-[#FF385C]' : 'text-white'}`}>{value}</span>
          {delta !== undefined && <Delta value={delta} size="sm" />}
        </div>
      </div>
    </div>
  );
}

function MetricFunnel({ kpis, funnel, dx }) {
  return (
    <div className="space-y-0.5">
      <FunnelNode level={0} label="Gross Booking Value / day" value={fmt$(kpis.londonGBVPost)} delta={kpis.londonGBVPct} />
      <FunnelNode level={1} label="Bookings / day"            value={fmtN(kpis.londonBookingsPost)} delta={kpis.londonBookingsPct} />
      <FunnelNode level={2} label="Sessions"                  value={`${(dx.ses.post / 1000).toFixed(0)}K`} delta={dx.ses.pct} />
      <FunnelNode level={2} label="Booking Conversion"        value={`${(dx.conv.post * 100).toFixed(2)}%`} delta={dx.conv.pct} />
      <FunnelNode level={3} label="Search → View"             value={`${(dx.sv.post * 100).toFixed(1)}%`}   delta={dx.sv.pct} />
      <FunnelNode level={3} label="View → Click"              value={`${(dx.vc.post * 100).toFixed(1)}%`}   delta={dx.vc.pct} />
      <FunnelNode level={3} label="Click → Book"              value={`${(dx.cb.post * 100).toFixed(1)}%`}   delta={dx.cb.pct} isBreak />
      <FunnelNode level={4} label="Price Gap vs Hotels"       value={`+${(dx.pg.pct * 100).toFixed(1)}%`}   delta={dx.pg.pct} isBreak isLeaf />
      <FunnelNode level={4} label="Deploy: PRICE_ALGO_V12"    value="Mar 3" isBreak isLeaf />
    </div>
  );
}

// ── Incident Summary ──────────────────────────────────────────────────────────
function IncidentSummary({ kpis, dx }) {
  return (
    <div className="space-y-4">
      {/* Confidence badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#FF385C]/20 text-[#FF385C] tracking-wider uppercase">
          High Confidence
        </span>
        <span className="text-[10px] text-[#8B8D9E]">5/5 diagnostic steps confirmed</span>
      </div>

      {/* Summary */}
      <p className="text-sm text-[#D0D0D0] leading-relaxed">
        London GBV is tracking{' '}
        <span className="text-[#FF385C] font-semibold">{fmtPct(kpis.londonGBVPct)}</span> below forecast.
        Root cause: <span className="text-white font-semibold">PRICE_ALGO_V12</span> deployed{' '}
        <span className="text-white font-semibold">March 3</span> raised London median nightly rate{' '}
        <span className="text-[#FF385C] font-semibold">{fmtPct(dx.nr.pct)}</span> while the hotel index
        moved <span className="font-semibold text-white">{fmtPct(dx.hi.pct)}</span>.
      </p>

      <p className="text-sm text-[#D0D0D0] leading-relaxed">
        Click-to-book conversion has dropped{' '}
        <span className="text-[#FF385C] font-semibold">{fmtPct(dx.cb.pct)}</span> and is the sole driver.
        Sessions, reviews, and availability are unchanged.
        Paris and Amsterdam received the same deploy but are unaffected.
      </p>

      {/* Impact metrics */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'GBV Impact / day', value: `${fmt$(Math.abs(dx.gbv.post - dx.gbv.pre))} lost`, color: '#FF385C' },
          { label: 'Conversion drop', value: fmtPct(dx.cb.pct), color: '#FF385C' },
          { label: 'Price gap opened', value: fmtPct(dx.pg.pct), color: '#F59E0B' },
          { label: 'Cities affected', value: '1 of 5', color: '#8B8D9E' },
        ].map(m => (
          <div key={m.label} className="bg-[#1A1D27] rounded-lg p-3 border border-[#1E2030]">
            <div className="text-xs text-[#8B8D9E]">{m.label}</div>
            <div className="text-sm font-bold mt-0.5" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Suggested action */}
      <div className="bg-[#00A699]/10 border border-[#00A699]/30 rounded-lg p-3">
        <div className="text-xs font-semibold text-[#00A699] mb-1">Suggested Next Step</div>
        <p className="text-xs text-[#D0D0D0] leading-relaxed">
          Roll back or re-scope <span className="font-semibold text-white">PRICE_ALGO_V12</span> for London only.
          Validate that other EU-metro cities on the same deploy have absorbed the rate lift without conversion damage.
        </p>
      </div>

      {/* Timeline */}
      <div className="space-y-1.5">
        {[
          { date: 'Mar 3', label: 'PRICE_ALGO_V12 deployed (scope: EU-metro)', status: 'alarm' },
          { date: 'Mar 4', label: 'System detected GBV anomaly (z = −7.8)', status: 'warn' },
          { date: 'Mar 4', label: 'Root cause identified: pricing competitiveness', status: 'warn' },
          { date: 'Mar 31', label: 'Monitoring window ends — issue remains visible', status: 'info' },
        ].map((ev, i) => (
          <div key={i} className="flex items-start gap-3 text-xs">
            <span className="text-[#4A4D60] flex-shrink-0 w-10 pt-0.5">{ev.date}</span>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1
              ${ev.status === 'alarm' ? 'bg-[#FF385C]' : ev.status === 'warn' ? 'bg-[#F59E0B]' : 'bg-[#8B8D9E]'}`} />
            <span className="text-[#D0D0D0]">{ev.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const data = useMemo(() => getDashboardData(), []);
  const { multiCityTimeSeries, priceTimeSeries, alerts, dx, funnel, heatmap, kpis } = data;

  return (
    <div className="min-h-screen bg-[#0A0B0F]">
      {/* Alert Banner */}
      {!bannerDismissed && <AlertBanner onDismiss={() => setBannerDismissed(true)} />}

      {/* Header */}
      <header className="border-b border-[#1E2030] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#FF385C] flex items-center justify-center">
              <span className="text-white font-black text-sm">a</span>
            </div>
            <span className="text-white font-semibold text-sm">Analytics Hub</span>
          </div>
          <div className="w-px h-5 bg-[#1E2030]" />
          <span className="text-[#8B8D9E] text-sm">Marketplace Anomaly Detection</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#1A1D27] border border-[#1E2030] rounded-lg px-3 py-1.5">
            <Clock size={12} className="text-[#8B8D9E]" />
            <span className="text-xs text-[#8B8D9E]">Jan 1 – Mar 31, 2026</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#FF385C] bg-[#FF385C]/10 border border-[#FF385C]/30 rounded-lg px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF385C] pulse-red" />
            <span>1 Active Incident</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">

        {/* Row 1: KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          <KPICard
            icon={DollarSign}
            label="Global GBV / day (14-day avg)"
            value={fmt$(kpis.globalGBVPost)}
            delta={kpis.globalGBVPct}
            sub={`Pre-deploy: ${fmt$(kpis.globalGBVPre)}`}
            note="Diluted — London weakness masked globally"
          />
          <KPICard
            icon={DollarSign}
            label="London GBV / day"
            value={fmt$(kpis.londonGBVPost)}
            delta={kpis.londonGBVPct}
            sub={`Pre-deploy: ${fmt$(kpis.londonGBVPre)}`}
            highlight
          />
          <KPICard
            icon={Users}
            label="London Bookings / day"
            value={fmtN(kpis.londonBookingsPost)}
            delta={kpis.londonBookingsPct}
            sub={`Pre-deploy: ${fmtN(kpis.londonBookingsPre)}`}
            highlight
          />
          <KPICard
            icon={Zap}
            label="London Click → Book Rate"
            value={`${kpis.londonCBPost.toFixed(1)}%`}
            delta={kpis.londonCBPct}
            sub={`Pre-deploy: ${kpis.londonCBPre.toFixed(1)}%`}
            highlight
          />
        </div>

        {/* Row 2: Time series (full width) */}
        <Card className="p-6">
          <div className="flex items-start justify-between mb-4">
            <SectionLabel icon={BarChart2} label="Gross Booking Value by City — 90-Day View" />
            <div className="flex items-center gap-4 text-xs text-[#8B8D9E]">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#FF385C] inline-block rounded" />
                London (anomaly)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-px bg-[#FF385C] inline-block" style={{ borderTop: '1px dashed #FF385C' }} />
                V12 deploy Mar 3
              </span>
            </div>
          </div>
          <CityGBVChart data={multiCityTimeSeries} />
        </Card>

        {/* Row 3: Funnel + Heatmap */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5">
            <Card className="p-6 h-full" glow>
              <SectionLabel icon={GitBranch} label="London Metric Funnel" />
              <p className="text-xs text-[#8B8D9E] mb-4">Post-deploy values vs pre-deploy baseline. Red nodes = break points.</p>
              <MetricFunnel kpis={kpis} funnel={funnel} dx={dx} />
            </Card>
          </div>
          <div className="col-span-7">
            <Card className="p-6 h-full">
              <SectionLabel icon={Map} label="Anomaly Heatmap — All Markets" />
              <p className="text-xs text-[#8B8D9E] mb-4">
                Latest z-score per (city, metric). Only London lights up — confirms the issue is market-specific.
              </p>
              <AnomalyHeatmap heatmap={heatmap} />
            </Card>
          </div>
        </div>

        {/* Row 4: Root Cause Explorer + Incident Summary */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-7">
            <Card className="p-6 h-full">
              <SectionLabel icon={Search} label="Root Cause Explorer" />
              <p className="text-xs text-[#8B8D9E] mb-5">
                Deterministic tree-walk from GBV top-node down to the pricing-algo leaf. Click each step to inspect evidence.
              </p>
              <RootCauseExplorer dx={dx} />
            </Card>
          </div>
          <div className="col-span-5">
            <Card className="p-6 h-full" glow>
              <SectionLabel icon={AlertTriangle} label="Incident Summary" />
              <IncidentSummary kpis={kpis} dx={dx} />
            </Card>
          </div>
        </div>

        {/* Row 5: Price Competitiveness chart */}
        <Card className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <SectionLabel icon={Activity} label="London — Price Competitiveness vs Hotel Index" />
              <p className="text-xs text-[#8B8D9E] -mt-2">
                The gap between Airbnb nightly rate and the competitor hotel index is the root signal.
                Airbnb became materially more expensive than hotels on March 3 and stayed that way.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-6">
              <div className="text-xs text-[#8B8D9E] flex items-center gap-1.5">
                <span className="inline-block w-5 h-0.5 bg-[#FF385C] rounded" /> Airbnb Rate
              </div>
              <div className="text-xs text-[#8B8D9E] flex items-center gap-1.5">
                <span className="inline-block w-5 border-t border-dashed border-[#8B8D9E]" /> Hotel Index
              </div>
            </div>
          </div>
          <PriceChart data={priceTimeSeries} />
        </Card>

        {/* Footer */}
        <footer className="border-t border-[#1E2030] pt-6 flex items-center justify-between text-xs text-[#4A4D60]">
          <div>
            Airbnb Marketplace Analytics · Anomaly Detection Dashboard ·
            90-day synthetic dataset (seed = 7) · London PRICE_ALGO_V12 incident
          </div>
          <div className="flex items-center gap-4">
            <span>Detection: rolling 21-day z-score (threshold ≥ 2.5σ)</span>
            <span>·</span>
            <span>Diagnosis: deterministic metric-tree walk</span>
            <span>·</span>
            <a href="https://github.com/cynlewgogo/Case-AirBnB"
               className="text-[#8B8D9E] hover:text-white transition-colors"
               target="_blank" rel="noopener noreferrer">
              GitHub →
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
