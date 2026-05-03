import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Users, DollarSign, Clock, TrendingUp, Sparkles,
  Search, Megaphone, BarChart2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { analytics as analyticsApi, users as usersApi, segmentation as segApi } from "../api";
import KPICard from "../components/KPICard";
import UserTable from "../components/UserTable";
import ClusterScatter from "../components/ClusterScatter";
import SmartQueryBar from "../components/SmartQueryBar";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { SEGMENT_COLORS, KPI_GRADIENTS } from "../constants/colors";

const PRODUCT_TABS = [
  { label: "All Products",   value: null },
  { label: "Calls",          value: "Calls" },
  { label: "Data eSIM",      value: "Data eSIM" },
  { label: "Virtual Number", value: "Virtual Number" },
];

export default function DormantUsers() {
  const navigate = useNavigate();
  const {
    filters, apiParams, userApiParams, hasActiveFilter,
    setSegment: setGlobalSegment,
    setProductType: setGlobalProductType,
  } = useGlobalFilter();

  const [overview,     setOverview]     = useState(null);
  const [segments,     setSegments]     = useState([]);
  const [userList,     setUserList]     = useState({ users: [], total: 0 });
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState("");

  useEffect(() => {
    analyticsApi.overview(apiParams).then(({ data }) => setOverview(data));
    segApi.overview(apiParams).then(({ data }) => setSegments(data.segments || []));
  }, [JSON.stringify(apiParams)]);

  const fetchUsers = useCallback(() => {
    setLoadingUsers(true);
    usersApi.list({
      page, page_size: 50,
      ...(search && { search }),
      ...userApiParams,
    })
      .then(({ data }) => setUserList(data))
      .finally(() => setLoadingUsers(false));
  }, [page, search, JSON.stringify(userApiParams)]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Roll up the segmentation API rows (which are split by cluster_id × product_group)
  // into one card per segment name, summing counts and weighting averages by user_count.
  const segmentTotals = useMemo(() => {
    const totalUsers = segments.reduce((s, r) => s + (r.user_count || 0), 0);
    const byName = new Map();
    for (const r of segments) {
      const cur = byName.get(r.segment) || {
        segment: r.segment, user_count: 0, total_monetary: 0, recencySum: 0, freqSum: 0,
        product_group: r.product_group,
      };
      cur.user_count     += r.user_count || 0;
      cur.total_monetary += r.total_monetary || 0;
      cur.recencySum     += (r.avg_recency || 0) * (r.user_count || 0);
      cur.freqSum        += (r.avg_frequency || 0) * (r.user_count || 0);
      byName.set(r.segment, cur);
    }
    return Array.from(byName.values()).map(r => ({
      segment:        r.segment,
      product_group:  r.product_group,
      user_count:     r.user_count,
      percentage:     totalUsers ? +(r.user_count / totalUsers * 100).toFixed(1) : 0,
      total_monetary: Math.round(r.total_monetary),
      avg_revenue:    r.user_count ? +(r.total_monetary / r.user_count).toFixed(2) : 0,
      avg_recency:    r.user_count ? Math.round(r.recencySum / r.user_count) : 0,
      avg_frequency:  r.user_count ? +(r.freqSum / r.user_count).toFixed(1) : 0,
      color:          SEGMENT_COLORS[r.segment] || "#6B7280",
    })).sort((a, b) => b.user_count - a.user_count);
  }, [segments]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Explore Dormant Users</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {overview?.dormant_users?.toLocaleString() ?? "…"} users · filter, explore, select targets
        </p>
      </div>

      <SmartQueryBar />

      {/* Product type tabs — these are a quick shortcut for the multi-select Product
          filter in the global bar. Clicking a tab REPLACES whatever's selected;
          "All Products" clears the filter entirely. */}
      <div className="flex gap-1 mb-5 bg-white rounded-xl p-1 border border-gray-200 w-fit">
        {PRODUCT_TABS.map(({ label, value }) => {
          // Tab is "active" when its single value exactly equals the current selection
          // (or both are empty for "All Products").
          const selected = filters.productType ?? [];
          const isAll = value == null;
          const active = isAll
            ? selected.length === 0
            : selected.length === 1 && selected[0] === value;
          return (
            <button
              key={label}
              onClick={() => { setGlobalProductType(value ? [value] : []); setPage(1); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
                active
                  ? "bg-purple-600 text-white shadow"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4 mb-5">
        <KPICard title="Total Users"   value={overview?.dormant_users?.toLocaleString() ?? "—"}
          subtitle="matching filters" icon={Users}     gradient={KPI_GRADIENTS.purple} />
        <KPICard title="Total Revenue" value={overview?.total_revenue ? `$${(overview.total_revenue/1000).toFixed(1)}k` : "—"}
          subtitle="lifetime spend" icon={DollarSign} gradient={KPI_GRADIENTS.green} />
        <KPICard title="Avg Recency"   value={overview?.avg_recency_days ? `${overview.avg_recency_days}d` : "—"}
          subtitle="days inactive" icon={Clock} gradient={KPI_GRADIENTS.rose} />
        <KPICard title="Avg Spend"     value={overview?.avg_revenue_per_user ? `$${overview.avg_revenue_per_user}` : "—"}
          subtitle="per user" icon={TrendingUp} gradient={KPI_GRADIENTS.indigo} />
        <KPICard title="Reactivation Score"
          value={overview?.avg_reactivation_score != null
            ? `${Math.round(overview.avg_reactivation_score * 100)}%`
            : "—"}
          subtitle={overview?.avg_reactivation_score != null
            ? `${overview.scored_users?.toLocaleString() ?? 0} scored`
            : "ML model not ready yet"}
          icon={Sparkles}
          gradient={KPI_GRADIENTS.coral}
          pending={overview != null && overview.avg_reactivation_score == null} />
      </div>

      {/* Segment overview cards — lifted from the deleted Segments page.
          Click a card → applies the segment filter. */}
      <div className="card mb-5">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-semibold text-gray-700 text-lg">Segments</h2>
          <span className="text-xs text-gray-400">Click a card to filter the page by that segment</span>
        </div>
        <p className="text-sm text-gray-400 mb-3">All clusters across products with their key metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {segmentTotals.map(s => {
            const active = filters.segment?.includes(s.segment);
            return (
              <button
                key={s.segment}
                onClick={() => {
                  // Toggle this segment in the multi-select segment filter.
                  const next = active
                    ? filters.segment.filter(x => x !== s.segment)
                    : [...(filters.segment || []), s.segment];
                  setGlobalSegment(next);
                  setPage(1);
                }}
                className={`text-left rounded-xl border transition-shadow hover:shadow-md p-3 ${
                  active ? "ring-2" : "border-gray-100"
                }`}
                style={{
                  borderLeft: `4px solid ${s.color}`,
                  ...(active ? { boxShadow: `0 0 0 2px ${s.color}55` } : {}),
                }}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-semibold text-gray-800 text-sm truncate" title={s.segment}>
                      {s.segment}
                    </span>
                  </div>
                  <span className="text-sm font-bold shrink-0" style={{ color: s.color }}>{s.percentage}%</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  <Stat label="Users"      value={s.user_count.toLocaleString()} />
                  <Stat label="Avg Spend"  value={`$${s.avg_revenue}`} />
                  <Stat label="Inactivity" value={`${s.avg_recency}d`} />
                  <Stat label="Purchases"  value={`${s.avg_frequency}x`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cluster scatter — full width now that the right-column panels are
          retired (they duplicated info that's already in the global filter bar
          and the Segments cards above). */}
      <div className="mb-5">
        <ClusterScatter
          selectedSegment={filters.segment}
          onSelectSegment={(seg) => { setGlobalSegment(seg); setPage(1); }}
        />
      </div>

      {/* User-ID search — the only filter that's local to this page.
          Everything else lives in the global filter bar at the top. */}
      <div className="card mb-4 flex items-center gap-3">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by user ID…"
          className="flex-1 outline-none text-sm placeholder-gray-400"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
        )}
      </div>

      {/* Campaign + Reports CTA */}
      <div className="flex items-center gap-3 mb-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="flex-1 min-w-0">
          {hasActiveFilter ? (
            <p className="text-sm font-semibold text-gray-800">
              {userList.total.toLocaleString()} users match your filters
              <span className="text-gray-400 font-normal ml-2">— ready to target</span>
            </p>
          ) : (
            <p className="text-sm text-gray-500">Apply filters at the top to target a specific audience, then send a campaign.</p>
          )}
        </div>
        <button
          onClick={() => navigate("/reports")}
          className="flex items-center gap-2 text-sm font-medium border border-gray-200 text-gray-600 px-4 py-2 rounded-xl hover:bg-gray-50 transition"
        >
          <BarChart2 size={15} />
          Reports
        </button>
        <button
          onClick={() => navigate("/campaigns")}
          className={`flex items-center gap-2 text-sm font-semibold px-5 py-2 rounded-xl transition shadow-sm ${
            hasActiveFilter
              ? "bg-purple-600 text-white hover:bg-purple-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
          disabled={!hasActiveFilter}
        >
          <Megaphone size={15} />
          {hasActiveFilter
            ? `Create Campaign · ${userList.total.toLocaleString()} users`
            : "Create Campaign"}
        </button>
      </div>

      <UserTable
        users={userList.users}
        loading={loadingUsers}
        total={userList.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
      />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-xs font-bold text-gray-800 truncate" title={value}>{value}</div>
    </div>
  );
}
