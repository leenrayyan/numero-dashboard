import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { segmentation as segApi } from "../api";
import SmartQueryBar from "../components/SmartQueryBar";
import { useGlobalFilter } from "../context/QueryFilterContext";

const METRIC_TABS = [
  { key: "avg_revenue",   label: "Avg Spend",     prefix: "$", suffix: "" },
  { key: "avg_recency",   label: "Avg Inactivity", prefix: "",  suffix: "d" },
  { key: "avg_frequency", label: "Avg Purchases",  prefix: "",  suffix: "x" },
  { key: "avg_aov",       label: "Avg AOV",        prefix: "$", suffix: "" },
];

export default function Segmentation() {
  const navigate = useNavigate();
  const { apiParams, setSegment: setGlobalSegment, filters } = useGlobalFilter();
  const [data,      setData]      = useState(null);
  const [revenue,   setRevenue]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [metricKey, setMetricKey] = useState("avg_revenue");

  useEffect(() => {
    setLoading(true);
    Promise.all([segApi.overview(apiParams), segApi.revenue(apiParams)])
      .then(([seg, rev]) => { setData(seg.data); setRevenue(rev.data); })
      .finally(() => setLoading(false));
  }, [JSON.stringify(apiParams)]);

  const segments = data?.segments || [];
  const activeMetric = METRIC_TABS.find(m => m.key === metricKey);

  function handleSegmentClick(seg) {
    if (!seg) return;
    setGlobalSegment(seg);
    navigate("/dormant");
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">User Segmentation</h1>
        <p className="text-gray-500 text-sm">
          {data?.total_users ? `${data.total_users.toLocaleString()} users across ${segments.length} segments` : "Analyze cluster groups and behaviors"}
        </p>
      </div>

      <SmartQueryBar />

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4 mb-4">

        {/* Pie — clickable */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-1">Segment Distribution</h2>
          <p className="text-xs text-gray-400 mb-3">Click a slice → explore those users</p>
          {loading ? <div className="h-60 animate-pulse bg-gray-100 rounded" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={segments}
                  dataKey="user_count"
                  nameKey="segment"
                  cx="50%" cy="50%"
                  outerRadius={95} innerRadius={40}
                  onClick={(d) => handleSegmentClick(d?.segment)}
                  style={{ cursor: "pointer" }}
                >
                  {segments.map(s => (
                    <Cell
                      key={s.segment}
                      fill={s.color}
                      opacity={!filters.segment || filters.segment === s.segment ? 1 : 0.3}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, n, p) => [
                    `${p.payload.user_count?.toLocaleString()} users (${p.payload.percentage}%)`,
                    p.payload.segment,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Revenue bar — clickable */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-1">Total Revenue by Segment</h2>
          <p className="text-xs text-gray-400 mb-3">Click a bar → explore those users</p>
          {loading ? <div className="h-60 animate-pulse bg-gray-100 rounded" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={revenue} margin={{ bottom: 40 }}
                onClick={({ activePayload }) => activePayload?.[0] && handleSegmentClick(activePayload[0].payload.segment)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="segment" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => [`$${v.toLocaleString()}`, "Revenue"]} cursor={{ fill: "#E5DCF4" }} />
                <Bar dataKey="revenue" radius={[4,4,0,0]} name="Revenue" style={{ cursor: "pointer" }}>
                  {revenue.map(r => {
                    const seg = segments.find(s => s.segment === r.segment);
                    return <Cell key={r.segment} fill={seg?.color || "#5B3A9E"} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Metric comparison chart */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-gray-700">Segment Comparison</h2>
            <p className="text-xs text-gray-400 mt-0.5">Click a bar → explore those users</p>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {METRIC_TABS.map(m => (
              <button
                key={m.key}
                onClick={() => setMetricKey(m.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  metricKey === m.key ? "bg-white shadow text-purple-700" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {loading ? <div className="h-44 animate-pulse bg-gray-100 rounded" /> : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={segments} margin={{ bottom: 40 }}
              onClick={({ activePayload }) => activePayload?.[0] && handleSegmentClick(activePayload[0].payload.segment)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="segment" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }}
                tickFormatter={v => `${activeMetric.prefix}${v}${activeMetric.suffix}`} />
              <Tooltip
                formatter={v => [`${activeMetric.prefix}${Number(v).toLocaleString()}${activeMetric.suffix}`, activeMetric.label]}
                cursor={{ fill: "#E5DCF4" }}
              />
              <Bar dataKey={metricKey} radius={[4,4,0,0]} name={activeMetric.label} style={{ cursor: "pointer" }}>
                {segments.map(s => (
                  <Cell
                    key={s.segment}
                    fill={s.color}
                    opacity={!filters.segment || filters.segment === s.segment ? 1 : 0.35}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Segment cards */}
      <h2 className="font-semibold text-gray-700 mb-3">Segment Details</h2>
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-44 animate-pulse bg-gray-100" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {segments.map(s => (
            <div
              key={s.segment}
              className="card hover:shadow-md transition-shadow"
              style={{ borderLeft: `3px solid ${s.color}` }}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <div>
                    <span className="font-semibold text-gray-800 text-sm">{s.segment}</span>
                    {s.product_group && (
                      <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {s.product_group}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-lg font-bold shrink-0" style={{ color: s.color }}>{s.percentage}%</span>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-4">
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Users</div>
                  <div className="font-bold text-sm text-gray-800">{s.user_count.toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Avg Spend</div>
                  <div className="font-bold text-sm text-gray-800">${s.avg_revenue}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Inactivity</div>
                  <div className="font-bold text-sm text-gray-800">{s.avg_recency}d</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-0.5">Purchases</div>
                  <div className="font-bold text-sm text-gray-800">{s.avg_frequency}x</div>
                </div>
              </div>

              <button
                onClick={() => handleSegmentClick(s.segment)}
                className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${s.color}cc, ${s.color})` }}
              >
                Explore these users →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
