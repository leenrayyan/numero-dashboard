import { useEffect, useState, useMemo } from "react";
import { Users, DollarSign, Clock, TrendingUp, Megaphone, UserX, Layers, BarChart3, MousePointerClick } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { analytics as analyticsApi, segmentation as segApi, campaigns as campApi, users as usersApi } from "../api";
const CROSS_FILTER_STORAGE_KEY = "numero.dashboard.crossFilter";
import KPICard from "../components/KPICard";
import SmartQueryBar from "../components/SmartQueryBar";
import { useGlobalFilter } from "../context/QueryFilterContext";
import {
  PRODUCT_COLORS, KPI, KPI_GRADIENTS, SEGMENT_COLORS, FUNNEL_COLORS, BRAND,
} from "../constants/colors";

// Keys must match the bucket strings emitted by /api/analytics/dormant-weekly
// (analytics.py:120). Mismatch silently disables the click-to-filter handler.
const RECENCY_RANGES = {
  "0-90d":    [0,   90],
  "90-180d":  [90,  180],
  "180-365d": [180, 365],
  "365d+":    [365, 99999],
};

const QUICK_ACTIONS = [
  { icon: UserX,     label: "Explore & Filter",  desc: "Browse segments, filter users by country/spend/recency, drill into clusters", to: "/dormant",   color: BRAND.purple },
  { icon: Megaphone, label: "Campaigns",         desc: "Build and send WhatsApp reactivation campaigns to filtered audiences",        to: "/campaigns", color: BRAND.blue },
  { icon: Layers,    label: "Reports & Exports", desc: "Download CSVs, track campaign delivery, read and conversion rates",           to: "/reports",   color: KPI.indigo },
];

const FUNNEL_STAGES = [
  { key: "targeted",  label: "Targeted",  color: FUNNEL_COLORS.targeted  },
  { key: "sent",      label: "Sent",      color: FUNNEL_COLORS.sent      },
  { key: "delivered", label: "Delivered", color: FUNNEL_COLORS.delivered },
  { key: "read",      label: "Read",      color: FUNNEL_COLORS.read      },
  { key: "replied",   label: "Replied",   color: FUNNEL_COLORS.replied   },
  { key: "converted", label: "Converted", color: FUNNEL_COLORS.converted },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    apiParams, filters,
    setRecency: setGlobalRecency,
    setProductType: setGlobalProductType,
    setSegment,
  } = useGlobalFilter();
  const [overview,    setOverview]    = useState(null);
  const [segmentTrend,setSegmentTrend]= useState({ segments: [], data: [] });
  const [topCountries,setTopCountries]= useState([]);
  const [recentCampaigns, setRecentCampaigns] = useState([]);
  const [recency,     setRecency]     = useState([]);
  const [segments,    setSegments]    = useState([]);
  const [funnel,      setFunnel]      = useState(null);
  const [reactDist,   setReactDist]   = useState(null);
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
      analyticsApi.reactivationDist(apiParams).catch(() => ({ data: null })),
      usersApi.countries().catch(() => ({ data: [] })),
      campApi.list({ page: 1, page_size: 5 }).catch(() => ({ data: { campaigns: [] } })),
    ]).then(([ov, st, rc, seg, fn, rd, ct, cmp]) => {
      setOverview(ov.data);
      setSegmentTrend(st.data || { segments: [], data: [] });
      setRecency(rc.data);
      setSegments(seg.data.segments || []);
      setFunnel(fn.data);
      setReactDist(rd.data);
      setTopCountries((ct.data || []).slice(0, 6));
      setRecentCampaigns(cmp.data?.campaigns || cmp.data || []);
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
  function handleRecencyClick(data) {
    if (!crossFilter || !data?.week) return;
    const range = RECENCY_RANGES[data.week];
    if (!range) return;
    const isActive = filters.recencyMin === range[0] && filters.recencyMax === range[1];
    setGlobalRecency(isActive ? null : range[0], isActive ? null : range[1]);
  }

  function handleSegmentClick(data) {
    if (!crossFilter || !data?.segment) return;
    const cur = filters.segment ?? [];
    setSegment(cur.includes(data.segment)
      ? cur.filter(s => s !== data.segment)
      : [...cur, data.segment]);
  }

  function handleProductClick(data) {
    if (!crossFilter || !data?.name) return;
    const cur = filters.productType ?? [];
    setGlobalProductType(cur.includes(data.name)
      ? cur.filter(p => p !== data.name)
      : [...cur, data.name]);
  }

  const fmt    = (n) => n != null ? n.toLocaleString() : "—";
  const fmtMon = (n) => n != null ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-gray-800">Home</h1>
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

      {/* Act 2 — How users have churned over time + where they live.
          The area chart is visually rich (segment colours over months) and
          tells a TIME story, not an exploration story; the Top Countries
          panel adds the geographic dimension. */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <div className="flex items-baseline justify-between mb-1">
            <div>
              <h2 className="font-semibold text-gray-800 text-xl">Dormancy timeline</h2>
              <p className="text-sm text-gray-400 mt-0.5">Users by last purchase month, stacked by segment</p>
            </div>
            <button
              onClick={() => navigate("/dormant")}
              className="text-sm font-medium text-purple-600 hover:text-purple-800 transition"
            >
              Explore segments →
            </button>
          </div>
          {loading ? <div className="h-56 animate-pulse bg-gray-50 rounded" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={segmentTrend.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6b7280" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
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
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 text-xs">
            {segmentTrend.segments.slice(0, 8).map(seg => (
              <div key={seg} className="flex items-center gap-1.5 text-gray-600">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEGMENT_COLORS[seg] || KPI.purple }} />
                <span className="truncate max-w-[160px]" title={seg}>{seg}</span>
              </div>
            ))}
            {segmentTrend.segments.length > 8 && (
              <span className="text-gray-400 italic">+ {segmentTrend.segments.length - 8} more</span>
            )}
          </div>
        </div>

        {/* Top countries panel — gives a geographic answer without duplicating
            the audience-breakdown panel that lives on /dormant. */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl">Top countries</h2>
          <p className="text-sm text-gray-400 mt-0.5 mb-3">Where the dormant base lives</p>
          {loading ? <div className="h-56 animate-pulse bg-gray-50 rounded" /> : (
            <div className="space-y-2">
              {topCountries.map(c => {
                const max = topCountries[0]?.count || 1;
                const pct = (c.count / max) * 100;
                const total = overview?.dormant_users || 1;
                const share = (c.count / total) * 100;
                return (
                  <div key={c.country} className="flex items-center gap-2 text-sm">
                    <div className="w-20 truncate text-gray-700" title={c.country}>{c.country}</div>
                    <div className="flex-1 h-5 bg-gray-50 rounded-sm overflow-hidden">
                      <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: BRAND.purple, opacity: 0.85 }} />
                    </div>
                    <div className="w-20 text-right tabular-nums text-xs text-gray-500">
                      {c.count.toLocaleString()}<span className="text-gray-400 ml-1">{share.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Segment donut + Revenue by product + Dormancy distribution + Funnel */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Segment distribution</h2>
          <p className="text-base text-gray-400 mb-3">Click a slice to filter by segment</p>
          {loading ? <div className="h-44 animate-pulse bg-gray-50 rounded" /> : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie
                    data={segmentTotals}
                    dataKey="user_count"
                    nameKey="segment"
                    cx="50%" cy="50%"
                    outerRadius={70} innerRadius={40}
                    paddingAngle={1}
                    onClick={handleSegmentClick}
                    style={{ cursor: "pointer" }}
                  >
                    {segmentTotals.map(s => (
                      <Cell
                        key={s.segment}
                        fill={s.color}
                        stroke="#fff"
                        strokeWidth={1}
                        fillOpacity={
                          (filters.segment?.length ?? 0) === 0 || filters.segment.includes(s.segment) ? 1 : 0.25
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, _n, p) => [`${p.payload.percentage}% · ${v.toLocaleString()} users`, p.payload.segment]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2 max-h-32 overflow-y-auto pr-1">
                {segmentTotals.map(s => {
                  const active = filters.segment?.includes(s.segment);
                  return (
                    <button
                      key={s.segment}
                      onClick={() => handleSegmentClick(s)}
                      className={`w-full flex items-center justify-between text-xs px-1.5 py-1 rounded transition ${
                        active ? "bg-purple-50" : "hover:bg-gray-50"
                      }`}
                      title={s.segment}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-gray-600 truncate" title={s.segment}>{s.segment}</span>
                      </div>
                      <span className="font-semibold text-gray-700 shrink-0 ml-2">{s.percentage}%</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Revenue by product</h2>
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
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Dormancy distribution</h2>
          <p className="text-base text-gray-400 mb-3">Click a bar to filter by inactivity period</p>
          {loading ? <div className="h-44 animate-pulse bg-gray-50 rounded" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={recency} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis dataKey="week" tick={{ fontSize: 14, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 13, fill: "#6b7280" }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => [v.toLocaleString(), "Users"]}
                  labelFormatter={l => `${l} — click to filter`} />
                <Bar dataKey="count" fill={BRAND.purple} radius={[4,4,0,0]} name="Users"
                  onClick={(payload) => handleRecencyClick(payload)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-800 text-xl mb-1">Reactivation funnel</h2>
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

      {/* Reactivation Score Distribution — answers "what does the average score actually mean".
          Most dormant users score low (won't come back); the small high-scoring tail is
          where campaigns pay off. */}
      <div className="card mb-4">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-semibold text-gray-800 text-xl">Reactivation score distribution</h2>
          <span className="text-sm text-gray-400">Higher = more likely to reactivate without intervention</span>
        </div>
        <p className="text-base text-gray-400 mb-3">
          ML model predictions across all dormant users. Target the right tail for highest-ROI campaigns.
        </p>
        {loading || !reactDist ? (
          <div className="h-44 animate-pulse bg-gray-50 rounded" />
        ) : reactDist.scored === 0 ? (
          <div className="text-base text-gray-400 py-8 text-center">No scored users yet.</div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-3">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={reactDist.buckets} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} />
                  <YAxis tick={{ fontSize: 13, fill: "#6b7280" }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip
                    formatter={(v) => [v.toLocaleString(), "Users"]}
                    labelFormatter={(l) => `Score ${l}`}
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
                  />
                  <Bar dataKey="users" radius={[4, 4, 0, 0]} name="Users">
                    {reactDist.buckets.map((b, i) => {
                      // Color graduates: rose at low scores → coral mid → green at high
                      const color = i >= 7 ? "#4FA88C" : i >= 4 ? "#D8896B" : "#C56988";
                      return <Cell key={b.bucket} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col justify-center gap-3 text-sm">
              <DistStat
                label="Top 10% likely"
                value={reactDist.buckets.slice(7).reduce((s, b) => s + b.users, 0).toLocaleString()}
                hint="Score ≥ 70%"
                tone="emerald"
              />
              <DistStat
                label="Mid tier (40–70%)"
                value={reactDist.buckets.slice(4, 7).reduce((s, b) => s + b.users, 0).toLocaleString()}
                hint="Worth a campaign nudge"
                tone="amber"
              />
              <DistStat
                label="Active (no score)"
                value={reactDist.null_count.toLocaleString()}
                hint="Already engaged — no reactivation needed"
                tone="emerald-light"
              />
            </div>
          </div>
        )}
      </div>

      {/* Recent campaigns — operational pulse: what's actually running right now,
          with the live delivery / read / converted counts pulled from the WA-bot
          webhook stats. Empty state nudges the user to build a campaign. */}
      <div className="card mb-5">
        <div className="flex items-baseline justify-between mb-1">
          <div>
            <h2 className="font-semibold text-gray-800 text-xl">Recent campaigns</h2>
            <p className="text-sm text-gray-400 mt-0.5">Latest sends with delivery and conversion stats</p>
          </div>
          <button
            onClick={() => navigate("/campaigns")}
            className="text-sm font-medium text-purple-600 hover:text-purple-800 transition"
          >
            All campaigns →
          </button>
        </div>
        {loading ? (
          <div className="h-32 animate-pulse bg-gray-50 rounded mt-3" />
        ) : recentCampaigns.length === 0 ? (
          <div className="text-sm text-gray-400 italic py-8 text-center">
            No campaigns yet. Build one from the Campaigns page or filter users on the Explore page and click "Create Campaign".
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1 mt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left px-3 py-2 font-semibold">Name</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-right px-3 py-2 font-semibold">Targeted</th>
                  <th className="text-right px-3 py-2 font-semibold">Sent</th>
                  <th className="text-right px-3 py-2 font-semibold">Delivered</th>
                  <th className="text-right px-3 py-2 font-semibold">Read</th>
                  <th className="text-right px-3 py-2 font-semibold">Converted</th>
                  <th className="text-right px-3 py-2 font-semibold">Conv. rate</th>
                </tr>
              </thead>
              <tbody>
                {recentCampaigns.slice(0, 5).map(c => {
                  const sent = c.sent_count ?? 0;
                  const conv = c.converted_count ?? 0;
                  const rate = sent ? (conv / sent * 100).toFixed(1) : "—";
                  const statusTone = ({
                    sent:      "bg-emerald-50 text-emerald-700",
                    completed: "bg-emerald-50 text-emerald-700",
                    sending:   "bg-blue-50 text-blue-700",
                    queued:    "bg-amber-50 text-amber-700",
                    draft:     "bg-gray-100 text-gray-600",
                  }[c.status] || "bg-gray-100 text-gray-600");
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition">
                      <td className="px-3 py-2.5 font-medium text-gray-800">
                        <button onClick={() => navigate("/campaigns")} className="hover:underline">{c.name}</button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusTone}`}>{c.status}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{(c.total_targeted ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{sent.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{(c.delivered_count ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{(c.read_count ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{conv.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-purple-700">{rate === "—" ? "—" : `${rate}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <h2 className="font-semibold text-gray-700 mb-3 text-lg">Quick Navigation</h2>
      <div className="grid grid-cols-3 gap-3">
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

function DistStat({ label, value, hint, tone }) {
  const palette = {
    emerald:       { bg: "bg-emerald-50",  text: "text-emerald-700", num: "text-emerald-800" },
    "emerald-light": { bg: "bg-emerald-50/60", text: "text-emerald-600", num: "text-emerald-700" },
    amber:         { bg: "bg-amber-50",    text: "text-amber-700",   num: "text-amber-800" },
    rose:          { bg: "bg-rose-50",     text: "text-rose-700",    num: "text-rose-800" },
  }[tone] ?? { bg: "bg-gray-50", text: "text-gray-600", num: "text-gray-800" };
  return (
    <div className={`rounded-lg p-3 ${palette.bg}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${palette.text}`}>{label}</div>
      <div className={`text-2xl font-bold ${palette.num} mt-0.5`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}
