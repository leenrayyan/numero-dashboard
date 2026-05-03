import { useEffect, useState, useCallback, useMemo } from "react";
import { SEGMENT_COLORS as CLUSTER_COLORS, PALETTE, PRODUCT_COLORS } from "../constants/colors";
import { RefreshCw, Loader2, Settings2, Palette, Eye } from "lucide-react";
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
  { value: "customer_age",       label: "Customer Age (days)" },
];

const COLOR_BY_OPTIONS = [
  { value: "segment",                label: "Segment" },
  { value: "primary_product_group",  label: "Product" },
  { value: "product_types",          label: "Product Type" },
  { value: "platform",               label: "Platform" },
  { value: "language",               label: "Language" },
];

function axisLabel(val) {
  return AXIS_OPTIONS.find(o => o.value === val)?.label ?? val;
}

function colorByLabel(val) {
  return COLOR_BY_OPTIONS.find(o => o.value === val)?.label ?? val;
}

/**
 * Build a value→color map for the chosen colorBy dimension.
 * Segments and Products use the brand-defined fixed palette; everything else
 * falls back to PALETTE indexed by sorted distinct value.
 */
function buildColorMap(points, colorBy) {
  const distinct = [...new Set(points.map(p => p[colorBy]).filter(Boolean))].sort();
  if (colorBy === "segment") {
    return Object.fromEntries(distinct.map(v => [v, CLUSTER_COLORS[v] || "#9CA3AF"]));
  }
  if (colorBy === "primary_product_group") {
    return Object.fromEntries(distinct.map(v => [v, PRODUCT_COLORS[v] || "#9CA3AF"]));
  }
  return Object.fromEntries(distinct.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md p-2.5 text-xs max-w-[220px]">
      <div className="font-semibold text-gray-800 mb-1.5">{d.segment ?? "—"}</div>
      <div className="space-y-0.5 text-gray-600">
        <div><span className="text-gray-400">ID:</span> {d.id_client}</div>
        {d.user_country && <div><span className="text-gray-400">Country:</span> {d.user_country}</div>}
        {d.customer_age != null && <div><span className="text-gray-400">Age:</span> {d.customer_age}d</div>}
        {d.total_spent != null && <div><span className="text-gray-400">Spend:</span> ${(d.total_spent ?? 0).toFixed(2)}</div>}
        {d.platform && <div><span className="text-gray-400">Platform:</span> {d.platform}</div>}
        {d.language && <div><span className="text-gray-400">Language:</span> <span className="capitalize">{d.language}</span></div>}
      </div>
    </div>
  );
};

/**
 * Predicate: does a sample point match the *current* global filter set?
 * Used by the "Reflect filters on cluster scatter" toggle to fade non-matching
 * points to grey while keeping matching points coloured.
 */
function matchesFilters(p, filters) {
  if (filters.segment && p.segment !== filters.segment) return false;
  if (filters.productType && p.primary_product_group !== filters.productType) return false;
  if (filters.country?.length > 0 && !filters.country.includes(p.user_country)) return false;
  if (filters.platform && p.platform !== filters.platform) return false;
  if (filters.language && p.language !== filters.language) return false;
  if (filters.recencyMin != null && p.recency < filters.recencyMin) return false;
  if (filters.recencyMax != null && p.recency > filters.recencyMax) return false;
  if (filters.spendMin != null && p.total_spent < filters.spendMin) return false;
  if (filters.spendMax != null && p.total_spent > filters.spendMax) return false;
  if (filters.ageMin != null && p.customer_age < filters.ageMin) return false;
  if (filters.ageMax != null && p.customer_age > filters.ageMax) return false;
  return true;
}

export default function ClusterScatter({ onSelectSegment, selectedSegment }) {
  const { clearLasso, filters, hasActiveFilter } = useGlobalFilter();
  const [points, setPoints]         = useState([]);
  const [varianceExp, setVarianceExp] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [xAxis, setXAxis]           = useState("pc1");
  const [yAxis, setYAxis]           = useState("pc2");
  const [showPicker, setShowPicker] = useState(false);
  const [colorBy, setColorBy]       = useState("segment");
  const [reflectFilters, setReflectFilters] = useState(true); // default ON

  const productType = filters.productType;

  const load = useCallback(() => {
    setLoading(true);
    clearLasso();
    // Note: we deliberately fetch the FULL sample (not filter-aware) so that
    // when "Reflect filters" is on we have both matching and non-matching
    // points to render — non-matches as faded background.
    const extra = productType ? { product_group: productType } : {};
    clustersApi.pca(3000, extra).then(({ data }) => {
      setPoints(data.points || []);
      setVarianceExp(data.variance_explained || []);
    }).finally(() => setLoading(false));
  }, [productType]);

  useEffect(() => { load(); }, [load]);

  // Outlier clip (2nd–98th percentile on both axes) for nicer scaling.
  const clippedPoints = useMemo(() => {
    if (!points.length) return [];
    const xs = points.map(p => p[xAxis]).sort((a, b) => a - b);
    const ys = points.map(p => p[yAxis]).sort((a, b) => a - b);
    const p2  = (arr) => arr[Math.floor(arr.length * 0.02)];
    const p98 = (arr) => arr[Math.floor(arr.length * 0.98)];
    const [xMin, xMax] = [p2(xs), p98(xs)];
    const [yMin, yMax] = [p2(ys), p98(ys)];
    return points.filter(p => p[xAxis] >= xMin && p[xAxis] <= xMax && p[yAxis] >= yMin && p[yAxis] <= yMax);
  }, [points, xAxis, yAxis]);

  // Split into colour groups based on the chosen colorBy dim, and (when
  // reflection is on + a filter is active) a separate "faded" group for
  // points that don't match the current filter.
  const colorMap = useMemo(() => buildColorMap(clippedPoints, colorBy), [clippedPoints, colorBy]);

  const reflectionActive = reflectFilters && hasActiveFilter;
  const { matched, faded } = useMemo(() => {
    if (!reflectionActive) return { matched: clippedPoints, faded: [] };
    const m = [], f = [];
    for (const p of clippedPoints) {
      (matchesFilters(p, filters) ? m : f).push(p);
    }
    return { matched: m, faded: f };
  }, [reflectionActive, clippedPoints, filters]);

  const groups = useMemo(() => {
    const distinct = [...new Set(matched.map(p => p[colorBy]).filter(Boolean))].sort();
    return distinct.map(v => ({
      key:   String(v),
      label: String(v),
      color: colorMap[v] || "#9CA3AF",
      data:  matched.filter(p => p[colorBy] === v),
    }));
  }, [matched, colorBy, colorMap]);

  function handleClick(data) {
    // Click-to-filter only makes sense when we're colouring by segment.
    if (colorBy !== "segment" || !data?.segment) return;
    onSelectSegment?.(selectedSegment === data.segment ? null : data.segment);
  }

  const isPCA = xAxis === "pc1" && yAxis === "pc2";

  return (
    <Panel
      id="cluster-scatter"
      title="Cluster Map"
      subtitle={
        isPCA && varianceExp.length === 2
          ? `PC1 ${(varianceExp[0]*100).toFixed(1)}% · PC2 ${(varianceExp[1]*100).toFixed(1)}% variance · ${points.length.toLocaleString()} users`
          : `${axisLabel(xAxis)} vs ${axisLabel(yAxis)} · ${points.length.toLocaleString()} users`
      }
      headerRight={
        <>
          {/* Reflect filters toggle */}
          <label
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border cursor-pointer select-none transition ${
              reflectionActive
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-500 hover:text-gray-700"
            }`}
            title="When ON, points outside the current filter fade to grey so you can see where your filtered audience sits in the cluster space."
          >
            <input
              type="checkbox"
              checked={reflectFilters}
              onChange={e => setReflectFilters(e.target.checked)}
              className="w-3 h-3 accent-purple-600"
            />
            <Eye size={12} />
            Reflect filters
          </label>

          <button
            onClick={() => setShowPicker(v => !v)}
            title="Change axes / colour"
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition ${
              showPicker || !isPCA || colorBy !== "segment"
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-400 hover:text-gray-600"
            }`}
          >
            <Settings2 size={12} />
            Axes
          </button>

          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </>
      }
    >
      {/* Axis + colour-by picker */}
      {showPicker && (
        <div className="flex items-center gap-4 mb-3 p-3 bg-gray-50 rounded-xl text-sm flex-wrap">
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
          <div className="flex items-center gap-2">
            <Palette size={12} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Colour by</span>
            <select
              value={colorBy}
              onChange={e => setColorBy(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-purple-400"
            >
              {COLOR_BY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button
            onClick={() => { setXAxis("pc1"); setYAxis("pc2"); setColorBy("segment"); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Reset
          </button>
        </div>
      )}

      {/* Legend pills — only clickable when colouring by segment (filters that dim) */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {groups.map(g => {
          const clickable = colorBy === "segment";
          const active    = clickable && selectedSegment === g.key;
          const dimmed    = clickable && selectedSegment && !active;
          return (
            <button
              key={g.key}
              onClick={() => clickable && onSelectSegment(active ? null : g.key)}
              disabled={!clickable}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all ${
                active ? "text-white border-transparent shadow"
                       : dimmed ? "border-gray-200 text-gray-400 bg-gray-50"
                                : "border-gray-200 text-gray-700 bg-white hover:shadow-sm"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
              style={active ? { backgroundColor: g.color } : {}}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? "white" : g.color }} />
              {g.label}
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
            <Tooltip content={<CustomTooltip />} />

            {/* Faded background — non-matching points (only when reflection is on) */}
            {faded.length > 0 && (
              <Scatter
                key="__faded"
                data={faded}
                fill="#D1D5DB"
                fillOpacity={0.25}
                r={3}
                isAnimationActive={false}
              />
            )}

            {/* Coloured foreground — grouped by colorBy */}
            {groups.map(g => (
              <Scatter
                key={g.key}
                name={g.label}
                data={g.data}
                fill={g.color}
                fillOpacity={!selectedSegment || colorBy !== "segment" || selectedSegment === g.key ? 0.78 : 0.12}
                onClick={handleClick}
                style={{ cursor: colorBy === "segment" ? "pointer" : "default" }}
                r={4}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
      <p className="text-xs text-gray-400 mt-1 text-center">
        Coloured by <strong>{colorByLabel(colorBy)}</strong>
        {colorBy === "segment" && " · click a point or pill to filter by that segment"}
        {clippedPoints.length < points.length && (
          <span className="text-amber-500 ml-2">· {(points.length - clippedPoints.length).toLocaleString()} outliers hidden for scale</span>
        )}
      </p>
    </Panel>
  );
}
