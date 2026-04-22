/**
 * Client-side mirror of the Python pipeline:
 *   generate_data → detect → diagnose
 * Produces all data structures needed by the dashboard.
 */

// ── Constants ────────────────────────────────────────────────────────────────
export const CITIES = ['London', 'Paris', 'New York', 'Tokyo', 'Berlin'];
export const ANOMALY_CITY = 'London';
export const ANOMALY_DAY = 61; // day index (0-based); Jan 1 + 61 = Mar 3 2026
export const ANOMALY_DATE = '2026-03-03';
export const DETECTION_DATE = '2026-03-04';
export const DAYS = 90;

export const CITY_COLORS = {
  London: '#FF385C',
  Paris: '#818CF8',
  'New York': '#34D399',
  Tokyo: '#F59E0B',
  Berlin: '#60A5FA',
};

const BASELINES = {
  London:     { sessions: 52000, nightlyRate: 185, hotelIndex: 210 },
  Paris:      { sessions: 48000, nightlyRate: 175, hotelIndex: 195 },
  'New York': { sessions: 61000, nightlyRate: 230, hotelIndex: 260 },
  Tokyo:      { sessions: 34000, nightlyRate: 140, hotelIndex: 165 },
  Berlin:     { sessions: 22000, nightlyRate: 120, hotelIndex: 140 },
};

// ── Seeded PRNG (Park-Miller LCG, seed = 7) ─────────────────────────────────
let _seed = 7;
const rand = () => {
  _seed = Math.imul(_seed, 16807) % 2147483647;
  if (_seed <= 0) _seed += 2147483646;
  return (_seed - 1) / 2147483646;
};
const resetSeed = () => { _seed = 7; };
const uniform = (a, b) => a + (b - a) * rand();
const noise = (scale = 0.03) => 1 + uniform(-scale, scale);
const weekdayEffect = (d) => 1 + 0.05 * Math.sin(2 * Math.PI * d.getDay() / 7);
const fmt = (d) => d.toISOString().slice(0, 10);
const r2 = (v) => Math.round(v * 100) / 100;

// ── Data generation ──────────────────────────────────────────────────────────
function generateRows() {
  resetSeed();
  const rows = [];
  const startDate = new Date('2026-02-01');

  for (let i = 0; i < DAYS; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);

    for (const city of CITIES) {
      const b = BASELINES[city];
      const sessions = Math.round(b.sessions * weekdayEffect(d) * noise(0.04));
      let viewRate  = 0.62 * noise(0.02);
      let clickRate = 0.28 * noise(0.02);
      let bookRate  = 0.11 * noise(0.03);
      let nightlyRate = b.nightlyRate * noise(0.015);
      let hotelIndex  = b.hotelIndex  * noise(0.01);
      let algo = 'V11';

      if (city === ANOMALY_CITY && i >= ANOMALY_DAY) {
        nightlyRate *= 1.15;
        bookRate    *= 0.60;
        algo = 'V12';
      }

      const views    = Math.round(sessions * viewRate);
      const clicks   = Math.round(views * clickRate);
      const bookings = Math.round(clicks * bookRate);
      const nights   = 3.4 * noise(0.02);
      const abv = nightlyRate * nights;
      const gbv = bookings * abv;

      rows.push({
        date: fmt(d), dayIndex: i, city,
        sessions, views, clicks, bookings,
        nightlyRate: r2(nightlyRate),
        nightsPerBooking: r2(nights),
        avgBookingValue: r2(abv),
        gbv: r2(gbv),
        hotelIndex: r2(hotelIndex),
        algo,
      });
    }
  }
  return rows;
}

// ── Anomaly detection (rolling z-score) ─────────────────────────────────────
const DETECT_WINDOW = 21;
const MIN_HIST = 14;
const Z_THRESH = 2.5;
const DETECT_METRICS = ['gbv', 'bookings', 'sessions', 'nightlyRate', 'avgBookingValue', 'clicks', 'views'];

function detectAnomalies(rows) {
  const series = {};
  for (const r of rows) {
    for (const m of DETECT_METRICS) {
      const k = `${r.city}||${m}`;
      (series[k] ??= []).push([r.date, r[m]]);
    }
  }

  const alerts = [];
  for (const [k, s] of Object.entries(series)) {
    const [city, metric] = k.split('||');
    s.sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = MIN_HIST; i < s.length; i++) {
      const win = s.slice(Math.max(0, i - DETECT_WINDOW), i).map(x => x[1]);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const std  = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length) || 1e-9;
      const z    = (s[i][1] - mean) / std;
      const pct  = (s[i][1] - mean) / mean;
      if (Math.abs(z) >= Z_THRESH) {
        alerts.push({ city, metric, date: s[i][0], actual: s[i][1], mean, std, z, pct,
          severity: Math.abs(z) * Math.abs(pct) });
      }
    }
  }
  return alerts.sort((a, b) => b.severity - a.severity);
}

// ── Diagnosis (deterministic tree walk) ─────────────────────────────────────
function split14(cityRows, metric, breakDate) {
  const pre  = cityRows.filter(r => r.date < breakDate).slice(-14).map(r => r[metric]);
  const post = cityRows.filter(r => r.date >= breakDate).slice(0, 14).map(r => r[metric]);
  const preMean  = pre.reduce((a, b) => a + b, 0) / (pre.length  || 1);
  const postMean = post.reduce((a, b) => a + b, 0) / (post.length || 1);
  return { pre: preMean, post: postMean, pct: (postMean - preMean) / preMean };
}

function diagnose(rows, city, breakDate) {
  const cr = rows.filter(r => r.city === city).sort((a, b) => a.date.localeCompare(b.date));
  const s = (m) => split14(cr, m, breakDate);

  const gbv = s('gbv');
  const bk  = s('bookings');
  const abv = s('avgBookingValue');
  const ses = s('sessions');
  const vw  = s('views');
  const cl  = s('clicks');
  const nr  = s('nightlyRate');
  const hi  = s('hotelIndex');

  // Derived rates
  const conv = { pre: bk.pre / ses.pre, post: bk.post / ses.post };
  conv.pct = (conv.post - conv.pre) / conv.pre;

  const sv = { pre: vw.pre / ses.pre, post: vw.post / ses.post };
  sv.pct = (sv.post - sv.pre) / sv.pre;

  const vc = { pre: cl.pre / vw.pre, post: cl.post / vw.post };
  vc.pct = (vc.post - vc.pre) / vc.pre;

  const cb = { pre: bk.pre / cl.pre, post: bk.post / cl.post };
  cb.pct = (cb.post - cb.pre) / cb.pre;

  const pg = { pre: nr.pre / hi.pre, post: nr.post / hi.post };
  pg.pct = (pg.post - pg.pre) / pg.pre;

  // Other cities isolation
  const otherCities = CITIES.filter(c => c !== city);
  const stableCities = otherCities.filter(c => {
    const other = rows.filter(r => r.city === c);
    const ob = split14(other, 'bookings', breakDate);
    return Math.abs(ob.pct) < 0.05;
  });

  return { gbv, bk, abv, ses, vw, cl, nr, hi, conv, sv, vc, cb, pg, stableCities };
}

// ── Main export ──────────────────────────────────────────────────────────────
let _cache = null;

export function getDashboardData() {
  if (_cache) return _cache;

  const rows = generateRows();
  const alerts = detectAnomalies(rows);
  const dx = diagnose(rows, ANOMALY_CITY, ANOMALY_DATE);

  // Group by city
  const byCity = {};
  for (const city of CITIES) {
    byCity[city] = rows.filter(r => r.city === city).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Multi-city GBV time series for the line chart
  const dateMap = {};
  for (const r of rows) {
    if (!dateMap[r.date]) dateMap[r.date] = { date: r.date, dayIndex: r.dayIndex };
    dateMap[r.date][r.city] = r.gbv;
    dateMap[r.date].global = ((dateMap[r.date].global) || 0) + r.gbv;
  }
  const multiCityTimeSeries = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  // Price competition time series for London
  const priceTimeSeries = byCity[ANOMALY_CITY].map(r => ({
    date: r.date, dayIndex: r.dayIndex,
    nightlyRate: r.nightlyRate,
    hotelIndex: r.hotelIndex,
    priceGap: r2(r.nightlyRate / r.hotelIndex),
  }));

  // Latest z-score heatmap: one value per (city, metric)
  const heatmap = {};
  for (const city of CITIES) {
    heatmap[city] = {};
    for (const m of DETECT_METRICS) {
      const cityAlerts = alerts.filter(a => a.city === city && a.metric === m);
      if (cityAlerts.length > 0) {
        const latest = cityAlerts.sort((a, b) => b.date.localeCompare(a.date))[0];
        heatmap[city][m] = { z: latest.z, pct: latest.pct, isAlert: true };
      } else {
        heatmap[city][m] = { z: 0, pct: 0, isAlert: false };
      }
    }
  }

  // Funnel stage values pre/post for London
  const funnel = {
    pre: {
      searchToView: r2(dx.sv.pre * 100),
      viewToClick:  r2(dx.vc.pre * 100),
      clickToBook:  r2(dx.cb.pre * 100),
      conversion:   r2(dx.conv.pre * 100),
    },
    post: {
      searchToView: r2(dx.sv.post * 100),
      viewToClick:  r2(dx.vc.post * 100),
      clickToBook:  r2(dx.cb.post * 100),
      conversion:   r2(dx.conv.post * 100),
    },
    delta: {
      searchToView: dx.sv.pct,
      viewToClick:  dx.vc.pct,
      clickToBook:  dx.cb.pct,
      conversion:   dx.conv.pct,
    },
  };

  // Top-level KPIs
  const londonRows = byCity[ANOMALY_CITY];
  const preRows    = londonRows.filter(r => r.date <  ANOMALY_DATE).slice(-14);
  const postRows   = londonRows.filter(r => r.date >= ANOMALY_DATE).slice(0, 14);
  const avg = (arr, fn) => arr.reduce((s, r) => s + fn(r), 0) / (arr.length || 1);

  const globalPreGBV  = CITIES.reduce((s, c) =>
    s + avg(byCity[c].filter(r => r.date < ANOMALY_DATE).slice(-14), r => r.gbv), 0);
  const globalPostGBV = CITIES.reduce((s, c) =>
    s + avg(byCity[c].filter(r => r.date >= ANOMALY_DATE).slice(0, 14), r => r.gbv), 0);

  const kpis = {
    globalGBVPre:  r2(globalPreGBV),
    globalGBVPost: r2(globalPostGBV),
    globalGBVPct:  (globalPostGBV - globalPreGBV) / globalPreGBV,
    londonGBVPre:  r2(avg(preRows, r => r.gbv)),
    londonGBVPost: r2(avg(postRows, r => r.gbv)),
    londonGBVPct:  dx.gbv.pct,
    londonBookingsPre:  Math.round(avg(preRows, r => r.bookings)),
    londonBookingsPost: Math.round(avg(postRows, r => r.bookings)),
    londonBookingsPct:  dx.bk.pct,
    londonCBPre:  r2(dx.cb.pre * 100),
    londonCBPost: r2(dx.cb.post * 100),
    londonCBPct:  dx.cb.pct,
    londonRatePre:  r2(dx.nr.pre),
    londonRatePost: r2(dx.nr.post),
    londonRatePct:  dx.nr.pct,
    priceGapPct: dx.pg.pct,
  };

  _cache = { rows, byCity, multiCityTimeSeries, priceTimeSeries, alerts, dx, funnel, heatmap, kpis };
  return _cache;
}
