import { useEffect, useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { segmentation as segApi } from "../api";
import { SEGMENT_COLORS } from "../constants/colors";
import { useGlobalFilter } from "../context/QueryFilterContext";
import Panel from "./Panel";

/**
 * Stacked-bar segment selector. One full-width bar split into 12 colored bands
 * proportional to user count. Hover any band → tooltip with segment name +
 * count + %. Click any band → toggle that segment in the global segment filter.
 *
 * Triple duty: legend (color → name), proportion view (size at a glance),
 * and active selector (click to filter).
 */
export default function SegmentStackedBar() {
  const { filters, setSegment } = useGlobalFilter();
  const selected = filters.segment || [];
  const anySelected = selected.length > 0;

  const [segments, setSegments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [hovered, setHovered]   = useState(null);

  // Always fetch the global (unfiltered) segment totals so the bar shows the
  // shape of the full population. The filter visualisation is "what's selected
  // pops, the rest dim" — not "shrink the bar to only the selected slice".
  useEffect(() => {
    setLoading(true);
    segApi.overview()
      .then(({ data }) => setSegments(data.segments || []))
      .finally(() => setLoading(false));
  }, []);

  // The /api/segmentation/ endpoint returns one row per (cluster_id × product_group),
  // so a segment can appear multiple times. Roll up by segment name.
  const rollup = useMemo(() => {
    const total = segments.reduce((s, r) => s + (r.user_count || 0), 0);
    const byName = new Map();
    for (const r of segments) {
      const cur = byName.get(r.segment) || { segment: r.segment, user_count: 0 };
      cur.user_count += r.user_count || 0;
      byName.set(r.segment, cur);
    }
    return {
      total,
      rows: Array.from(byName.values())
        .map(r => ({
          ...r,
          color:      SEGMENT_COLORS[r.segment] || "#9CA3AF",
          percentage: total ? (r.user_count / total) * 100 : 0,
        }))
        .sort((a, b) => b.user_count - a.user_count),
    };
  }, [segments]);

  function toggle(seg) {
    const next = selected.includes(seg)
      ? selected.filter(s => s !== seg)
      : [...selected, seg];
    setSegment(next);
  }

  return (
    <Panel
      id="segment-bar"
      title="Segments"
      subtitle={
        anySelected
          ? `${selected.length} of ${rollup.rows.length} selected · click bands to toggle, click chips to remove`
          : `${rollup.rows.length} segments · click any band to filter the page by it`
      }
    >
      {loading ? (
        <div className="h-32 flex items-center justify-center text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : rollup.rows.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
          No segment data.
        </div>
      ) : (
        <>
          {/* The bar itself */}
          <div className="flex h-12 rounded-lg overflow-hidden shadow-sm cursor-pointer mb-3">
            {rollup.rows.map(r => {
              const isSelected = selected.includes(r.segment);
              const isHovered  = hovered === r.segment;
              const dimmed     = anySelected && !isSelected;
              return (
                <div
                  key={r.segment}
                  onClick={() => toggle(r.segment)}
                  onMouseEnter={() => setHovered(r.segment)}
                  onMouseLeave={() => setHovered(null)}
                  className="transition-all relative"
                  style={{
                    flex: r.user_count,
                    backgroundColor: r.color,
                    opacity: dimmed && !isHovered ? 0.25 : 1,
                    filter: isHovered ? "brightness(1.12)" : "none",
                    boxShadow: isSelected ? "inset 0 0 0 2px rgba(0,0,0,0.7)" : "none",
                  }}
                  title={`${r.segment}\n${r.user_count.toLocaleString()} users (${r.percentage.toFixed(1)}%)`}
                />
              );
            })}
          </div>

          {/* Hovered detail strip — shows the name above whichever band is hovered */}
          <div className="h-5 mb-3 text-xs text-gray-600 flex items-center justify-center">
            {hovered ? (
              <span className="font-medium">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: SEGMENT_COLORS[hovered] }} />
                {hovered}
                <span className="text-gray-400 ml-1.5">
                  · {rollup.rows.find(r => r.segment === hovered)?.user_count.toLocaleString()} users
                  ({rollup.rows.find(r => r.segment === hovered)?.percentage.toFixed(1)}%)
                </span>
              </span>
            ) : (
              <span className="text-gray-400 italic">hover any band for details</span>
            )}
          </div>

          {/* Selected chips — easy way to drop selected segments without re-finding them */}
          {anySelected && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400 self-center mr-1">selected:</span>
              {selected.map(seg => (
                <button
                  key={seg}
                  onClick={() => toggle(seg)}
                  className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full text-xs text-white font-medium hover:opacity-85"
                  style={{ backgroundColor: SEGMENT_COLORS[seg] || "#9CA3AF" }}
                  title={`Remove ${seg}`}
                >
                  {seg}
                  <span className="text-white/70 text-[14px] leading-none">×</span>
                </button>
              ))}
              <button
                onClick={() => setSegment([])}
                className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
              >
                clear
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
