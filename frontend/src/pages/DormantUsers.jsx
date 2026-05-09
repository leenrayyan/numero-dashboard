import { useEffect, useState, useCallback, useMemo } from "react";
import { Search, Megaphone, BarChart2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { analytics as analyticsApi, users as usersApi, segmentation as segApi } from "../api";
import UserTable from "../components/UserTable";
import ClusterScatter from "../components/ClusterScatter";
import AudienceBreakdown from "../components/AudienceBreakdown";
import SegmentStackedBar from "../components/SegmentStackedBar";
import SmartQueryBar from "../components/SmartQueryBar";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { SEGMENT_COLORS } from "../constants/colors";

export default function DormantUsers() {
  const navigate = useNavigate();
  const {
    filters, apiParams, userApiParams, hasActiveFilter,
    setSegment: setGlobalSegment,
    setLasso,
  } = useGlobalFilter();

  const [overview,     setOverview]     = useState(null);
  const [segments,     setSegments]     = useState([]);
  const [userList,     setUserList]     = useState({ users: [], total: 0 });
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState("");
  // Live percentile cutoffs (HIGH / MEDIUM thresholds) for the reactivation
  // badge colours. Fetched once at mount; rarely changes (only on a fresh
  // ingest of new scores), so no need to refetch on every filter change.
  const [reactivationCutoffs, setReactivationCutoffs] = useState(null);

  // Row-level selection — local to this page (does NOT filter the page).
  // Used as the campaign target if any rows are checked at "Create Campaign" time.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggleOne = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Header checkbox → fetch every id_client matching the current filter and
  // populate selectedIds. The endpoint is capped at 300k server-side.
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const selectAllMatching = useCallback(() => {
    setSelectAllLoading(true);
    usersApi.ids({ ...userApiParams, ...(search && { search }) })
      .then(({ data }) => setSelectedIds(new Set(data.ids || [])))
      .finally(() => setSelectAllLoading(false));
  }, [JSON.stringify(userApiParams), search]); // eslint-disable-line

  useEffect(() => {
    analyticsApi.overview(apiParams).then(({ data }) => setOverview(data));
    segApi.overview(apiParams).then(({ data }) => setSegments(data.segments || []));
  }, [JSON.stringify(apiParams)]);

  // Reactivation badge colour cutoffs — fetched once at mount. Doesn't depend
  // on the active filter; the cutoffs reflect the global score distribution.
  useEffect(() => {
    analyticsApi.reactivationCutoffs()
      .then(({ data }) => setReactivationCutoffs(data))
      .catch(() => { /* leave null → ReactivationBadge falls back to defaults */ });
  }, []);

  // Roll up the segmentation API rows into one card per segment name.
  const segmentTotals = useMemo(() => {
    const total = segments.reduce((s, r) => s + (r.user_count || 0), 0);
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
      segment:       r.segment,
      product_group: r.product_group,
      user_count:    r.user_count,
      percentage:    total ? +(r.user_count / total * 100).toFixed(2) : 0,
      avg_revenue:   r.user_count ? +(r.total_monetary / r.user_count).toFixed(2) : 0,
      avg_recency:   r.user_count ? Math.round(r.recencySum / r.user_count) : 0,
      avg_frequency: r.user_count ? +(r.freqSum / r.user_count).toFixed(1) : 0,
      color:         SEGMENT_COLORS[r.segment] || "#6B7280",
    })).sort((a, b) => b.user_count - a.user_count);
  }, [segments]);

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

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Explore Dormant Users</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {overview?.dormant_users?.toLocaleString() ?? "…"} users · filter, explore, select targets
        </p>
      </div>

      <SmartQueryBar />

      {/* Product-type quick-tabs moved into the Cluster Map panel header
          (see ClusterScatter.jsx) — that's the only place the All/Single
          distinction meaningfully changes the view (small multiples vs one
          panel). The page-wide product filter still lives in the global
          filter bar above. */}

      {/* Segment cards — colour-tinted backgrounds so the grid reads visually,
          not as small text on white. Click a card to filter the page by that
          segment. */}
      <div className="card mb-5">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-semibold text-gray-700 text-lg">Segments</h2>
          <span className="text-xs text-gray-400">Click a card to filter the page by that segment</span>
        </div>
        <p className="text-sm text-gray-400 mb-3">All clusters across products with their key metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {segmentTotals.map(s => {
            const active = filters.segment?.includes(s.segment);
            const pctLabel = s.percentage < 0.1 ? `${s.percentage.toFixed(2)}%` : `${s.percentage.toFixed(1)}%`;
            return (
              <button
                key={s.segment}
                onClick={() => {
                  const next = active
                    ? filters.segment.filter(x => x !== s.segment)
                    : [...(filters.segment || []), s.segment];
                  setGlobalSegment(next);
                  setPage(1);
                }}
                className={`text-left rounded-xl transition-all hover:shadow-md p-3 border ${
                  active ? "ring-2" : "border-transparent"
                }`}
                style={{
                  background: `linear-gradient(135deg, ${s.color}14 0%, ${s.color}28 100%)`,
                  borderLeft: `4px solid ${s.color}`,
                  ...(active ? { boxShadow: `0 0 0 2px ${s.color}` } : {}),
                }}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-semibold text-gray-800 text-sm truncate" title={s.segment}>
                      {s.segment}
                    </span>
                  </div>
                  <span
                    className="text-sm font-bold shrink-0 px-1.5 py-0.5 rounded text-white"
                    style={{ backgroundColor: s.color }}
                  >
                    {pctLabel}
                  </span>
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

      {/* Cluster scatter (left, clean canvas) + segment selector & audience
          breakdown (right). The right column is the "explore your audience"
          workspace: pick segments via the stacked bar, then see where they
          live / how they connect / how dormant / how much they spend. */}
      <div className="grid grid-cols-2 gap-4 mb-5 items-stretch">
        <ClusterScatter
          selectedSegment={filters.segment}
          onSelectSegment={(seg) => { setGlobalSegment(seg); setPage(1); }}
        />
        <div className="flex flex-col gap-4 h-full">
          <SegmentStackedBar />
          <AudienceBreakdown className="flex-1" />
        </div>
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

      {/* Campaign + Reports CTA. If the user checked individual rows, those
          take precedence over the filter as the campaign target. */}
      <div
        className={`flex items-center gap-3 mb-4 p-4 rounded-xl border shadow-sm transition-colors ${
          selectedIds.size > 0
            ? "bg-purple-50 border-purple-200"
            : "bg-white border-gray-100"
        }`}
      >
        <div className="flex-1 min-w-0">
          {selectedIds.size > 0 ? (
            <p className="text-sm font-semibold text-purple-900">
              {selectedIds.size.toLocaleString()} user{selectedIds.size === 1 ? "" : "s"} selected
              <button
                onClick={clearSelection}
                className="ml-3 text-xs text-purple-600 hover:text-purple-800 underline font-normal"
              >
                clear selection
              </button>
              <span className="text-purple-700 font-normal ml-2">
                — campaign will target only these users
              </span>
            </p>
          ) : hasActiveFilter ? (
            <p className="text-sm font-semibold text-gray-800">
              {userList.total.toLocaleString()} users match your filters
              <span className="text-gray-400 font-normal ml-2">— ready to target, or check rows below to pick specific users</span>
            </p>
          ) : (
            <p className="text-sm text-gray-500">Apply filters at the top, or check rows in the table to target specific users.</p>
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
          onClick={() => {
            // If rows are checked, override filter with the picked IDs by stuffing
            // them into the existing user_ids filter slot, then navigate.
            if (selectedIds.size > 0) {
              setLasso(Array.from(selectedIds));
            }
            navigate("/campaigns");
          }}
          className={`flex items-center gap-2 text-sm font-semibold px-5 py-2 rounded-xl transition shadow-sm ${
            selectedIds.size > 0 || hasActiveFilter
              ? "bg-purple-600 text-white hover:bg-purple-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
          disabled={selectedIds.size === 0 && !hasActiveFilter}
        >
          <Megaphone size={15} />
          {selectedIds.size > 0
            ? `Create Campaign · ${selectedIds.size.toLocaleString()} selected`
            : hasActiveFilter
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
        // When exactly one product is filtered, the table's recency / spend /
        // purchases columns are that product's per-user values — pass the
        // label so the headers reflect that.
        singleProductLabel={filters.productType?.length === 1 ? filters.productType[0] : null}
        reactivationCutoffs={reactivationCutoffs}
        selectedIds={selectedIds}
        onToggle={toggleOne}
        onSelectAllMatching={selectAllMatching}
        onClearAll={clearSelection}
        selectAllLoading={selectAllLoading}
      />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-xs font-bold text-gray-800 truncate" title={value}>{value}</div>
    </div>
  );
}

