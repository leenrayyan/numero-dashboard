import { useEffect, useState, useMemo } from "react";
import { Users, DollarSign, Clock, TrendingUp, Megaphone, UserX, Layers, BarChart3, MousePointerClick } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { analytics as analyticsApi, segmentation as segApi, campaigns as campApi } from "../api";
const CROSS_FILTER_STORAGE_KEY = "numero.dashboard.crossFilter";
import KPICard from "../components/KPICard";
import SmartQueryBar from "../components/SmartQueryBar";
import { useGlobalFilter } from "../context/QueryFilterContext";
import {
  PRODUCT_COLORS, KPI, KPI_GRADIENTS, SEGMENT_COLORS, FUNNEL_COLORS, BRAND,
} from "../constants/colors";

const RECENCY_RANGES = {
  "0–3 months":   [0,   90],
  "3–6 months":   [90,  180],
  "6–12 months":  [180, 365],
  "12+ months":   [365, 99999],
};

const QUICK_ACTIONS = [
  { icon: UserX,     label: "Explore & Filter",  desc: "Filter users by segment, country, spend, recency — then send a campaign", to: "/dormant",      color: BRAND.purple },
  { icon: Megaphone, label: "Campaigns",         desc: "Build and send WhatsApp reactivation campaigns to filtered audiences",    to: "/campaigns",    color: BRAND.blue },
  { icon: BarChart3, label: "Segmentation",      desc: "Analyze cluster groups, revenue by segment, and behavioral patterns",     to: "/segmentation", color: BRAND.rose },
  { icon: Layers,    label: "Reports & Exports", desc: "Download CSVs, track campaign delivery, read and conversion rates",       to: "/reports",      color: KPI.indigo },
];

const FUNNEL_STAGES = [
  { key: "targeted",  label: "Targeted",  color: FUNNEL_COLORS.targeted  },
  { key: "sent",      label: "Sent",      color: FUNNEL_COLORS.sent      },
  { key: "delivered", label: "Delivered", color: FUNNEL_COLORS.delivered },
  { key: "read",      label: "Read",      color: FUNNEL_COLORS.read      },
  { key: "replied",   label: "Replied",   color: FUNNEL_COLORS.replied   },
  { key: "converted", label: "Converted", color: FUNNEL_COLORS.converted },
];

// Heatmap helper: maps a numeric value within [min,max] to a soft brand-blue tint.
function heatColor(value, min, max) {
  if (value == null || max === min) return "transparent";
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Soft blue → deeper purple gradient, low opacity so text stays readable.
  const r = Math.round(220 - 120 * t);
  const g = Math.round(228 - 130 * t);
  const b = Math.round(240 - 70  * t);
  return `rgba(${r},${g},${b},${0.35 + 0.55 * t})`;
}

const CustomPieLabel = ({ cx, cy, midAngle, outerRadius, percentage }) => {
  if (percentage < 5) return null;
  const RADIAN = Math.PI / 180;
  const r  = outerRadius + 14;
  const x  = cx + r * Math.cos(-midAngle * RADIAN);
  const y  = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor={x > cx ? "start" : "end"} dominantBaseline="central"
      style={{ fontSize: 13, fill: "#374151", fontWeight: 600 }}>
      {percentage}%
    </text>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    apiParams, filters,
    setSegment: setGlobalSegment,
    setRecency: setGlobalRecency,
    setProductType: setGlobalProductType,
  } = useGlobalFilter();
  const [overview,    setOverview]    = useState(null);
  const [segmentTrend,setSegmentTrend]= useState({ segments: [], data: [] });
  const [recency,     setRecency]     = useState([]);
  const [segments,    setSegments]    = useState([]);
  const [funnel,      setFunnel]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [crossFilter, setCrossFilter] = useState(() => {
    const saved = localStorage.getItem(CROSS_FILTER_STORAGE_KEY);
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    localStorage.setItem(CROSS_FILTER_STORAGE_KEY, String(crossFilter));
  }, [crossFilter]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.overview(apiParams),
      analyticsApi.segmentTrend(apiParams),
      analyticsApi.dormantWeekly(apiParams),
      segApi.overview(apiParams),
      campApi.funnel().catch(() => ({ data: null })),
    ]).then(([ov, st, rc, seg, fn]) => {
      setOverview(ov.data);
      setSegmentTrend(st.data || { segments: [], data: [] });
      setRecency(rc.data);
      setSegments(seg.data.segments || []);
      setFunnel(fn.data);
    }).finally(() => setLoading(false));
  }, [JSON.stringify(apiParams)]);

  // The /api/segmentation endpoint groups by (cluster_id, segment, product_group),
  // which produces multiple rows per segment name. Roll those up here so the donut
  // and heatmap table show real per-segment totals — not per-cluster slivers.
  const segmentTotals = useMemo(() => {
    const totalUsers = segments.reduce((s, r) => s + (r.user_count || 0), 0);
    const byName = new Map();
    for (const r of segments) {
      const cur = byName.get(r.segment) || {
        segment: r.segment, user_count: 0, total_monetary: 0, recencySum: 0, freqSum: 0,
      };
      cur.user_count     += r.user_count || 0;
      cur.total_monetary += r.total_monetary || 0;
      cur.recencySum     += (r.avg_recency || 0) * (r.user_count || 0);
      cur.freqSum        += (r.avg_frequency || 0) * (r.user_count || 0);
      byName.set(r.segment, cur);
    }
    return Array.from(byName.values()).map(r => ({
      segment:        r.segment,
      user_count:     r.user_count,
      percentage:     totalUsers ? +(r.user_count / totalUsers * 100).toFixed(1) : 0,
      total_monetary: Math.round(r.total_monetary),
      avg_revenue:    r.user_count ? +(r.total_monetary / r.user_count).toFixed(2) : 0,
      avg_recency:    r.user_count ? Math.round(r.recencySum / r.user_count) : 0,
      avg_frequency:  r.user_count ? +(r.freqSum / r.user_count).toFixed(1) : 0,
      color:          SEGMENT_COLORS[r.segment] || KPI.purple,
    })).sort((a, b) => b.user_count - a.user_count);
  }, [segments]);

  const productRevenue = useMemo(() => Object.entries(
    segments.reduce((acc, s) => {
      if (s.product_group) acc[s.product_group] = (acc[s.product_group] || 0) + (s.total_monetary || 0);
      return acc;
    }, {})
  ).map(([name, revenue]) => ({ name, revenue: Math.round(revenue) }))
   .sort((a, b) => b.revenue - a.revenue), [segments]);

  // Power BI–style cross-filtering: clicks on visuals push their value into the
  // global filter context (top filter bar reflects the change). Clicking the
  // already-active value toggles it off. Disabled when crossFilter === false.
  function handleSegmentClick(data) {
    if (!crossFilter || !data?.segment) return;
    setGlobalSegment(filters.segment === data.segment ? null : data.segment);
  }

  function handleRecencyClick(data) {
    if (!crossFilter || !data?.week) return;
    const range = RECENCY_RANGES[data.week];
    if (!range) return;
    const isActive = filters.recencyMin === range[0] && filters.recencyMax === range[1];
    setGlobalRecency(isActive ? null : range[0], isActive ? null : range[1]);
  }

  function handleProductClick(data) {
    if (!crossFilter || !data?.name) return;
    setGlobalProductType(filters.productType === data.name ? null : data.name);
  }

  const fmt    = (n) => n != null ? n.toLocaleString() : "—";
  const fmtMon = (n) => n != null ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-gray-800">Overview</h1>
          <p className="text-gray-500 text-lg mt-1">Numero eSIM · Dormant user reactivation analytics</p>
        </div>
        <label
          className={`flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border cursor-pointer select-none transition mt-2 shrink-0 ${
            crossFilter
              ? "bg-purple-50 border-purple-200 text-purple-700"
              : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
          }`}
          title="When on, clicking any chart filters the whole dashboard (Power BI style)."
        >
          <input
            type="checkbox"
            checked={crossFilter}
            onChange={(e) => setCrossFilter(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 accent-purple-600 cursor-pointer"
          />
          <MousePointerClick size={15} />
          Click charts to filter
        </label>
      </div>

      <SmartQueryBar />

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <KPICard title="Dormant Users"  value={loading ? "—" : fmt(overview?.dormant_users)}
          subtitle="total in dataset" icon={Users} gradient={KPI_GRADIENTS.purple} />
        <KPICard title="Total Revenue"  value={loading || !overview?.total_revenue ? "—" : `$${(overview.total_revenue/1000).toFixed(1)}k`}
          subtitle="lifetime spend" icon={DollarSign} gradient={KPI_GRADIENTS.green} />
        <KPICard title="Avg Inactivity" value={loading || !overview?.avg_recency_days ? "—" : `${overview.avg_recency_days}d`}
          subtitle="days since last purchase" icon={Clock} gradient={KPI_GRADIENTS.rose} />
        <KPICard title="Avg Spend/User" value={loading || !overview?.avg_revenue_per_user ? "—" : `$${overview.avg_revenue_per_user}`}
          subtitle="avg lifetime value" icon={TrendingUp} gradient={KPI_GRADIENTS.indigo} />
      </div>

      {/* Row 1: Stacked area trend + Segment donut */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Users by Last Purchase Month</h2>
          <p className="text-base text-gray-400 mb-3">Stacked by segment — when dormant users last transacted</p>
          {loading ? <div className="h-56 animate-pulse bg-gray-50 rounded" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={segmentTrend.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 14, fill: "#6b7280" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 14, fill: "#6b7280" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
                  formatter={(v, n) => [v.toLocaleString(), n]}
                />
                {segmentTrend.segments.map(seg => (
                  <Area
                    key={seg}
                    type="monotone"
                    dataKey={seg}
                    stackId="1"
                    stroke={SEGMENT_COLORS[seg] || KPI.purple}
                    fill={SEGMENT_COLORS[seg] || KPI.purple}
                    fillOpacity={0.85}
                    name={seg}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            {segmentTrend.segments.map(seg => (
              <div key={seg} className="flex items-center gap-2 text-sm text-gray-600">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: SEGMENT_COLORS[seg] || KPI.purple }} />
                {seg}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Segment Distribution</h2>
          <p className="text-base text-gray-400 mb-2">Click a slice to filter by segment</p>
          {loading ? <div className="h-48 animate-pulse bg-gray-50 rounded" /> : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie
                    data={segmentTotals}
                    dataKey="percentage"
                    nameKey="segment"
                    cx="50%" cy="50%"
                    outerRadius={75} innerRadius={42}
                    paddingAngle={1}
                    onClick={handleSegmentClick}
                    style={{ cursor: "pointer" }}
                    labelLine={false}
                    label={CustomPieLabel}
                  >
                    {segmentTotals.map(s => <Cell key={s.segment} fill={s.color} stroke="#fff" strokeWidth={1} />)}
                  </Pie>
                  <Tooltip formatter={(v, n, p) => [`${v}% · ${p.payload.user_count?.toLocaleString()} users`, p.payload.segment]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-3 max-h-40 overflow-y-auto pr-1">
                {segmentTotals.map(s => (
                  <button key={s.segment} onClick={() => handleSegmentClick(s)}
                    className="w-full flex items-center justify-between text-sm hover:bg-gray-50 px-1.5 py-1.5 rounded transition">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-gray-600 truncate">{s.segment}</span>
                    </div>
                    <span className="font-semibold text-gray-700 shrink-0 ml-2">{s.percentage}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Revenue by product + Dormancy distribution + Funnel */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Revenue by Product</h2>
          <p className="text-base text-gray-400 mb-3">Lifetime spend per product group</p>
          {loading ? <div className="h-44 animate-pulse bg-gray-50 rounded" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={productRevenue} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 13, fill: "#6b7280" }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 14, fill: "#6b7280" }} width={80} />
                <Tooltip formatter={v => [`$${v.toLocaleString()}`, "Revenue"]} />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} onClick={handleProductClick} style={{ cursor: "pointer" }}>
                  {productRevenue.map(p => (
                    <Cell key={p.name} fill={PRODUCT_COLORS[p.name] || KPI.purple} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Dormancy Distribution</h2>
          <p className="text-base text-gray-400 mb-3">Click a bar to filter by inactivity period</p>
          {loading ? <div className="h-44 animate-pulse bg-gray-50 rounded" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={recency} onClick={({ activePayload }) => activePayload?.[0] && handleRecencyClick(activePayload[0].payload)}
                style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis dataKey="week" tick={{ fontSize: 14, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 13, fill: "#6b7280" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => [v.toLocaleString(), "Users"]}
                  labelFormatter={l => `${l} — click to filter`} />
                <Bar dataKey="count" fill={BRAND.purple} radius={[4,4,0,0]} name="Users" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Reactivation Funnel</h2>
          <p className="text-base text-gray-400 mb-3">Aggregate across all campaigns</p>
          {loading || !funnel ? (
            <div className="h-44 animate-pulse bg-gray-50 rounded" />
          ) : funnel.targeted === 0 ? (
            <div className="text-base text-gray-400 py-8 text-center">
              No campaigns sent yet.<br />
              <button onClick={() => navigate("/campaigns")} className="text-purple-600 font-medium hover:underline mt-1">
                Create your first campaign →
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {FUNNEL_STAGES.map(stage => {
                const value = funnel[stage.key] || 0;
                const pct = funnel.targeted ? (value / funnel.targeted * 100) : 0;
                const convPct = stage.key !== "targeted" && funnel.targeted
                  ? ((value / funnel.targeted) * 100).toFixed(1) : null;
                return (
                  <div key={stage.key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-600 font-medium">{stage.label}</span>
                      <span className="text-gray-500">
                        <span className="font-semibold text-gray-800">{value.toLocaleString()}</span>
                        {convPct && <span className="ml-2 text-gray-400">{convPct}%</span>}
                      </span>
                    </div>
                    <div className="h-3.5 rounded-sm bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-sm transition-all"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: stage.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Segment heatmap table — Coupler-style data exploration */}
      <div className="card mb-5 overflow-hidden">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-semibold text-gray-800 text-xl">Segment Breakdown</h2>
          <span className="text-sm text-gray-400">Click a row to filter — heatmap shows relative scale</span>
        </div>
        <p className="text-base text-gray-400 mb-3">Behavioral and revenue metrics per segment</p>
        {loading ? <div className="h-40 animate-pulse bg-gray-50 rounded" /> : (
          <SegmentHeatmapTable rows={segmentTotals} onRowClick={handleSegmentClick} />
        )}
      </div>

      {/* Quick Actions */}
      <h2 className="font-semibold text-gray-700 mb-3 text-lg">Quick Navigation</h2>
      <div className="grid grid-cols-4 gap-3">
        {QUICK_ACTIONS.map(({ icon: Icon, label, desc, to, color }) => (
          <button key={label} onClick={() => navigate(to)}
            className="card text-left hover:shadow-md transition-all hover:-translate-y-0.5 p-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ backgroundColor: color + "18" }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div className="font-semibold text-gray-800 text-base mb-1">{label}</div>
            <p className="text-gray-500 text-sm leading-relaxed mb-2">{desc}</p>
            <span className="text-sm font-semibold" style={{ color }}>Open →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SegmentHeatmapTable({ rows, onRowClick }) {
  // Per-column min/max so each metric gets its own heatmap scale.
  const ranges = useMemo(() => {
    const cols = ["user_count", "percentage", "avg_revenue", "total_monetary", "avg_recency", "avg_frequency"];
    const r = {};
    for (const c of cols) {
      const values = rows.map(row => row[c] || 0);
      r[c] = { min: Math.min(...values), max: Math.max(...values) };
    }
    return r;
  }, [rows]);

  const cell = (value, col, format = (v) => v) => (
    <td className="px-3 py-3 text-right text-base text-gray-700 tabular-nums"
      style={{ backgroundColor: heatColor(value, ranges[col].min, ranges[col].max) }}>
      {format(value)}
    </td>
  );

  const fmtN  = (n) => n.toLocaleString();
  const fmt$  = (n) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const fmt$2 = (n) => `$${n.toFixed(2)}`;
  const fmtP  = (n) => `${n}%`;
  const fmtD  = (n) => `${n}d`;

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-sm text-gray-500 uppercase tracking-wide">
            <th className="px-3 py-2.5 text-left font-semibold">Segment</th>
            <th className="px-3 py-2.5 text-right font-semibold">Users</th>
            <th className="px-3 py-2.5 text-right font-semibold">Share</th>
            <th className="px-3 py-2.5 text-right font-semibold">Avg Spend</th>
            <th className="px-3 py-2.5 text-right font-semibold">Total Revenue</th>
            <th className="px-3 py-2.5 text-right font-semibold">Avg Recency</th>
            <th className="px-3 py-2.5 text-right font-semibold">Avg Purchases</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.segment}
              onClick={() => onRowClick(r)}
              className="border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer transition-colors">
              <td className="px-3 py-3 text-base text-gray-800 font-medium whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                  {r.segment}
                </div>
              </td>
              {cell(r.user_count,     "user_count",     fmtN)}
              {cell(r.percentage,     "percentage",     fmtP)}
              {cell(r.avg_revenue,    "avg_revenue",    fmt$2)}
              {cell(r.total_monetary, "total_monetary", fmt$)}
              {cell(r.avg_recency,    "avg_recency",    fmtD)}
              {cell(r.avg_frequency,  "avg_frequency",  (n) => n.toFixed(1))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
