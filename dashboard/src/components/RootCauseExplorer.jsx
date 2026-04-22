import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, TrendingDown, ArrowRight } from 'lucide-react';

const pct = (v, dp = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
const abs$ = (v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`;
const flag = (v, bad) => bad ? (v < -0.05 ? 'text-[#FF385C]' : v > 0.05 ? 'text-[#34D399]' : 'text-[#8B8D9E]')
                              : (v > 0.05 ? 'text-[#FF385C]' : v < -0.05 ? 'text-[#34D399]' : 'text-[#8B8D9E]');

function EvidenceRow({ label, pre, post, pctVal, isAlarm, flip = false }) {
  const cls = flip ? flag(pctVal, false) : flag(pctVal, true);
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1E2030] last:border-0">
      <span className="text-[#8B8D9E] text-xs">{label}</span>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-[#4A4D60]">{pre}</span>
        <ArrowRight size={10} className="text-[#4A4D60]" />
        <span className="text-white font-medium">{post}</span>
        <span className={`font-semibold min-w-[44px] text-right ${cls}`}>
          {pct(pctVal)}
        </span>
        {isAlarm && Math.abs(pctVal) > 0.1 && (
          <AlertTriangle size={12} className="text-[#FF385C] flex-shrink-0" />
        )}
      </div>
    </div>
  );
}

function Step({ step, isOpen, onToggle }) {
  const statusColor = step.isAlarm ? 'border-l-[#FF385C] bg-[#FF385C]/5'
                    : step.isOk    ? 'border-l-[#34D399] bg-[#34D399]/5'
                    :                'border-l-[#1E2030] bg-transparent';
  const badgeColor  = step.isAlarm ? 'bg-[#FF385C]/15 text-[#FF385C]'
                    : step.isOk    ? 'bg-[#34D399]/15 text-[#34D399]'
                    :                'bg-[#1E2030] text-[#8B8D9E]';

  return (
    <div className={`border-l-2 rounded-r-lg mb-2 ${statusColor} transition-all`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${badgeColor}`}>
          {step.badge}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">{step.title}</div>
          <div className="text-xs text-[#8B8D9E] mt-0.5 truncate">{step.subtitle}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {step.isAlarm && <AlertTriangle size={14} className="text-[#FF385C]" />}
          {step.isOk    && <CheckCircle   size={14} className="text-[#34D399]" />}
          {isOpen ? <ChevronDown size={14} className="text-[#8B8D9E]" />
                  : <ChevronRight size={14} className="text-[#8B8D9E]" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4">
          <div className="bg-[#0A0B0F] rounded-lg p-3 border border-[#1E2030]">
            {step.rows.map((r, i) => (
              <EvidenceRow key={i} {...r} />
            ))}
          </div>
          {step.insight && (
            <p className="mt-3 text-xs text-[#8B8D9E] leading-relaxed italic">
              {step.insight}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RootCauseExplorer({ dx }) {
  const [open, setOpen] = useState(0);
  const toggle = (i) => setOpen(open === i ? -1 : i);

  const steps = [
    {
      badge: '① GBV',
      title: 'Gross Booking Value Decomposition',
      subtitle: `GBV ${pct(dx.gbv.pct)} · Bookings driving it`,
      isAlarm: true,
      rows: [
        { label: 'Gross Booking Value / day', pre: abs$(dx.gbv.pre), post: abs$(dx.gbv.post), pctVal: dx.gbv.pct, isAlarm: true },
        { label: 'Bookings / day',            pre: Math.round(dx.bk.pre), post: Math.round(dx.bk.post),   pctVal: dx.bk.pct,  isAlarm: true },
        { label: 'Avg Booking Value',         pre: `$${dx.abv.pre.toFixed(0)}`, post: `$${dx.abv.post.toFixed(0)}`, pctVal: dx.abv.pct, isAlarm: false, flip: true },
      ],
      insight: 'Bookings are down while ABV is up (nightly rate rose). Bookings are the culprit — drill into what drives them.',
    },
    {
      badge: '② Bookings',
      title: 'Sessions vs Conversion',
      subtitle: `Sessions ${pct(dx.ses.pct)} · Conversion ${pct(dx.conv.pct)}`,
      isAlarm: true,
      rows: [
        { label: 'Daily Sessions',    pre: `${(dx.ses.pre / 1000).toFixed(0)}K`,  post: `${(dx.ses.post / 1000).toFixed(0)}K`,  pctVal: dx.ses.pct,  isAlarm: false },
        { label: 'Booking Conversion', pre: `${(dx.conv.pre * 100).toFixed(2)}%`, post: `${(dx.conv.post * 100).toFixed(2)}%`, pctVal: dx.conv.pct, isAlarm: true },
      ],
      insight: 'Sessions are flat — this is not a demand problem. The pipeline is getting traffic, it just is not converting. Drill into the funnel stages.',
    },
    {
      badge: '③ Funnel',
      title: 'Funnel Stage Break: Click → Book',
      subtitle: `Click-to-book ${pct(dx.cb.pct)} · Upper stages flat`,
      isAlarm: true,
      rows: [
        { label: 'Search → Listing View', pre: `${dx.sv.pre.toFixed ? (dx.sv.pre * 100).toFixed(1) : '?'}%`, post: `${(dx.sv.post * 100).toFixed(1)}%`, pctVal: dx.sv.pct, isAlarm: false },
        { label: 'View → Click',          pre: `${(dx.vc.pre * 100).toFixed(1)}%`,  post: `${(dx.vc.post * 100).toFixed(1)}%`,  pctVal: dx.vc.pct,  isAlarm: false },
        { label: 'Click → Book ⚡',       pre: `${(dx.cb.pre * 100).toFixed(1)}%`,  post: `${(dx.cb.post * 100).toFixed(1)}%`,  pctVal: dx.cb.pct,  isAlarm: true },
      ],
      insight: 'Users are finding and clicking listings — but they are abandoning at the booking step. They are seeing something they dislike on the listing page. Price is the prime suspect.',
    },
    {
      badge: '④ Price',
      title: 'Price Competitiveness Gap',
      subtitle: `Airbnb rate ${pct(dx.nr.pct)} · Hotel index ${pct(dx.hi.pct)}`,
      isAlarm: true,
      rows: [
        { label: 'Airbnb Nightly Rate',    pre: `$${dx.nr.pre.toFixed(0)}`,  post: `$${dx.nr.post.toFixed(0)}`,  pctVal: dx.nr.pct,  isAlarm: true, flip: true },
        { label: 'Competitor Hotel Index', pre: `$${dx.hi.pre.toFixed(0)}`,  post: `$${dx.hi.post.toFixed(0)}`,  pctVal: dx.hi.pct,  isAlarm: false },
        { label: 'Price Gap (Airbnb / Hotel)', pre: `${dx.pg.pre.toFixed(3)}`, post: `${dx.pg.post.toFixed(3)}`, pctVal: dx.pg.pct,  isAlarm: true, flip: true },
      ],
      insight: 'PRICE_ALGO_V12 deployed Apr 2 pushed London nightly rates +14.7% while the hotel index moved +0.4%. The competitiveness gap widened ~14%, making Airbnb materially more expensive vs hotels.',
    },
    {
      badge: '⑤ Isolate',
      title: 'City Isolation Check',
      subtitle: `Anomaly is London-specific · Other EU metros stable`,
      isOk: true,
      rows: [
        { label: 'London bookings',         pre: Math.round(dx.bk.pre), post: Math.round(dx.bk.post), pctVal: dx.bk.pct, isAlarm: true },
        { label: 'Other EU cities bookings', pre: '—', post: 'stable', pctVal: 0, isAlarm: false },
      ],
      insight: `Cities on the same V12 deploy (Paris, Amsterdam) were unaffected — their hotel baselines absorbed the rate lift. London's lower hotel baseline made it uniquely vulnerable. This rules out global platform bugs or macro demand shifts. Stable cities: ${dx.stableCities.join(', ')}.`,
    },
  ];

  return (
    <div>
      {steps.map((step, i) => (
        <Step key={i} step={step} isOpen={open === i} onToggle={() => toggle(i)} />
      ))}
    </div>
  );
}
