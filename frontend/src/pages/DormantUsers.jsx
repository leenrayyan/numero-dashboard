import { useEffect, useState, useCallback } from "react";
import { Users, DollarSign, Clock, TrendingUp, Search, Globe, ChevronDown, ChevronUp, Megaphone, BarChart2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useNavigate } from "react-router-dom";
import { analytics as analyticsApi, users as usersApi, clusters as clustersApi } from "../api";
import KPICard from "../components/KPICard";
import UserTable from "../components/UserTable";
import ClusterScatter from "../components/ClusterScatter";
import SmartQueryBar from "../components/SmartQueryBar";
import Panel from "../components/Panel";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { SEGMENT_COLORS as SEG_COLORS, KPI, KPI_GRADIENTS } from "../constants/colors";

const PRODUCT_TABS = [
  { label: "All Products",   value: null },
  { label: "Calls",          value: "Calls" },
  { label: "Data eSIM",      value: "Data eSIM" },
  { label: "Virtual Number", value: "Virtual Number" },
];

const SEGMENT_OPTIONS = [
  "Calls - High Value Loyal (At Risk)",
  "Calls - Low Value Active",
  "Calls - Frequent Low Spenders (Cooling)",
  "eSIM - High Value Users (At Risk)",
  "eSIM - Mid Value Active",
  "eSIM - Low Value Inactive",
  "Virtual - High Value Loyal (At Risk)",
  "Virtual - Low Value Active",
  "Virtual - Mid Value Inactive",
];

const SEGMENT_COLORS = SEG_COLORS;

export default function DormantUsers() {
  const navigate = useNavigate();
  const {
    filters, apiParams, userApiParams, hasActiveFilter, selectedUserCount,
    setSegment: setGlobalSegment,
    setRecency: setGlobalRecency,
    setCountry: setGlobalCountry,
    setProductType: setGlobalProductType,
    setSpend: setGlobalSpend,
    clearAll,
  } = useGlobalFilter();

  const [overview,      setOverview]      = useState(null);
  const [recencyDist,   setRecencyDist]   = useState([]);
  const [clusterStats,  setClusterStats]  = useState([]);
  const [userList,      setUserList]      = useState({ users: [], total: 0 });
  const [loadingUsers,  setLoadingUsers]  = useState(false);
  const [countries,     setCountries]     = useState([]);
  const [countrySearch, setCountrySearch] = useState("");
  const [showCountryDrop, setShowCountryDrop] = useState(false);
  const [page,          setPage]          = useState(1);
  const [search,        setSearch]        = useState("");
  const [spendInputMin, setSpendInputMin] = useState("");
  const [spendInputMax, setSpendInputMax] = useState("");
  const [ageMin,        setAgeMin]        = useState("");
  const [ageMax,        setAgeMax]        = useState("");
  const [showFilters,   setShowFilters]   = useState(true);

  useEffect(() => {
    usersApi.countries().then(({ data }) => setCountries(data));
  }, []);

  useEffect(() => {
    analyticsApi.overview(apiParams).then(({ data }) => setOverview(data));
    const pgParam = filters.productType ? { product_group: filters.productType } : {};
    clustersApi.list(pgParam).then(({ data }) => setClusterStats(data.clusters || []));
  }, [JSON.stringify(apiParams)]);

  useEffect(() => {
    const buckets = [
      { label: "0–90d",    min: 0,   max: 90    },
      { label: "90–180d",  min: 90,  max: 180   },
      { label: "180–365d", min: 180, max: 365   },
      { label: "365d+",    min: 365, max: 99999 },
    ];
    Promise.all(
      buckets.map(({ label, min, max }) =>
        usersApi.list({ min_recency: min, max_recency: max, page_size: 1, page: 1, ...apiParams })
          .then(({ data }) => ({ label, count: data.total }))
      )
    ).then(setRecencyDist);
  }, [JSON.stringify(apiParams)]);

  const fetchUsers = useCallback(() => {
    setLoadingUsers(true);
    usersApi.list({
      page, page_size: 50,
      ...(search    && { search }),
      ...(ageMin    && { min_age: parseFloat(ageMin) }),
      ...(ageMax    && { max_age: parseFloat(ageMax) }),
      ...userApiParams,
    })
      .then(({ data }) => setUserList(data))
      .finally(() => setLoadingUsers(false));
  }, [page, search, ageMin, ageMax, JSON.stringify(userApiParams)]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function applySpend() {
    setGlobalSpend(
      spendInputMin !== "" ? parseFloat(spendInputMin) : null,
      spendInputMax !== "" ? parseFloat(spendInputMax) : null,
    );
    setPage(1);
  }

  function clearAllFilters() {
    setSearch(""); setPage(1);
    setSpendInputMin(""); setSpendInputMax("");
    setAgeMin(""); setAgeMax("");
    clearAll();
  }

  const hasLocalFilter = search || ageMin || ageMax;
  const filteredCountries = countries.filter(c =>
    c.country?.toLowerCase().includes(countrySearch.toLowerCase())
  );

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Explore Dormant Users</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {overview?.dormant_users?.toLocaleString() ?? "…"} users · filter, explore, select targets
        </p>
      </div>

      <SmartQueryBar />

      {/* Product type tabs */}
      <div className="flex gap-1 mb-5 bg-white rounded-xl p-1 border border-gray-200 w-fit">
        {PRODUCT_TABS.map(({ label, value }) => (
          <button
            key={label}
            onClick={() => { setGlobalProductType(value); setPage(1); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
              filters.productType === value
                ? "bg-purple-600 text-white shadow"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <KPICard title="Total Users"   value={overview?.dormant_users?.toLocaleString() ?? "—"}
          subtitle="matching filters" icon={Users}     gradient={KPI_GRADIENTS.purple} />
        <KPICard title="Total Revenue" value={overview?.total_revenue ? `$${(overview.total_revenue/1000).toFixed(1)}k` : "—"}
          subtitle="lifetime spend" icon={DollarSign} gradient={KPI_GRADIENTS.green} />
        <KPICard title="Avg Recency"   value={overview?.avg_recency_days ? `${overview.avg_recency_days}d` : "—"}
          subtitle="days inactive" icon={Clock} gradient={KPI_GRADIENTS.rose} />
        <KPICard title="Avg Spend"     value={overview?.avg_revenue_per_user ? `$${overview.avg_revenue_per_user}` : "—"}
          subtitle="per user" icon={TrendingUp} gradient={KPI_GRADIENTS.indigo} />
      </div>

      {/* Scatter + side charts */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="col-span-2">
          <ClusterScatter
            selectedSegment={filters.segment}
            onSelectSegment={(seg) => { setGlobalSegment(seg); setPage(1); }}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Panel id="recency-dist" title="Recency Distribution" subtitle="Click a bar to filter">
            <ResponsiveContainer width="100%" height={120}>
              <BarChart
                data={recencyDist}
                margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
                style={{ cursor: "pointer" }}
                onClick={({ activePayload }) => {
                  const d = activePayload?.[0]?.payload;
                  if (!d) return;
                  const ranges = { "0–90d": [0,90], "90–180d": [90,180], "180–365d": [180,365], "365d+": [365,99999] };
                  const r = ranges[d.label];
                  if (r) { setGlobalRecency(r[0], r[1]); setPage(1); }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => [v.toLocaleString(), "Users"]} labelFormatter={l => `${l} — click to filter`} />
                <Bar dataKey="count" fill={KPI.purple} radius={[3,3,0,0]} name="Users" />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel id="segment-list" title="Segments" subtitle="Click to filter">
            <div className="space-y-1.5 overflow-y-auto max-h-44">
              {clusterStats.map(c => (
                <button
                  key={c.segment}
                  onClick={() => { setGlobalSegment(filters.segment === c.segment ? null : c.segment); setPage(1); }}
                  className={`w-full text-left flex items-center justify-between px-2 py-1.5 rounded-lg border text-xs transition ${
                    filters.segment === c.segment ? "border-purple-300 bg-purple-50" : "border-gray-100 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SEGMENT_COLORS[c.segment] || "#888" }} />
                    <span className="font-medium text-gray-700 truncate max-w-[110px]">{c.segment}</span>
                  </div>
                  <span className="text-gray-400 shrink-0">{c.user_count?.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Filter bar — collapsible */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-gray-400" />
            <span className="font-semibold text-gray-700 text-sm">Filters</span>
            {(filters.segment || filters.recencyMin != null || filters.country || filters.spendMin != null || hasLocalFilter) && (
              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">active</span>
            )}
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition"
          >
            {showFilters ? <><ChevronUp size={14} /> Collapse</> : <><ChevronDown size={14} /> Expand</>}
          </button>
        </div>

        {showFilters && (
          <div className="flex gap-3 items-start flex-wrap pt-1">

            {/* Search */}
            <div className="relative min-w-40">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="User ID…"
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-purple-400"
              />
            </div>

            {/* Segment */}
            <select
              value={filters.segment || ""}
              onChange={e => { setGlobalSegment(e.target.value || null); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-400"
            >
              <option value="">All Segments</option>
              {SEGMENT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Recency */}
            <select
              value={filters.recencyMin != null ? `${filters.recencyMin},${filters.recencyMax}` : ""}
              onChange={e => {
                if (!e.target.value) { setGlobalRecency(null, null); return; }
                const [min, max] = e.target.value.split(",").map(Number);
                setGlobalRecency(min, max); setPage(1);
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none"
            >
              <option value="">All Recency</option>
              <option value="0,90">0–90 days</option>
              <option value="90,180">90–180 days</option>
              <option value="180,365">180–365 days</option>
              <option value="365,99999">365+ days</option>
            </select>

            {/* Country */}
            <div className="relative">
              <button
                onClick={() => setShowCountryDrop(v => !v)}
                className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm transition ${
                  filters.country ? "border-purple-300 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <Globe size={14} />
                {filters.country || "Country"}
              </button>
              {showCountryDrop && (
                <div className="absolute z-50 top-10 left-0 bg-white border border-gray-200 rounded-xl shadow-lg w-56 p-2">
                  <input
                    autoFocus
                    value={countrySearch}
                    onChange={e => setCountrySearch(e.target.value)}
                    placeholder="Search country…"
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs mb-2 outline-none"
                  />
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    <button
                      onClick={() => { setGlobalCountry(null); setShowCountryDrop(false); setCountrySearch(""); }}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-gray-50 text-gray-500"
                    >
                      All countries
                    </button>
                    {filteredCountries.map(({ country, count }) => (
                      <button
                        key={country}
                        onClick={() => { setGlobalCountry(country); setShowCountryDrop(false); setCountrySearch(""); setPage(1); }}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-purple-50 flex justify-between ${
                          filters.country === country ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-700"
                        }`}
                      >
                        <span>{country}</span>
                        <span className="text-gray-400">{count.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Spend range */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 font-medium">Spend $</span>
              <input value={spendInputMin} onChange={e => setSpendInputMin(e.target.value)}
                placeholder="Min" className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-purple-400" />
              <span className="text-xs text-gray-400">–</span>
              <input value={spendInputMax} onChange={e => setSpendInputMax(e.target.value)}
                placeholder="Max" className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-purple-400" />
              <button onClick={applySpend}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 rounded-lg transition">
                Apply
              </button>
            </div>

            {/* Age range */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 font-medium">Age</span>
              <input value={ageMin} onChange={e => { setAgeMin(e.target.value); setPage(1); }}
                placeholder="Min" className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-purple-400" />
              <span className="text-xs text-gray-400">–</span>
              <input value={ageMax} onChange={e => { setAgeMax(e.target.value); setPage(1); }}
                placeholder="Max" className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-purple-400" />
            </div>

            {/* Clear */}
            {(search || filters.segment || filters.recencyMin != null || filters.country || filters.spendMin != null || hasLocalFilter) && (
              <button onClick={clearAllFilters}
                className="text-sm text-purple-600 hover:text-purple-800 font-medium self-center">
                Clear all ×
              </button>
            )}
          </div>
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
            <p className="text-sm text-gray-500">Apply filters above to target a specific audience, then send a campaign.</p>
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
