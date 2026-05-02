import { useEffect, useState, useCallback } from "react";
import { SEGMENT_COLORS as CLUSTER_COLORS } from "../constants/colors";
import { RefreshCw, Loader2, Settings2 } from "lucide-react";
import {
  ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { clusters as clustersApi } from "../api";
import { useGlobalFilter } from "../context/QueryFilterContext";
import Panel from "./Panel";

const AXIS_OPTIONS = [
  { value: "pc1",                label: "PC1 (PCA)" },
  { value: "pc2",                label: "PC2 (PCA)" },
  { value: "total_spent",        label: "Total Spend ($)" },
  { value: "recency",            label: "Recency (days)" },
  { value: "purchase_frequency", label: "Purchase Freq." },
];

function getColor(seg) { return CLUSTER_COLORS[seg] || "#9CA3AF"; }

function axisLabel(val) {
  return AXIS_OPTIONS.find(o => o.value === val)?.label ?? val;
}

const CustomTooltip = ({ active, payload, xAxis, yAxis }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const xVal = d[xAxis];
  const yVal = d[yAxis];
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md p-2 text-xs max-w-[180px]">
      <div className="font-semibold text-gray-800 mb-1">{d.segment}</div>
      <div className="text-gray-500">ID: {d.id_client}</div>
      <div className="text-gray-500">{axisLabel(xAxis)}: {typeof xVal === "number" ? xVal.toFixed(2) : xVal}</div>
      <div className="text-gray-500">{axisLabel(yAxis)}: {typeof yVal === "number" ? yVal.toFixed(2) : yVal}</div>
      <div className="text-gray-400 mt-1">Spent: ${(d.total_spent ?? 0).toFixed(2)} · {d.recency}d ago</div>
    </div>
  );
};

export default function ClusterScatter({ onSelectSegment, selectedSegment }) {
  const { clearLasso, filters } = useGlobalFilter();
  const [points, setPoints]         = useState([]);
  const [varianceExp, setVarianceExp] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [xAxis, setXAxis]           = useState("pc1");
  const [yAxis, setYAxis]           = useState("pc2");
  const [showPicker, setShowPicker] = useState(false);

  const productType = filters.productType;

  const load = useCallback(() => {
    setLoading(true);
    clearLasso();
    const extra = productType ? { product_group: productType } : {};
    clustersApi.pca(3000, extra).then(({ data }) => {
      setPoints(data.points || []);
      setVarianceExp(data.variance_explained || []);
    }).finally(() => setLoading(false));
  }, [productType]);

  useEffect(() => { load(); }, [load]);

  // Clip outliers: keep only points within 2nd–98th percentile on both axes
  const clippedPoints = (() => {
    if (!points.length) return [];
    const key = xAxis === "pc1" ? "pc1" : xAxis === "pc2" ? "pc2" : xAxis;
    const key2 = yAxis === "pc1" ? "pc1" : yAxis === "pc2" ? "pc2" : yAxis;
    const xs = points.map(p => p[xAxis]).sort((a, b) => a - b);
    const ys = points.map(p => p[yAxis]).sort((a, b) => a - b);
    const p2  = (arr) => arr[Math.floor(arr.length * 0.02)];
    const p98 = (arr) => arr[Math.floor(arr.length * 0.98)];
    const [xMin, xMax] = [p2(xs), p98(xs)];
    const [yMin, yMax] = [p2(ys), p98(ys)];
    return points.filter(p => p[xAxis] >= xMin && p[xAxis] <= xMax && p[yAxis] >= yMin && p[yAxis] <= yMax);
  })();

  const segments = [...new Set(clippedPoints.map(p => p.segment))].sort();
  const bySegment = segments.reduce((acc, seg) => {
    acc[seg] = clippedPoints.filter(p => p.segment === seg);
    return acc;
  }, {});

  function handleClick(data) {
    if (!data?.segment) return;
    onSelectSegment?.(selectedSegment === data.segment ? null : data.segment);
  }

  const isPCA = xAxis === "pc1" && yAxis === "pc2";

  const axisPickerBtn = (
    <button
      onClick={() => setShowPicker(v => !v)}
      title="Change axes"
      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition ${
        showPicker || !isPCA
          ? "border-purple-300 bg-purple-50 text-purple-700"
          : "border-gray-200 text-gray-400 hover:text-gray-600"
      }`}
    >
      <Settings2 size={12} />
      Axes
    </button>
  );

  const refreshBtn = (
    <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition">
      {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
    </button>
  );

  return (
    <Panel
      id="cluster-scatter"
      title="Cluster Map"
      subtitle={
        isPCA && varianceExp.length === 2
          ? `PC1 ${(varianceExp[0]*100).toFixed(1)}% · PC2 ${(varianceExp[1]*100).toFixed(1)}% variance · ${points.length.toLocaleString()} users`
          : `${axisLabel(xAxis)} vs ${axisLabel(yAxis)} · ${points.length.toLocaleString()} users`
      }
      headerRight={<>{axisPickerBtn}{refreshBtn}</>}
    >
      {/* Axis picker */}
      {showPicker && (
        <div className="flex items-center gap-4 mb-3 p-3 bg-gray-50 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">X axis</span>
            <select
              value={xAxis}
              onChange={e => setXAxis(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-purple-400"
            >
              {AXIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Y axis</span>
            <select
              value={yAxis}
              onChange={e => setYAxis(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-purple-400"
            >
              {AXIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button
            onClick={() => { setXAxis("pc1"); setYAxis("pc2"); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Reset to PCA
          </button>
        </div>
      )}

      {/* Segment pills */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(CLUSTER_COLORS).map(([seg, color]) => {
          if (!bySegment[seg]?.length) return null;
          const active = selectedSegment === seg;
          const dimmed = selectedSegment && !active;
          return (
            <button
              key={seg}
              onClick={() => onSelectSegment(active ? null : seg)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${
                active ? "text-white border-transparent shadow"
                       : dimmed ? "border-gray-200 text-gray-400 bg-gray-50"
                                : "border-gray-200 text-gray-700 bg-white hover:shadow-sm"
              }`}
              style={active ? { backgroundColor: color } : {}}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? "white" : color }} />
              {seg}
            </button>
          );
        })}
      </div>

      {/* All-products warning */}
      {!productType && isPCA && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
          <strong>Note:</strong> Each product was clustered in its own PCA space — mixing all products in one scatter is approximate. Select <strong>Calls</strong>, <strong>Data eSIM</strong>, or <strong>Virtual Number</strong> above for a clean per-product view.
        </div>
      )}

      {loading ? (
        <div className="h-72 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <Loader2 size={28} className="animate-spin mx-auto mb-2" />
            <div className="text-sm">Loading cluster map…</div>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 10, bottom: 25, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
            <XAxis
              type="number" dataKey={xAxis} name={axisLabel(xAxis)}
              tick={{ fontSize: 9, fill: "#9ca3af" }}
              domain={["auto", "auto"]}
              label={{ value: axisLabel(xAxis), position: "insideBottom", offset: -12, fontSize: 11, fill: "#9ca3af" }}
            />
            <YAxis
              type="number" dataKey={yAxis} name={axisLabel(yAxis)}
              tick={{ fontSize: 9, fill: "#9ca3af" }}
              domain={["auto", "auto"]}
              label={{ value: axisLabel(yAxis), angle: -90, position: "insideLeft", fontSize: 11, fill: "#9ca3af" }}
              width={40}
            />
            <Tooltip content={<CustomTooltip xAxis={xAxis} yAxis={yAxis} />} />
            {segments.map(seg => (
              <Scatter
                key={seg}
                name={seg}
                data={bySegment[seg]}
                fill={getColor(seg)}
                fillOpacity={!selectedSegment || selectedSegment === seg ? 0.75 : 0.1}
                onClick={handleClick}
                style={{ cursor: "pointer" }}
                r={4}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
      <p className="text-xs text-gray-400 mt-1 text-center">
        Click a point or pill to filter · use <strong>Axes</strong> to change what's plotted
        {clippedPoints.length < points.length && (
          <span className="text-amber-500 ml-2">· {(points.length - clippedPoints.length).toLocaleString()} outliers hidden for scale</span>
        )}
      </p>
    </Panel>
  );
}
