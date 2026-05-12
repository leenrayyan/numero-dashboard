import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { SEGMENT_COLORS as CLUSTER_COLORS, PALETTE } from "../constants/colors";
import { RefreshCw, Loader2, Settings2, Palette, Eye, Move } from "lucide-react";
import createScatterplot from "regl-scatterplot";
import { scaleLinear } from "d3-scale";
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

// Two product levels (matching the original notebook's two scatter plots):
//
//   "Product"      → dominant_product   — the product NAME the user buys most
//                    (Recharge / Calling Offers · Data eSIM / Local eSIM /
//                    Full eSIM · Phone Number / Local Calling Plan / EU Bundle).
//                    8 distinct values across the dataset → clean to colour by.
//
//   "Product Type" → _dominant_subprod  — derived from the first entry of the
//                    user's product_types comma-list. Granular sub-detail like
//                    price tier (Calls), country (eSIM), or feature category
//                    (Virtual). Many distinct values → top-N + Other bucket.
//
// We don't expose primary_product_group as a colour-by — clustering was done
// per group, so it just re-states the existing filter.
const COLOR_BY_OPTIONS = [
  { value: "segment",            label: "Segment" },
  { value: "dominant_product",   label: "Product" },
  { value: "_dominant_subprod",  label: "Product Type" },
  { value: "platform",           label: "Platform" },
  { value: "language",           label: "Language" },
];

// At most this many distinct values get their own colour; the rest fall into
// an "Other" bucket. Keeps the legend readable when a dim has many categories
// (e.g. eSIM has ~80 country product_types).
const MAX_DISTINCT_FOR_COLORING = 9;

function axisLabel(val) {
  return AXIS_OPTIONS.find(o => o.value === val)?.label ?? val;
}

function colorByLabel(val) {
  return COLOR_BY_OPTIONS.find(o => o.value === val)?.label ?? val;
}

/** Each user's dominant sub-product = first entry of their (frequency-sorted)
 *  comma-joined product_types string. Empty / null when missing. */
function dominantSubprod(p) {
  if (!p?.product_types) return null;
  const first = String(p.product_types).split(",")[0]?.trim();
  return first || null;
}

/** Augment each point with the derived `_dominant_subprod` field so the rest of
 *  the rendering code treats it like any other categorical column. */
function withDerived(points) {
  return points.map(p => ({ ...p, _dominant_subprod: dominantSubprod(p) }));
}

/** When a dimension has more distinct values than the legend can support
 *  (e.g. eSIM has ~80 country sub-products), keep the top-N most populous
 *  and bucket the rest as "Other" so the chart stays readable. */
function topNWithOther(points, colorBy, limit = MAX_DISTINCT_FOR_COLORING) {
  const counts = new Map();
  for (const p of points) {
    const v = p[colorBy];
    if (v == null || v === "") continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
  const topSet = new Set(top);
  if (counts.size <= limit) return points;
  return points.map(p => {
    const v = p[colorBy];
    if (v == null) return p;
    return topSet.has(v) ? p : { ...p, [colorBy]: "Other" };
  });
}

/**
 * Build a value→color map for the chosen colorBy dimension.
 * Segment uses the fixed brand palette; everything else falls back to PALETTE
 * indexed by sorted distinct value. "Other" always renders grey so it visually
 * recedes.
 */
function buildColorMap(points, colorBy) {
  const distinct = [...new Set(points.map(p => p[colorBy]).filter(Boolean))].sort();
  if (colorBy === "segment") {
    return Object.fromEntries(distinct.map(v => [v, CLUSTER_COLORS[v] || "#9CA3AF"]));
  }
  const map = Object.fromEntries(distinct.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
  map["Other"] = "#9CA3AF";
  return map;
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
// All categorical filters are arrays now — empty array = no filter applied.
const inFilter = (arr, value) => !arr || arr.length === 0 || arr.includes(value);

// Membership check: does this user (point) buy ANY of the filtered products?
// `product_groups` is the comma-joined string the API returns ("Calls, Virtual
// Number"). Empty filter array = no constraint.
function pointMatchesProducts(productTypes, point) {
  if (!productTypes || productTypes.length === 0) return true;
  const owned = String(point.product_groups || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return productTypes.some(p => owned.includes(p));
}

function matchesFilters(p, filters) {
  if (!inFilter(filters.segment,  p.segment))      return false;
  if (!pointMatchesProducts(filters.productType, p)) return false;
  if (!inFilter(filters.country,  p.user_country)) return false;
  if (!inFilter(filters.platform, p.platform))     return false;
  if (!inFilter(filters.language, p.language))     return false;
  // Recency / spend on each scatter point are the per-product values for
  // whichever product the panel is showing (the /pca endpoint sets `recency`
  // and `product_spent` on each row), so comparing against the global filter
  // values gives a coherent "does this dot match the active filter" answer.
  const spend = p.product_spent ?? p.total_spent;
  if (filters.recencyMin != null && p.recency < filters.recencyMin) return false;
  if (filters.recencyMax != null && p.recency > filters.recencyMax) return false;
  if (filters.spendMin   != null && spend     < filters.spendMin)   return false;
  if (filters.spendMax   != null && spend     > filters.spendMax)   return false;
  if (filters.ageMin     != null && p.customer_age < filters.ageMin) return false;
  if (filters.ageMax     != null && p.customer_age > filters.ageMax) return false;
  return true;
}

/** Compute the visual axis window for one panel of points: the full data
 *  range plus a 4% padding on each side, matching the notebook's
 *  `sns.scatterplot` auto-fit view. We don't clip outliers — instead we
 *  rely on regl-scatterplot's built-in pan/zoom so the analyst can drag
 *  into the bulk to inspect cluster shapes when outliers stretch the axes. */
function computeViewDomain(points, xAxis, yAxis) {
  if (!points.length) return null;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    const xv = p[xAxis], yv = p[yAxis];
    if (xv == null || yv == null) continue;
    if (xv < xMin) xMin = xv;
    if (xv > xMax) xMax = xv;
    if (yv < yMin) yMin = yv;
    if (yv > yMax) yMax = yv;
  }
  if (!isFinite(xMin) || !isFinite(yMin)) return null;
  const padX = (xMax - xMin) * 0.04 || 1;
  const padY = (yMax - yMin) * 0.04 || 1;
  return {
    x: [xMin - padX, xMax + padX],
    y: [yMin - padY, yMax + padY],
  };
}

/** Hex "#rrggbb" + alpha [0,1] → [r,g,b,a] in [0,1] for regl-scatterplot. */
function hexToRgba(hex, alpha = 1) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b, alpha];
}

/** Linear-tick generator: nice round ticks across [min, max]. */
function makeTicks(min, max, n = 5) {
  if (min === max) return [min];
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => min + step * i);
}

/** Render one scatter panel via regl-scatterplot (WebGL). PCA coords across
 *  panels are NOT in the same space — each product was clustered/PCA'd
 *  independently — so every panel computes its own axis window.
 *
 *  Why WebGL: SVG (Recharts) caps out around ~10K dots because it mounts a
 *  DOM node per point. Some panels carry 200K+ users; WebGL renders them on
 *  the GPU with no per-point DOM cost.
 *
 *  Layout: a relatively-positioned container holds three stacked layers —
 *    1. <canvas>          (regl-scatterplot, the dots)
 *    2. <svg> overlay     (gridlines, axis ticks, axis labels — pointer-events
 *                          off so the canvas keeps mouse events)
 *    3. tooltip <div>     (rendered when a point is hovered)
 */
function ChartPanel({
  title, points, colorBy, colorMap, filters, reflectionActive,
  xAxis, yAxis, isPCA, anySelected, isSegmentSelected,
  handleClick, onLassoSelect, tickFmt, compact = false, panZoom = false,
}) {
  const enriched = useMemo(() => withDerived(points), [points]);
  const bucketed = useMemo(
    () => colorBy === "segment" ? enriched : topNWithOther(enriched, colorBy),
    [enriched, colorBy],
  );
  const viewDomain = useMemo(
    () => computeViewDomain(enriched, xAxis, yAxis),
    [enriched, xAxis, yAxis],
  );

  // Build the per-point category index + a palette indexed by it. Categories:
  //   0..N-1  = one per distinct colour-by value
  //   N       = "deselected" (segment-mode click highlights other segments)
  //   N+1     = "faded" (reflect-filters dim points)
  //
  // Coords are normalized to [-1, 1] using viewDomain (which is the full data
  // range). regl-scatterplot's pan/zoom lets the analyst drag into the bulk
  // when extreme outliers stretch the default view.
  const { positions, palette } = useMemo(() => {
    const distinct = [...new Set(bucketed.map(p => p[colorBy]).filter(Boolean))].sort();
    const indexByValue = new Map(distinct.map((v, i) => [v, i]));
    const N = distinct.length;
    const DESELECTED_IDX = N;
    const FADED_IDX = N + 1;

    const pal = distinct.map(v => hexToRgba(colorMap[v] || "#9CA3AF", 0.78));
    pal.push(hexToRgba("#9CA3AF", 0.10)); // deselected
    pal.push(hexToRgba("#D1D5DB", 0.18)); // faded

    if (!viewDomain) {
      return { positions: [], palette: pal };
    }
    const [xMin, xMax] = viewDomain.x;
    const [yMin, yMax] = viewDomain.y;
    const xMid = (xMin + xMax) / 2, xHalf = (xMax - xMin) / 2 || 1;
    const yMid = (yMin + yMax) / 2, yHalf = (yMax - yMin) / 2 || 1;

    const out = new Array(bucketed.length);
    for (let i = 0; i < bucketed.length; i++) {
      const p = bucketed[i];
      const xv = p[xAxis], yv = p[yAxis];
      if (xv == null || yv == null) {
        out[i] = [0, 0, FADED_IDX];
        continue;
      }
      const x = (xv - xMid) / xHalf;
      const y = (yv - yMid) / yHalf;
      const segValue = p[colorBy];
      let cat = indexByValue.get(segValue);
      if (cat == null) cat = DESELECTED_IDX;
      if (reflectionActive && !matchesFilters(p, filters)) {
        cat = FADED_IDX;
      } else if (
        anySelected && colorBy === "segment" && segValue
        && !isSegmentSelected(segValue)
      ) {
        cat = DESELECTED_IDX;
      }
      out[i] = [x, y, cat];
    }
    return { positions: out, palette: pal };
  }, [
    bucketed, viewDomain, colorBy, colorMap, xAxis, yAxis,
    reflectionActive, filters, anySelected, isSegmentSelected,
  ]);

  // ─── Canvas + scatterplot lifecycle ─────────────────────────────────────
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const plotRef      = useRef(null);
  const [hover, setHover] = useState(null); // { idx, x, y } in container px
  // Currently-visible data domain (in PCA units). Starts as the full data
  // range and updates live when the user pans/zooms. Drives the SVG axis
  // labels so the tick numbers stay accurate as the camera moves.
  const [liveDomain, setLiveDomain] = useState(null);

  // Init once per mount; redraw on data change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const { width, height } = container.getBoundingClientRect();
    // d3 scales let regl-scatterplot expose the visible data bounds via the
    // `view` event — its xScale.domain() / yScale.domain() get updated live
    // as the user pans/zooms. We use those to redraw the SVG axis labels.
    // Initial domain is [-1, 1] (regl's normalized coord space); we'll
    // re-set it to the actual viewDomain in the view-subscription effect
    // below once data loads.
    const xScale = scaleLinear().domain([-1, 1]);
    const yScale = scaleLinear().domain([-1, 1]);
    const plot = createScatterplot({
      canvas,
      width:  Math.max(80, width),
      height: Math.max(80, height),
      pointSize: compact ? 2 : 3,
      // Native long-press lasso disabled — replaced by the custom
      // drag-to-box-select gesture below which is more discoverable
      // and matches the HTML prototype's `dragmode: 'select'` UX.
      lassoOnLongPress: false,
      xScale,
      yScale,
    });
    plotRef.current = plot;

    // Resize: the canvas needs to track its container's actual pixel size.
    // ResizeObserver fires on layout change without a scroll/window listener.
    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect();
      plot.set({ width: Math.max(80, r.width), height: Math.max(80, r.height) });
    });
    ro.observe(container);

    // Camera change → update live axis labels. We map regl's normalized
    // [-1, 1] coords back to data units using the current viewDomain.
    // (Stored in a ref-mirror below so this subscription stays stable.)
    const onView = ({ xScale: xs, yScale: ys }) => {
      setLiveDomain({ x: xs.domain(), y: ys.domain() });
    };
    plot.subscribe("view", onView);

    return () => {
      ro.disconnect();
      try { plot.unsubscribe("view", onView); } catch { /* noop */ }
      try { plot.destroy(); } catch { /* already torn down */ }
      plotRef.current = null;
    };
  }, [compact]);

  // Native box-select gesture (matches the HTML prototype's
  // `dragmode: 'select'`): drag = draw a rectangle, release = lasso the
  // enclosed points and push their id_client list to setLasso() via the
  // onLassoSelect prop.
  //
  // Why custom instead of regl-scatterplot's built-in lasso: regl's lasso
  // requires `lassoOnLongPress` (250ms hold first), which isn't discoverable
  // and analysts kept reporting "lasso doesn't work". The HTML behaviour
  // they remember is plain click-and-drag, so that's what we implement here.
  //
  // Click vs drag: a sub-threshold mouseup is a click — we let regl's
  // `select` event fire naturally (single-point segment-toggle path).
  // Above the threshold we draw an overlay div, compute hits on mouseup
  // by intersecting `positions` with the rectangle in normalized space,
  // adjust for the current view domain when pan/zoom has moved the camera,
  // then call onLassoSelect(ids).
  // Refs so the handlers below close over the latest data without forcing
  // the effect to re-register on every render. (`positions`/`bucketed` are
  // useMemo outputs that get new references whenever `filters` or
  // `isSegmentSelected` shift — those happen often enough that a deps-based
  // effect would loop unstably.)
  const positionsRef     = useRef(positions);
  const bucketedRef      = useRef(bucketed);
  const liveDomainRef    = useRef(liveDomain);
  const onLassoSelectRef = useRef(onLassoSelect);
  useEffect(() => { positionsRef.current     = positions; },     [positions]);
  useEffect(() => { bucketedRef.current      = bucketed; },      [bucketed]);
  useEffect(() => { liveDomainRef.current    = liveDomain; },    [liveDomain]);
  useEffect(() => { onLassoSelectRef.current = onLassoSelect; }, [onLassoSelect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // When pan/zoom is off we snap the camera home so the chart reads as a
    // static plot. plotRef.current may not be set on the very first effect
    // run (it's populated by the createScatterplot init effect which races
    // with this one), but reset() can be skipped safely until then — the
    // camera is already at its home position on mount.
    if (!panZoom) {
      try { plotRef.current?.reset(); } catch { /* noop */ }
    }

    let dragging = false;
    let didDrag = false;            // crossed the threshold? (suppress click)
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    let overlayEl = null;
    const DRAG_THRESHOLD_PX = 4;

    const removeOverlay = () => {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    };

    const onWheel = (e) => {
      // Pan/zoom off → swallow scroll so the page scrolls instead of regl zooming.
      if (panZoom) return;
      e.preventDefault(); e.stopPropagation();
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) return; // primary only
      dragging = true; didDrag = false;
      startX = e.clientX; startY = e.clientY;
      currentX = e.clientX; currentY = e.clientY;
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      currentX = e.clientX; currentY = e.clientY;
      const dx = Math.abs(currentX - startX);
      const dy = Math.abs(currentY - startY);
      if (dx <= DRAG_THRESHOLD_PX && dy <= DRAG_THRESHOLD_PX) return;

      didDrag = true;
      // Suppress regl from interpreting this drag as a pan when pan/zoom
      // is off. When pan/zoom is on we let regl pan freely AND draw our
      // rectangle in parallel — the rectangle still works as a visual,
      // but for a strict pan-first UX we exit early in that mode.
      if (!panZoom) e.stopPropagation();

      if (!overlayEl) {
        overlayEl = document.createElement("div");
        overlayEl.style.cssText = [
          "position:absolute",
          "border:1.5px dashed #7b2ff7",
          "background:rgba(123,47,247,0.10)",
          "pointer-events:none",
          "z-index:6",
          "border-radius:2px",
        ].join(";");
        container.appendChild(overlayEl);
      }
      const cr = container.getBoundingClientRect();
      const x1 = Math.min(startX, currentX) - cr.left;
      const y1 = Math.min(startY, currentY) - cr.top;
      overlayEl.style.left = x1 + "px";
      overlayEl.style.top  = y1 + "px";
      overlayEl.style.width  = Math.abs(currentX - startX) + "px";
      overlayEl.style.height = Math.abs(currentY - startY) + "px";
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      removeOverlay();
      if (!didDrag) return; // click path — regl's `select` event handles it

      // Convert the dragged pixel rectangle into normalized regl coords
      // (the same space we feed `positions`). Then, if the camera has
      // moved, remap through liveDomain so the hit-test corresponds to
      // what the user actually sees.
      const cr = canvas.getBoundingClientRect();
      const px2norm = (px, py) => [
        ((px - cr.left) / cr.width) * 2 - 1,
        1 - ((py - cr.top) / cr.height) * 2,
      ];
      const [nx1, ny1] = px2norm(startX, startY);
      const [nx2, ny2] = px2norm(currentX, currentY);
      let xMin = Math.min(nx1, nx2), xMax = Math.max(nx1, nx2);
      let yMin = Math.min(ny1, ny2), yMax = Math.max(ny1, ny2);

      // liveDomain reports regl's CURRENT visible window in our normalized
      // coord space. Default ([-1,1]) means no remap needed.
      const ld = liveDomainRef.current;
      if (ld && ld.x && ld.y) {
        const map = (v, dom) => dom[0] + ((v + 1) / 2) * (dom[1] - dom[0]);
        xMin = map(xMin, ld.x); xMax = map(xMax, ld.x);
        yMin = map(yMin, ld.y); yMax = map(yMax, ld.y);
      }

      const pos = positionsRef.current;
      const buc = bucketedRef.current;
      const hits = [];
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i];
        if (!p) continue;
        const x = p[0], y = p[1];
        if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) hits.push(i);
      }
      if (hits.length === 0) return;

      const ids = hits.map(i => buc[i]?.id_client).filter(Boolean);
      if (ids.length > 0) onLassoSelectRef.current?.(ids);
      // Read plotRef lazily — same race-with-init reason as above.
      try { plotRef.current?.select(hits); } catch { /* noop */ }
    };

    const onMouseLeave = () => {
      // If the user drags out of the canvas we still want a clean release.
      if (dragging) onMouseUp();
    };

    canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
    canvas.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("mousemove", onMouseMove, { capture: true });
    window.addEventListener("mouseup", onMouseUp, { capture: true });
    canvas.addEventListener("mouseleave", onMouseLeave, { capture: true });
    return () => {
      removeOverlay();
      canvas.removeEventListener("wheel", onWheel, { capture: true });
      canvas.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("mousemove", onMouseMove, { capture: true });
      window.removeEventListener("mouseup", onMouseUp, { capture: true });
      canvas.removeEventListener("mouseleave", onMouseLeave, { capture: true });
    };
  }, [panZoom]);

  // Push points + palette to the GPU whenever they change.
  // `colorBy: 'valueA'` tells regl-scatterplot to colour each dot by its 3rd
  // tuple element (our category index) instead of falling back to palette[0]
  // for every point — without this, every panel renders as one solid colour.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.set({ colorBy: "valueA", pointColor: palette });
    if (positions.length) {
      plot.draw(positions);
    } else {
      plot.clear();
    }
  }, [positions, palette]);

  // Lasso ↔ external clear sync: if the lasso chip's X is clicked (or the
  // global filter bar clears it), wipe regl-scatterplot's internal selection
  // highlight too so the dimmed-out faded look goes away.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    if (!filters?.lassoUserIds?.length) {
      try { plot.deselect(); } catch { /* noop */ }
    }
  }, [filters?.lassoUserIds]);

  // Hover + click subscriptions. We re-subscribe whenever the underlying
  // `bucketed` array changes so tooltip/click see the right point.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const onOver = (idx) => {
      const p = bucketed[idx];
      if (!p || !canvasRef.current) return;
      // Convert the point's normalized [-1, 1] coords back into container px
      // so the tooltip can sit next to the dot rather than the cursor.
      const r = canvasRef.current.getBoundingClientRect();
      const [nx, ny] = positions[idx] || [0, 0];
      const px = ((nx + 1) / 2) * r.width;
      const py = ((1 - ny) / 2) * r.height;
      setHover({ idx, x: px, y: py, point: p });
    };
    const onOut = () => setHover(null);
    const onSelect = ({ points: sel }) => {
      if (!sel?.length) return;
      // Lasso path: long-press-drag encloses multiple points → ship the
      // id_client list to the global filter so the rest of the page (and
      // /campaigns) targets exactly this audience. Keep regl's selection
      // highlight in place so the user sees what they grabbed.
      if (sel.length > 1) {
        const ids = sel.map(i => bucketed[i]?.id_client).filter(Boolean);
        if (ids.length > 0) onLassoSelect?.(ids);
        return;
      }
      // Single click → segment-toggle path (unchanged).
      const p = bucketed[sel[0]];
      if (p) handleClick({ ...p });
      try { plot.deselect(); } catch { /* noop */ }
    };
    plot.subscribe("pointOver", onOver);
    plot.subscribe("pointOut", onOut);
    plot.subscribe("select", onSelect);
    return () => {
      plot.unsubscribe("pointOver", onOver);
      plot.unsubscribe("pointOut", onOut);
      plot.unsubscribe("select", onSelect);
    };
  }, [bucketed, positions, handleClick]);

  // ─── Axis overlay ────────────────────────────────────────────────────────
  // The SVG axis labels reflect what's CURRENTLY visible. Two layers:
  //   1. `viewDomain` is the static full data range (computed from the
  //      points). Used to map data → regl's normalized [-1, 1] coords.
  //   2. `liveDomain` is what regl reports as visible after pan/zoom — but
  //      it's in normalized space (since we feed regl normalized coords).
  //      Map it back to data units so the tick numbers stay accurate as
  //      the camera moves. When pan/zoom is OFF (or before any movement),
  //      liveDomain is `[-1, 1]` and tickDomain == viewDomain.
  const tickDomain = useMemo(() => {
    if (!viewDomain) return null;
    if (!liveDomain) return viewDomain;
    const [xMin, xMax] = viewDomain.x;
    const [yMin, yMax] = viewDomain.y;
    const xMid = (xMin + xMax) / 2, xHalf = (xMax - xMin) / 2;
    const yMid = (yMin + yMax) / 2, yHalf = (yMax - yMin) / 2;
    return {
      x: [liveDomain.x[0] * xHalf + xMid, liveDomain.x[1] * xHalf + xMid],
      y: [liveDomain.y[0] * yHalf + yMid, liveDomain.y[1] * yHalf + yMid],
    };
  }, [viewDomain, liveDomain]);

  const xTicks = useMemo(
    () => tickDomain ? makeTicks(tickDomain.x[0], tickDomain.x[1], 6) : [],
    [tickDomain],
  );
  const yTicks = useMemo(
    () => tickDomain ? makeTicks(tickDomain.y[0], tickDomain.y[1], 5) : [],
    [tickDomain],
  );

  // Map a data value to a 0–100% position inside the canvas (used by the SVG
  // overlay so ticks line up exactly with where the dot would sit). Always
  // uses the CURRENTLY-VISIBLE domain so tick positions track pan/zoom.
  const xPct = (v) => tickDomain
    ? ((v - tickDomain.x[0]) / (tickDomain.x[1] - tickDomain.x[0])) * 100
    : 50;
  const yPct = (v) => tickDomain
    ? ((tickDomain.y[1] - v) / (tickDomain.y[1] - tickDomain.y[0])) * 100
    : 50;

  const heightStyle = isPCA
    ? { aspectRatio: "3 / 2" }   // matches old pcaAspect = 1.5
    : { height: compact ? 220 : 300 };

  return (
    <div>
      {title && (
        <div className="text-xs font-semibold text-gray-700 mb-1 text-center">
          {title}
          <span className="text-gray-400 font-normal ml-1.5">
            · {points.length.toLocaleString()} users
          </span>
        </div>
      )}
      {/* Pan/zoom hint + reset, only shown when the toggle is ON. The
          checkbox lives in the panel header (parent component) so it's
          discoverable without taking space here. */}
      {panZoom && (
        <div className="flex justify-end items-center gap-3 mb-1 text-[11px] text-gray-400">
          <span>drag to pan · scroll to zoom</span>
          <button
            onClick={() => {
              try { plotRef.current?.reset(); } catch { /* noop */ }
            }}
            className="text-gray-500 hover:text-purple-700 underline-offset-2 hover:underline"
            title="Reset zoom and pan"
          >
            reset view
          </button>
        </div>
      )}
      <div className="relative w-full" style={heightStyle} ref={containerRef}>
        {/* WebGL dots */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: colorBy === "segment" ? "pointer" : "default" }}
        />

        {/* Axes / gridlines overlay. pointer-events:none so the canvas still
            receives hover/click — overlay is purely decorative. */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
        >
          {/* Vertical gridlines + bottom tick labels */}
          {xTicks.map((t, i) => (
            <g key={`x-${i}`}>
              <line
                x1={`${xPct(t)}%`} x2={`${xPct(t)}%`}
                y1="0%" y2="100%"
                stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3 3"
              />
              <text
                x={`${xPct(t)}%`} y="100%"
                dy={-2}
                textAnchor="middle"
                fontSize={9} fill="#9ca3af"
              >
                {tickFmt(t)}
              </text>
            </g>
          ))}
          {/* Horizontal gridlines + left tick labels */}
          {yTicks.map((t, i) => (
            <g key={`y-${i}`}>
              <line
                x1="0%" x2="100%"
                y1={`${yPct(t)}%`} y2={`${yPct(t)}%`}
                stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3 3"
              />
              <text
                x={2} y={`${yPct(t)}%`}
                dy={3}
                textAnchor="start"
                fontSize={9} fill="#9ca3af"
              >
                {tickFmt(t)}
              </text>
            </g>
          ))}
        </svg>

        {/* Hover tooltip — positioned at the dot's container-relative coords. */}
        {hover && hover.point && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{
              left: Math.min(hover.x + 10, 99999),
              top:  Math.max(hover.y - 10, 0),
              transform: hover.x > 200 ? "translateX(-100%)" : undefined,
            }}
          >
            <CustomTooltip active payload={[{ payload: hover.point }]} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClusterScatter({ onSelectSegment, selectedSegment, readOnly = false }) {
  // selectedSegment may arrive as an array (preferred) or a string (back-compat).
  // Normalise to an array so the rest of the component is uniform.
  const selectedSegments = Array.isArray(selectedSegment)
    ? selectedSegment
    : (selectedSegment ? [selectedSegment] : []);
  const anySelected = selectedSegments.length > 0;
  const isSegmentSelected = (seg) => selectedSegments.includes(seg);
  const { clearLasso, filters, hasActiveFilter, setProductType, setLasso } = useGlobalFilter();

  // Quick product-switch tabs (rendered just under the panel title).
  // No "All Products" tab — each product was clustered in its own PCA space,
  // so combining them on one set of axes would be a coordinate-system lie.
  // The scatter ALWAYS shows exactly one product. When the page-wide global
  // filter is on a single product → that's what we show. When the global
  // filter is "all" or multi-product → we fall back to a local default
  // (Virtual Number, the largest of the three at ~73% of users) just for
  // *display*; the page-wide filter is NOT modified.
  // Hidden in readOnly mode (campaign preview).
  const PRODUCT_TABS = [
    { label: "Calls",          value: "Calls" },
    { label: "Data eSIM",      value: "Data eSIM" },
    { label: "Virtual Number", value: "Virtual Number" },
  ];
  const DEFAULT_SCATTER_PRODUCT = "Virtual Number";

  const [points, setPoints]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [xAxis, setXAxis]           = useState("pc1");
  const [yAxis, setYAxis]           = useState("pc2");
  const [showPicker, setShowPicker] = useState(false);
  const [colorBy, setColorBy]       = useState("segment");
  const [reflectFilters, setReflectFilters] = useState(true); // default ON
  // Pan/zoom is OFF by default — the scatter reads as a static plot like
  // the notebook unless the analyst opts in. When ON, dragging pans and
  // scrolling zooms (regl-scatterplot's built-in interactions).
  const [panZoom, setPanZoom] = useState(false);
  // Local "what is the scatter showing right now" — only used when the global
  // filter doesn't pin us to a single product. Persists between filter changes
  // so e.g. switching from Calls→All keeps Calls in view rather than snapping
  // back to default.
  const [scatterProduct, setScatterProduct] = useState(DEFAULT_SCATTER_PRODUCT);

  // The product the scatter actually displays. Global single-product wins so
  // the chart matches whatever the rest of the page is filtered to; otherwise
  // we use the local choice.
  const globalSingle = filters.productType?.length === 1
    ? filters.productType[0]
    : null;
  const effectiveProduct = globalSingle ?? scatterProduct;

  // Used by the load callback below to refetch when the displayed product changes.
  const productKey = effectiveProduct;

  const [panels, setPanels] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    clearLasso();
    // Always request a single product — the scatter never shows multiple
    // because per-product PCA spaces aren't comparable. Endpoint returns
    // `panels: [{ product, points }]` with exactly one entry.
    clustersApi.pca({ product_group: productKey }).then(({ data }) => {
      const ps = data.panels || [];
      setPanels(ps);
      setPoints(ps.flatMap(p => p.points || []));
    }).finally(() => setLoading(false));
  }, [productKey]);

  useEffect(() => { load(); }, [load]);

  // Build a SHARED colour map across all panels. Otherwise the same segment
  // could pick different colours in each small-multiple tile depending on
  // which other segments happened to share that panel.
  const allEnriched = useMemo(() => withDerived(points), [points]);
  const allBucketed = useMemo(
    () => colorBy === "segment" ? allEnriched : topNWithOther(allEnriched, colorBy),
    [allEnriched, colorBy],
  );
  const colorMap = useMemo(() => buildColorMap(allBucketed, colorBy), [allBucketed, colorBy]);

  // PCA mode → fixed 3:2 aspect; otherwise fall back to a fixed pixel height
  // (handled inside ChartPanel). isPCA is also used to gate the all-products
  // small-multiples note.
  const isPCA = xAxis === "pc1" && yAxis === "pc2";

  // Round axis tick labels to whole numbers (or 1 decimal for tiny ranges) so
  // we don't see "0.0001" / "33.22" / etc.
  const tickFmt = (v) => {
    if (typeof v !== "number") return v;
    return Math.abs(v) >= 10 ? Math.round(v).toString()
         : Math.abs(v) >= 1  ? v.toFixed(1)
         :                     v.toFixed(2);
  };

  const reflectionActive = reflectFilters && hasActiveFilter;

  function handleClick(data) {
    if (readOnly) return;
    // Click-to-filter only makes sense when we're colouring by segment.
    if (colorBy !== "segment" || !data?.segment) return;
    // Toggle: remove if already selected, otherwise add to the selection.
    const next = isSegmentSelected(data.segment)
      ? selectedSegments.filter(s => s !== data.segment)
      : [...selectedSegments, data.segment];
    onSelectSegment?.(next);
  }

  return (
    <Panel
      id="cluster-scatter"
      title="Cluster Map"
      subtitle={
        `${effectiveProduct} · ${axisLabel(xAxis)} vs ${axisLabel(yAxis)} · ${points.length.toLocaleString()} users`
        + (globalSingle ? "" : "  ·  default view (page filter is unaffected)")
      }
      headerRight={readOnly ? null : (
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

          {/* Pan & zoom toggle. OFF by default — the scatter reads as a
              static plot. ON enables drag-to-pan and scroll-to-zoom so the
              analyst can dive into the bulk when extreme PCA outliers
              stretch the default view. */}
          <label
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border cursor-pointer select-none transition ${
              panZoom
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-500 hover:text-gray-700"
            }`}
            title="When ON, drag the scatter to pan and scroll to zoom. Useful for inspecting dense regions when outliers stretch the axes."
          >
            <input
              type="checkbox"
              checked={panZoom}
              onChange={e => setPanZoom(e.target.checked)}
              className="w-3 h-3 accent-purple-600"
            />
            <Move size={12} />
            Pan & zoom
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
        </>)
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

      {/* Product-switcher tabs. Two distinct meanings:
          - When a tab matches the global single-product filter → solid purple.
            The page is filtered to that product AND the scatter shows it.
          - When a tab matches only the local default (no global single-product
            filter) → outlined/light. The scatter is showing this product, but
            the rest of the page is on All.
          Clicking a tab ALWAYS sets the global filter (so behaviour matches
          the user's mental model: "I clicked it → it filters"). To get back
          to "All Products" globally, use the dropdown in the global filter
          bar at the top — by design, the scatter has no All button because
          per-product PCA spaces aren't comparable. */}
      {!readOnly && (
        <div className="flex gap-1 mb-3 bg-gray-50 rounded-xl p-1 border border-gray-200 w-fit">
          {PRODUCT_TABS.map(({ label, value }) => {
            const isPageFilter = globalSingle === value;
            const isLocalView  = !globalSingle && effectiveProduct === value;
            const cls = isPageFilter
              ? "bg-purple-600 text-white shadow-sm"
              : isLocalView
                ? "bg-white text-purple-700 ring-1 ring-purple-300"
                : "text-gray-500 hover:text-gray-800 hover:bg-white";
            return (
              <button
                key={label}
                onClick={() => {
                  // Click always writes to the global filter. If the user
                  // wanted a "local-only" change we'd add a modifier key,
                  // but the explicit ask was: clicks filter the page.
                  setProductType([value]);
                  setScatterProduct(value);
                }}
                title={isLocalView
                  ? "Showing this product locally — click to also filter the rest of the page"
                  : isPageFilter
                    ? "This product is filtering the whole page"
                    : ""}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${cls}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Legend / colour key has moved to the SegmentStackedBar in the right
          panel. Scatter stays uncluttered — hover any point for tooltip,
          and the stacked bar serves as the segment selector. */}

      {loading ? (
        // Match the chart's aspect ratio so the panel doesn't shrink to
        // a small loading skeleton and snap back to full height when data
        // arrives — that height jump was scrolling the user out of view
        // on every filter change.
        <div
          className="w-full flex items-center justify-center"
          style={isPCA ? { aspectRatio: "3 / 2" } : { height: 300 }}
        >
          <div className="text-center text-gray-400">
            <Loader2 size={28} className="animate-spin mx-auto mb-2" />
            <div className="text-sm">Loading cluster map…</div>
          </div>
        </div>
      ) : (
        <ChartPanel
          points={panels[0]?.points || points}
          colorBy={colorBy}
          colorMap={colorMap}
          filters={filters}
          reflectionActive={reflectionActive}
          xAxis={xAxis}
          yAxis={yAxis}
          isPCA={isPCA}
          anySelected={anySelected}
          isSegmentSelected={isSegmentSelected}
          handleClick={handleClick}
          onLassoSelect={setLasso}
          tickFmt={tickFmt}
          panZoom={panZoom}
        />
      )}
      <p className="text-xs text-gray-400 mt-1 text-center">
        Coloured by <strong>{colorByLabel(colorBy)}</strong>
        {colorBy === "segment" && " · click a point to filter by that segment"}
        <span className="text-gray-300"> · </span>
        <span className="text-gray-500">drag to box-select users</span>
      </p>
    </Panel>
  );
}
