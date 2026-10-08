"use client";
import { tcl } from "@/lib/title-case";

/**
 * Small, dependency-free charts for the Accounting screens (8 Oct 2026).
 * Drawn to scale in SVG; colours come from the caller, text from the theme.
 */

const short = (centavos: number) => { const p = centavos / 100; return p >= 1e6 ? `₱${(p / 1e6).toFixed(1)}M` : p >= 1e3 ? `₱${(p / 1e3).toFixed(0)}k` : `₱${p.toFixed(0)}`; };
const full = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(centavos / 100);

/** Grouped bars over labelled buckets, with a y-axis in pesos. */
export function BarChart({ labels, series, label }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; label: string }) {
  const W = 560, H = 220, L = 52, B = 28, T = 12, R = 8, n = Math.max(1, labels.length);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
  const gw = (W - L - R) / n, bw = Math.max(3, Math.min(24, (gw - 6) / Math.max(1, series.length)));
  const every = Math.ceil(n / 12);
  return <div className="ch">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => { const y = H - B - ((H - B - T) * i) / 4; return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} className="ch-grid" /><text x={L - 6} y={y + 4} textAnchor="end" className="ch-axis">{short((top * i) / 4)}</text></g>; })}
      {labels.map((lb, i) => { const x0 = L + gw * i + (gw - bw * series.length) / 2; return <g key={lb + i}>
        {series.map((s, j) => { const h = ((H - B - T) * (s.values[i] ?? 0)) / top; return <rect key={s.name} x={x0 + j * bw} y={H - B - h} width={bw - 1} height={h} rx={2} fill={s.color}><title>{`${s.name} · ${lb}: ${full(s.values[i] ?? 0)}`}</title></rect>; })}
        {i % every === 0 && <text x={L + gw * i + gw / 2} y={H - 8} textAnchor="middle" className="ch-axis">{lb}</text>}
      </g>; })}
    </svg>
    <div className="ch-legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
  </div>;
}

/** A ring with percentages beside it. */
export function Donut({ parts, label }: { parts: { name: string; color: string; value: number }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0), r = 70, c = 2 * Math.PI * r;
  let offset = 0;
  return <div className="ch ch-donut">
    <svg viewBox="0 0 200 200" role="img" aria-label={label}>
      <circle r={r} cx={100} cy={100} fill="none" className="ch-track" strokeWidth={26} />
      {total > 0 && parts.filter((p) => p.value > 0).map((p) => { const len = (c * p.value) / total; const el = <circle key={p.name} r={r} cx={100} cy={100} fill="none" stroke={p.color} strokeWidth={26} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)"><title>{`${p.name}: ${full(p.value)}`}</title></circle>; offset += len; return el; })}
      <text x={100} y={97} textAnchor="middle" className="ch-big">{short(total)}</text>
      <text x={100} y={115} textAnchor="middle" className="ch-axis">total</text>
    </svg>
    <ul>{parts.map((p) => <li key={p.name}><span><i style={{ background: p.color }} />{p.name}</span><b>{total ? Math.round((100 * p.value) / total) : 0}%</b></li>)}</ul>
  </div>;
}

/** Labelled horizontal bars, longest first as given. */
export function HBars({ rows }: { rows: { name: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <div className="ch ch-hbars">{rows.map((r) => <div key={r.name}>
    <div className="ch-hrow"><span>{tcl(r.name)}</span><b>{full(r.value)}</b></div>
    <div className="ch-hbar"><div style={{ width: `${(100 * r.value) / max}%`, background: r.color ?? "#0571D0" }} /></div>
  </div>)}</div>;
}
