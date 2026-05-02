import { useState } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import { query as queryApi } from "../api";
import { useQueryFilter } from "../context/QueryFilterContext";

// Smart Query needs vanna + ChromaDB on the backend, which the deployed Render
// build doesn't include. Gate the UI on a build-time env var so production
// builds simply omit it. Default true for local dev.
const SMART_QUERY_ENABLED = (import.meta.env.VITE_ENABLE_SMART_QUERY ?? "true") !== "false";

export default function SmartQueryBar() {
  if (!SMART_QUERY_ENABLED) return null;
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { activeFilter, applyFilter, clearFilter } = useQueryFilter();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await queryApi.ask(input.trim());
      applyFilter({
        question: input.trim(),
        summary: data.summary,
        userIds: data.user_ids || [],
        sql: data.sql,
        columns: data.columns,
        rows: data.rows,
      });
    } catch (err) {
      setError(err.response?.data?.detail || "Query failed. Try rephrasing.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-xl p-4 mb-6 bg-white border border-violet-100"
      style={{ borderLeft: "4px solid #5B3A9E" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} style={{ color: "#5B3A9E" }} />
        <span className="text-gray-800 font-semibold text-sm">Smart Filter Query</span>
        <span className="text-gray-400 text-xs">Ask in natural language, we'll filter automatically</span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 'Show premium users inactive for 60+ days with high revenue'"
          className="flex-1 bg-gray-50 border border-gray-200 text-gray-800 placeholder-gray-400 rounded-lg px-4 py-2 text-sm outline-none focus:border-violet-400 focus:bg-white transition"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex items-center gap-2 text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50 transition"
          style={{ backgroundColor: "#5B3A9E" }}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          Apply Filters
        </button>
      </form>

      {error && (
        <p className="mt-2 text-red-500 text-xs">{error}</p>
      )}

      {activeFilter && (
        <div className="mt-3 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-gray-800 text-xs font-semibold">Active filter: "{activeFilter.question}"</p>
            {activeFilter.summary && (
              <p className="text-gray-500 text-xs mt-0.5">{activeFilter.summary}</p>
            )}
            {activeFilter.userIds?.length > 0 && (
              <p className="text-gray-400 text-xs mt-0.5">{activeFilter.userIds.length} users matched</p>
            )}
          </div>
          <button onClick={clearFilter} className="text-gray-400 hover:text-gray-600 mt-0.5 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
