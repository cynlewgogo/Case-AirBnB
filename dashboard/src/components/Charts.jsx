import {
  AreaChart, Area, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts';
import { CITY_COLORS, ANOMALY_DATE, CITIES } from '../data/index.js';

// ── Shared tooltip style ─────────────────────────────────────────────────────
const tooltipStyle = {
  backgroundColor: '#1A1D27',
  border: '1px solid #1E2030',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#F0F0F0',
};
const labelStyle = { color: '#8B8D9E', marginBottom: 4, fontWeight: 600 };

const fmt$ = (v) => v >= 1000000
  ? `$${(v / 1000000).toFixed(2)}M`
  : `$${(v / 1000).toFixed(0)}K`;

const shortDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

// ── Multi-city GBV time series ────────────────────────────────────────────────
export function CityGBVChart({ data }) {
  const ticks = data.filter(d => d.dayIndex % 15 === 0).map(d => d.date);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="londonGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FF385C" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#FF385C" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#1E2030" vertical={false} />

        <ReferenceArea
          x1={ANOMALY_DATE}
          x2={data[data.length - 1]?.date}
          fill="#FF385C"
          fillOpacity={0.04}
          strokeOpacity={0}
        />
        <ReferenceLine
          x={ANOMALY_DATE}
          stroke="#FF385C"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          label={{ value: 'V12 Deploy', position: 'insideTopRight', fill: '#FF385C', fontSize: 10 }}
        />

        <XAxis
          dataKey="date"
          ticks={ticks}
          tickFormatter={shortDate}
          tick={{ fill: '#8B8D9E', fontSize: 11 }}
          axisLine={{ stroke: '#1E2030' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmt$}
          tick={{ fill: '#8B8D9E', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          labelFormatter={shortDate}
          formatter={(v, name) => [fmt$(v), name]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: '#8B8D9E', paddingTop: 8 }}
        />

        {/* London gets an area fill + thicker line to highlight the anomaly */}
        <Area
          type="monotone"
          dataKey="London"
          stroke="#FF385C"
          strokeWidth={2.5}
          fill="url(#londonGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#FF385C' }}
        />
        {CITIES.filter(c => c !== 'London').map(city => (
          <Line
            key={city}
            type="monotone"
            dataKey={city}
            stroke={CITY_COLORS[city]}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Price Competitiveness: nightly rate vs hotel index ────────────────────────
export function PriceCompChart({ data }) {
  const ticks = data.filter(d => d.dayIndex % 15 === 0).map(d => d.date);
  const postData = data.filter(d => d.date >= ANOMALY_DATE);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gapGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FF385C" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#FF385C" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#1E2030" vertical={false} />

        <ReferenceArea
          x1={ANOMALY_DATE}
          x2={data[data.length - 1]?.date}
          fill="#FF385C"
          fillOpacity={0.05}
          strokeOpacity={0}
        />
        <ReferenceLine
          x={ANOMALY_DATE}
          stroke="#FF385C"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          label={{ value: 'Apr 2 — V12 Deploy', position: 'insideTopRight', fill: '#FF385C', fontSize: 10 }}
        />

        <XAxis
          dataKey="date"
          ticks={ticks}
          tickFormatter={shortDate}
          tick={{ fill: '#8B8D9E', fontSize: 11 }}
          axisLine={{ stroke: '#1E2030' }}
          tickLine={false}
        />
        <YAxis
          domain={['auto', 'auto']}
          tickFormatter={(v) => `$${v}`}
          tick={{ fill: '#8B8D9E', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          labelFormatter={shortDate}
          formatter={(v, name) => [`$${v.toFixed(0)}`, name]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: '#8B8D9E', paddingTop: 8 }}
        />

        <Line
          type="monotone"
          dataKey="nightlyRate"
          name="Airbnb Nightly Rate"
          stroke="#FF385C"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#FF385C' }}
        />
        <Line
          type="monotone"
          dataKey="hotelIndex"
          name="Competitor Hotel Index"
          stroke="#8B8D9E"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Funnel stage bar chart (pre vs post) ─────────────────────────────────────
export function FunnelStageChart({ funnel }) {
  const data = [
    { stage: 'Search→View', pre: funnel.pre.searchToView, post: funnel.post.searchToView },
    { stage: 'View→Click',  pre: funnel.pre.viewToClick,  post: funnel.post.viewToClick },
    { stage: 'Click→Book',  pre: funnel.pre.clickToBook,  post: funnel.post.clickToBook },
  ];

  return (
    <ResponsiveContainer width="100%" height={130}>
      <ComposedChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
        <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fill: '#8B8D9E', fontSize: 10 }}
          axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="stage" tick={{ fill: '#8B8D9E', fontSize: 11 }}
          axisLine={false} tickLine={false} width={88} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => [`${v.toFixed(1)}%`, name === 'pre' ? 'Pre-deploy' : 'Post-deploy']}
        />
        <Line type="monotone" dataKey="pre" name="pre" stroke="#4A4D60" strokeWidth={0} dot={{ fill: '#4A4D60', r: 5 }} />
        <Line type="monotone" dataKey="post" name="post" stroke="#FF385C" strokeWidth={0} dot={{ fill: '#FF385C', r: 5 }} />
        {/* Background bars for reference */}
        <Area type="monotone" dataKey="pre" stroke="none" fill="#4A4D60" fillOpacity={0.25} />
        <Area type="monotone" dataKey="post" stroke="none" fill="#FF385C" fillOpacity={0.35} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
