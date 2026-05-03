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

function RecencyBadge({ days }) {
  if (days == null) return <span className="text-gray-400">—</span>;
  const cls = days > 365 ? "badge-low" : days > 180 ? "badge-medium" : "badge-high";
  return <span className={cls}>{days}d</span>;
}

function ReactivationBadge({ score }) {
  if (score == null) return <span className="text-gray-300 text-xs">—</span>;
  const pct = Math.round(score * 100);
  const tone = pct >= 70 ? "bg-emerald-100 text-emerald-700"
             : pct >= 40 ? "bg-amber-100 text-amber-700"
             : "bg-rose-100 text-rose-700";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tone}`}>
      {pct}%
    </span>
  );
}

export default function UserTable({ users = [], loading = false, total = 0, page = 1, pageSize = 50, onPageChange }) {
  const totalPages = Math.ceil(total / pageSize);

  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <Th>User ID</Th>
              <Th>Segment</Th>
              <Th>Primary Product</Th>
              <Th>Product Types</Th>
              <Th>Platform</Th>
              <Th>Language</Th>
              <Th>Recency</Th>
              <Th>Purchases</Th>
              <Th>Total Spend</Th>
              <Th>Country</Th>
              <Th>Reactivation</Th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-400">No users found</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id_client} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="px-5 py-3 font-medium text-gray-800 whitespace-nowrap">{u.id_client}</td>
                  <td className="px-5 py-3"><SegmentBadge segment={u.segment} /></td>
                  <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">{u.primary_product_group ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs max-w-[200px] truncate" title={u.product_types ?? ""}>
                    {u.product_types ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">{u.platform ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-600 text-xs capitalize whitespace-nowrap">{u.language ?? "—"}</td>
                  <td className="px-5 py-3"><RecencyBadge days={u.recency} /></td>
                  <td className="px-5 py-3 text-gray-600">{u.purchase_frequency ?? "—"}</td>
                  <td className="px-5 py-3 font-medium text-gray-700 whitespace-nowrap">
                    {u.total_spent != null ? `$${u.total_spent.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">{u.user_country ?? "—"}</td>
                  <td className="px-5 py-3"><ReactivationBadge score={u.reactivation_score} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
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
    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  );
}
