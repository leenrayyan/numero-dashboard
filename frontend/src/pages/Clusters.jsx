import { useEffect, useState } from "react";
import { RefreshCw, Loader2, Users } from "lucide-react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { clusters as clustersApi } from "../api";
import UserTable from "../components/UserTable";
import { PALETTE as CLUSTER_COLORS } from "../constants/colors";

function ClusterDot({ cx, cy, fill, onClick }) {
  return <circle cx={cx} cy={cy} r={5} fill={fill} fillOpacity={0.8} stroke={fill} strokeWidth={1} style={{ cursor: "pointer" }} onClick={onClick} />;
}

export default function Clusters() {
  const [clusterData, setClusterData] = useState(null);
  const [selected, setSelected]       = useState(null);   // cluster_id
  const [clusterUsers, setClusterUsers] = useState({ users: [], total: 0 });
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [rerunning, setRerunning]       = useState(false);
  const [nClusters, setNClusters]       = useState(5);
  const [page, setPage]                 = useState(1);

  function load() {
    clustersApi.list().then(({ data }) => setClusterData(data));
  }
  useEffect(load, []);

  useEffect(() => {
    if (selected == null) return;
    setLoadingUsers(true);
    clustersApi.users(selected, { page, page_size: 50 })
      .then(({ data }) => setClusterUsers(data))
      .finally(() => setLoadingUsers(false));
  }, [selected, page]);

  async function handleRerun() {
    setRerunning(true);
    try {
      await clustersApi.rerun(nClusters);
      // Poll until clusters update
      setTimeout(() => { load(); setRerunning(false); }, 3000);
    } catch {
      setRerunning(false);
    }
  }

  const clusters = clusterData?.clusters || [];

  // Build scatter data: one point per cluster (centroid proxy)
  const scatterData = clusters.map((c) => ({
    x: c.avg_days_inactive,
    y: c.avg_revenue,
    cluster_id: c.cluster_id,
    user_count: c.user_count,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Cluster Analysis</h1>
          <p className="text-gray-500 text-sm">ML-derived behavioral clusters of dormant users</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Clusters:</label>
          <input
            type="number" min={2} max={12} value={nClusters}
            onChange={e => setNClusters(Number(e.target.value))}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center outline-none"
          />
          <button
            onClick={handleRerun}
            disabled={rerunning}
            className="btn-primary flex items-center gap-2"
          >
            {rerunning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Re-run Clustering
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Cluster scatter */}
        <div className="card col-span-2">
          <h2 className="font-semibold text-gray-700 mb-1">Cluster Map</h2>
          <p className="text-xs text-gray-400 mb-4">Click a cluster to drill into its users</p>
          {clusters.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-gray-400 text-sm">
              No cluster data yet. Run the algorithm to generate clusters.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="x" name="Days Inactive" label={{ value: "Avg Days Inactive", position: "insideBottom", offset: -5, fontSize: 12 }} tick={{ fontSize: 11 }} />
                <YAxis dataKey="y" name="Avg Revenue"   label={{ value: "Avg Revenue ($)", angle: -90, position: "insideLeft", fontSize: 12 }} tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs shadow">
                        <div className="font-semibold">Cluster {d.cluster_id}</div>
                        <div>{d.user_count} users</div>
                        <div>{d.x}d avg inactive · ${d.y} avg revenue</div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={scatterData}
                  onClick={(d) => { setSelected(d.cluster_id); setPage(1); }}
                  shape={(props) => (
                    <ClusterDot
                      {...props}
                      fill={CLUSTER_COLORS[props.payload.cluster_id % CLUSTER_COLORS.length]}
                      onClick={() => { setSelected(props.payload.cluster_id); setPage(1); }}
                    />
                  )}
                >
                  {scatterData.map((d) => (
                    <Cell
                      key={d.cluster_id}
                      fill={CLUSTER_COLORS[d.cluster_id % CLUSTER_COLORS.length]}
                      stroke={selected === d.cluster_id ? "#000" : "none"}
                      strokeWidth={selected === d.cluster_id ? 2 : 0}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cluster list sidebar */}
        <div className="card overflow-auto">
          <h2 className="font-semibold text-gray-700 mb-3">Clusters</h2>
          <div className="space-y-2">
            {clusters.map((c) => (
              <button
                key={c.cluster_id}
                onClick={() => { setSelected(c.cluster_id); setPage(1); }}
                className={`w-full text-left p-3 rounded-lg border transition ${
                  selected === c.cluster_id
                    ? "border-brand-400 bg-brand-50"
                    : "border-gray-100 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: CLUSTER_COLORS[c.cluster_id % CLUSTER_COLORS.length] }}
                    />
                    <span className="font-medium text-sm">Cluster {c.cluster_id}</span>
                  </div>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Users size={11} /> {c.user_count}
                  </span>
                </div>
                <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-2">
                  <span>Avg rev: ${c.avg_revenue}</span>
                  <span>Inactive: {c.avg_days_inactive}d</span>
                  {c.avg_return_prob > 0 && <span>Return: {Math.round(c.avg_return_prob * 100)}%</span>}
                  {c.dominant_segment && <span>{c.dominant_segment}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cluster drill-down */}
      {selected != null && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700">
              Cluster {selected} — Users
              <span className="ml-2 text-sm font-normal text-gray-400">({clusterUsers.total} total)</span>
            </h2>
            <button onClick={() => setSelected(null)} className="text-sm text-gray-400 hover:text-gray-600">
              Clear selection ×
            </button>
          </div>
          <UserTable
            users={clusterUsers.users}
            loading={loadingUsers}
            total={clusterUsers.total}
            page={page}
            pageSize={50}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
