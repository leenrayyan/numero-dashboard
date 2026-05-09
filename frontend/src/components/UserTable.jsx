import { ChevronLeft, ChevronRight } from "lucide-react";
import { SEGMENT_COLORS as BRAND_SEGMENT_COLORS } from "../constants/colors";

function SegmentBadge({ segment }) {
  if (!segment) return <span className="text-gray-400">—</span>;
  const color = BRAND_SEGMENT_COLORS[segment] || "#6B7280";
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{
        backgroundColor: `${color}1A`, // ~10% alpha tint
        color,
      }}
    >
      {segment}
    </span>
  );
}

/** When no single product is filtered, a user can belong to up to 3 segments
 *  (one per product they buy in) — segments are per-product cluster names.
 *  This stacks one badge per non-null cluster, matching the visual rhythm of
 *  the Products column. Calls/eSIM/Virtual cluster columns come from the API
 *  alongside the aliased `segment` field. */
function SegmentBadges({ user }) {
  const segs = [
    user.calls_cluster,
    user.esim_cluster,
    user.virtual_cluster,
  ].filter(Boolean);
  if (segs.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-col gap-1 items-start">
      {segs.map(s => <SegmentBadge key={s} segment={s} />)}
    </div>
  );
}

function RecencyBadge({ days }) {
  if (days == null) return <span className="text-gray-400">—</span>;
  const cls = days > 365 ? "badge-low" : days > 180 ? "badge-medium" : "badge-high";
  return <span className={cls}>{days}d</span>;
}

// Per-product chip display. "Primary product" is no longer a UI concept —
// when no product filter is active we list every product the user buys
// equally; when a single product is filtered we list the OTHER products
// they buy ("also buys" context). Chip data comes from the per-product
// frequency columns since those are NULL/0 when the user has no activity
// in that group.
const PRODUCT_KEYS = ["calls", "esim", "virtual"];
const SHORT_LABEL = { calls: "Calls", esim: "eSIM", virtual: "Virtual" };
// Maps the filter label ("Calls" / "Data eSIM" / "Virtual Number") to the
// per-product column prefix so we can hide the chip for the actively-
// filtered product (it's redundant — every row in the table has it).
const FILTER_TO_KEY = { "Calls": "calls", "Data eSIM": "esim", "Virtual Number": "virtual" };

function ProductsCell({ user, hideKey }) {
  const owned = PRODUCT_KEYS
    .filter(k => k !== hideKey && (user[`${k}_frequency`] ?? 0) > 0)
    .map(k => SHORT_LABEL[k]);
  if (owned.length === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {owned.map(s => (
        <span
          key={s}
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100"
        >
          {s}
        </span>
      ))}
    </span>
  );
}

// Threshold (days since last purchase) at which a user is considered dormant.
// Mirrors the value the team uses in the reactivation notebook.
const DORMANT_DAYS_THRESHOLD = 90;

function ReactivationBadge({ score, recency, cutoffs }) {
  // Three states the badge can show — distinguishing them matters because
  // the team's RandomForest only scores dormant users WITH enough purchase
  // history to learn from (≥ 2 purchases). Pure one-timers come back as
  // "score is null" but they're NOT active — they're dormant and unscoreable.
  // Using `recency` (already in the row) lets us split correctly.
  const isDormant = recency != null && recency >= DORMANT_DAYS_THRESHOLD;

  // Active: recent purchase, no reactivation needed.
  if (!isDormant) {
    return (
      <span
        className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100"
        title="Active — recent purchase, no reactivation needed."
      >
        Active
      </span>
    );
  }
  // Dormant + no model score: usually one-time buyers the model couldn't
  // score (insufficient behavioural history).
  if (score == null) {
    return (
      <span
        className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
        title={`Dormant (no purchases in ${recency}d). Not scored by the reactivation model — typically one-time buyers without enough history for a probability estimate.`}
      >
        Dormant
      </span>
    );
  }
  const pct = Math.round(score * 100);
  // Percentile-based bucketing — `cutoffs` comes from the analytics endpoint
  // and reflects the live score distribution. Top 20% = HIGH (green), next
  // 30% = MEDIUM (amber), bottom 50% = LOW (rose). Industry standard for
  // propensity scoring; resilient to model retraining (a new model can shift
  // the absolute score range without breaking the bucket sizes).
  // Fallback: if cutoffs aren't loaded yet (or the table is empty), use a
  // sensible default so the badge still renders something useful.
  const hi  = cutoffs?.high_cutoff   ?? 0.7;
  const med = cutoffs?.medium_cutoff ?? 0.4;
  const tone = score >= hi  ? "bg-emerald-100 text-emerald-700"
             : score >= med ? "bg-amber-100 text-amber-700"
             :                "bg-rose-100 text-rose-700";
  const label = score >= hi  ? "HIGH"
              : score >= med ? "MEDIUM"
              :                "LOW";
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tone}`}
      title={`${label} priority — predicted ${pct}% chance to reactivate. `
             + `Bucket: top 20% = HIGH, next 30% = MEDIUM, bottom 50% = LOW.`}
    >
      {pct}%
    </span>
  );
}

export default function UserTable({
  users = [], loading = false, total = 0, page = 1, pageSize = 50, onPageChange,
  // Selection (optional — if not provided, the table renders without checkboxes)
  selectedIds, onToggle, onSelectAllMatching, onClearAll, selectAllLoading = false,
  // When exactly one product is filtered, the backend aliases that product's
  // per-user columns AS the global names (recency / total_spent / purchase_
  // frequency). Pass the active product label here so the column headers
  // reflect what the values actually represent — e.g. "Calls Spend" instead
  // of "Total Spend" when filtered to Calls. Pass null/undefined when all
  // products are showing (default).
  singleProductLabel = null,
  // Percentile cutoffs for ReactivationBadge colour bucketing. Shape:
  // { high_cutoff: 0.6, medium_cutoff: 0.4 }. Pass null/undefined to fall
  // back to defaults inside the badge.
  reactivationCutoffs = null,
}) {
  const totalPages = Math.ceil(total / pageSize);
  const selectionEnabled = selectedIds != null && onToggle != null;

  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
        </div>
      </div>
    );
  }

  // Header checkbox state: ALL = every matching user is in the set, SOME = any
  // selection at all, NONE = nothing selected. Clicking the header always
  // jumps between "all matching across pages" and "nothing".
  const selSize = selectionEnabled ? selectedIds.size : 0;
  const headerState = selSize === 0 ? "none"
                    : selSize >= total && total > 0 ? "all"
                    : "some";

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        {/* min-w stops the browser from re-laying-out column widths between
            pages when the data length changes. Sized so all 12 columns fit on
            a typical desktop without horizontal scroll. */}
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {selectionEnabled && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    aria-label={headerState === "none" ? "Select all matching users" : "Clear selection"}
                    title={headerState === "none"
                      ? `Select all ${total.toLocaleString()} matching users`
                      : "Clear selection"}
                    checked={headerState === "all"}
                    disabled={selectAllLoading}
                    ref={el => { if (el) el.indeterminate = headerState === "some"; }}
                    onChange={() => {
                      if (headerState === "none") onSelectAllMatching?.();
                      else                        onClearAll?.();
                    }}
                    className="w-4 h-4 accent-purple-600 cursor-pointer disabled:opacity-50"
                  />
                </th>
              )}
              <Th>User ID</Th>
              {/* Segment column header is context-aware. With no product
                  filter a user can belong to up to 3 segments (one per
                  product they buy) — header becomes "Segments". With a
                  single product filtered, the backend aliases that
                  product's cluster name into `segment` and the header
                  scopes to "{Product} Segment". */}
              <Th>{singleProductLabel ? `${singleProductLabel} Segment` : "Segments"}</Th>
              {/* Products column. No filter → list every product the user
                  buys. Single product filtered → list the OTHER products
                  they buy (the filtered one is implicit since every row has
                  it). Heading rewords accordingly. */}
              <Th title={singleProductLabel
                ? `Other products this ${singleProductLabel} customer buys`
                : "All products this user buys"}>
                {singleProductLabel ? "Also Buys" : "Products"}
              </Th>
              <Th>Country</Th>
              <Th>Platform</Th>
              <Th>Language</Th>
              {/* Metric headers reflect the active filter so the value's
                  meaning is unambiguous — e.g. "Calls Recency" when
                  filtered to Calls. */}
              <Th title={singleProductLabel ? `Days since last ${singleProductLabel} purchase` : "Days since last purchase across any product"}>
                {singleProductLabel ? `${singleProductLabel} Recency` : "Recency"}
              </Th>
              <Th title={singleProductLabel ? `Number of ${singleProductLabel} purchases` : "Total purchases across all products"}>
                {singleProductLabel ? `${singleProductLabel} Purchases` : "Purchases"}
              </Th>
              <Th title={singleProductLabel ? `Spend on ${singleProductLabel} only` : "Total spend across all products"}>
                {singleProductLabel ? `${singleProductLabel} Spend` : "Total Spend"}
              </Th>
              <Th>Reactivation</Th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={selectionEnabled ? 11 : 10} className="text-center py-12 text-gray-400">No users found</td>
              </tr>
            ) : (
              users.map((u) => {
                const checked = selectionEnabled && selectedIds.has(u.id_client);
                return (
                  <tr
                    key={u.id_client}
                    onClick={() => selectionEnabled && onToggle(u.id_client)}
                    className={`border-b border-gray-50 transition ${
                      selectionEnabled ? "cursor-pointer" : ""
                    } ${
                      checked ? "bg-purple-50/70 hover:bg-purple-50" : "hover:bg-gray-50"
                    }`}
                  >
                    {selectionEnabled && (
                      <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select user ${u.id_client}`}
                          checked={checked}
                          onChange={() => onToggle(u.id_client)}
                          className="w-4 h-4 accent-purple-600 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3 font-medium text-gray-800 whitespace-nowrap">{u.id_client}</td>
                    <td className="px-3 py-3">
                      {/* Single product filtered → backend already aliased
                          that product's cluster name into `segment`. No
                          filter → user can belong to up to 3 segments
                          (one per product), so list them all. */}
                      {singleProductLabel
                        ? <SegmentBadge segment={u.segment} />
                        : <SegmentBadges user={u} />}
                    </td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap">
                      <ProductsCell user={u} hideKey={singleProductLabel ? FILTER_TO_KEY[singleProductLabel] : null} />
                    </td>
                    <td className="px-3 py-3 text-gray-500 text-xs whitespace-nowrap">{u.user_country ?? "—"}</td>
                    <td className="px-3 py-3 text-gray-600 text-xs whitespace-nowrap">{u.platform ?? "—"}</td>
                    <td className="px-3 py-3 text-gray-600 text-xs capitalize whitespace-nowrap">{u.language ?? "—"}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><RecencyBadge days={u.recency} /></td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{u.purchase_frequency ?? "—"}</td>
                    <td className="px-3 py-3 font-medium text-gray-700 whitespace-nowrap">
                      {u.total_spent != null ? `$${u.total_spent.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap"><ReactivationBadge score={u.reactivation_score} recency={u.recency} cutoffs={reactivationCutoffs} /></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-3 border-t border-gray-100 text-sm text-gray-500">
          <span>{total.toLocaleString()} total users</span>
          <div className="flex items-center gap-2">
            <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  );
}
