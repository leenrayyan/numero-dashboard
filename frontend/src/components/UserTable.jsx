import { ChevronLeft, ChevronRight } from "lucide-react";

const SEGMENT_COLORS = {
  // Calls
  "High Value Loyal":              "bg-green-100 text-green-700",
  "Mid Value At-Risk":             "bg-yellow-100 text-yellow-700",
  // eSIM
  "High Value Customers":          "bg-purple-100 text-purple-700",
  "Churned / At-Risk Users":       "bg-red-100 text-red-700",
  "New / Low-Value Active Users":  "bg-cyan-100 text-cyan-700",
  // Virtual
  "High Value At-Risk":            "bg-orange-100 text-orange-700",
  "Occasional High Spenders":      "bg-indigo-100 text-indigo-700",
  // Shared
  "Low Value Active":              "bg-blue-100 text-blue-700",
};

function SegmentBadge({ segment }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEGMENT_COLORS[segment] || "bg-gray-100 text-gray-600"}`}>
      {segment}
    </span>
  );
}

function RecencyBadge({ days }) {
  if (days == null) return <span className="text-gray-400">—</span>;
  const cls = days > 365 ? "badge-low" : days > 180 ? "badge-medium" : "badge-high";
  return <span className={cls}>{days}d</span>;
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">User ID</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Segment</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Primary Product</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Recency</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Purchases</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Spend</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Country</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center py-12 text-gray-400">No users found</td>
            </tr>
          ) : (
            users.map((u) => (
              <tr key={u.id_client} className="border-b border-gray-50 hover:bg-gray-50 transition">
                <td className="px-5 py-3 font-medium text-gray-800">{u.id_client}</td>
                <td className="px-5 py-3"><SegmentBadge segment={u.segment} /></td>
                <td className="px-5 py-3 text-gray-500 text-xs">{u.primary_product_group ?? "—"}</td>
                <td className="px-5 py-3"><RecencyBadge days={u.recency} /></td>
                <td className="px-5 py-3 text-gray-600">{u.purchase_frequency ?? "—"}</td>
                <td className="px-5 py-3 font-medium text-gray-700">
                  {u.total_spent != null ? `$${u.total_spent.toFixed(2)}` : "—"}
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">{u.user_country ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

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
