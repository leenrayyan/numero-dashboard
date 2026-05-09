import { useState } from "react";
import { Sparkles, Loader2, X, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { query as queryApi } from "../api";
import { useQueryFilter } from "../context/QueryFilterContext";

// Smart Query needs vanna + ChromaDB on the backend. Gate the UI on a build-time
// env var so any build without the dev deps simply omits it. Default true.
const SMART_QUERY_ENABLED = (import.meta.env.VITE_ENABLE_SMART_QUERY ?? "true") !== "false";

const EXAMPLE_QUESTIONS = [
  "How many users are dormant for 90+ days?",
  "Top 10 countries by total revenue",
  "Show users in Egypt with high spend",
  "Average revenue per segment",
  "Users who haven't purchased in 6 months",
];

export default function SmartQueryBar() {
  if (!SMART_QUERY_ENABLED) return null;
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null); // for non-user-list results
  const [lastUserQuery, setLastUserQuery] = useState(null); // {question, sql} for feedback on user-filter results
  const { activeFilter, applyFilter, clearFilter } = useQueryFilter();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setLastUserQuery(null);
    try {
      const { data } = await queryApi.ask(input.trim());
      const kind = data.result_kind || "table";
      if (kind === "users") {
        applyFilter({
          question:     input.trim(),
          summary:      data.summary,
          sql:          data.sql,
          audienceId:   data.audience_id,
          audienceSize: data.audience_size,
        });
        setLastUserQuery({ question: input.trim(), sql: data.sql });
      } else {
        // Aggregate / table result — there's no audience to filter by. Clear
        // any previous NL filter so the dashboard doesn't keep showing the
        // last user-list query's audience while the answer panel shows
        // unrelated country / segment / sum data. Without this, asking
        // "Top 10 countries with most dormant users" right after a
        // user-list query left KPIs filtered to the OLD 10 users —
        // confusing, since the new question didn't return users at all.
        clearFilter();
        setAnswer({
          question: input.trim(),
          summary: data.summary,
          sql: data.sql,
          columns: data.columns,
          rows: data.rows,
          rowCount: data.row_count ?? data.rows?.length ?? 0,
          truncated: data.truncated,
          kind,
        });
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Query failed. Try rephrasing.");
    } finally {
      setLoading(false);
    }
  }

  function pickExample(q) {
    setInput(q);
    setError(null);
  }

  return (
    <div
      className="rounded-xl p-4 mb-6 bg-white border border-violet-100"
      style={{ borderLeft: "4px solid #5B3A9E" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} style={{ color: "#5B3A9E" }} />
        <span className="text-gray-800 font-semibold text-sm">Smart Filter Query</span>
        <span className="text-gray-400 text-xs">Ask in natural language — user lists become filters, aggregates show below.</span>
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
          Ask
        </button>
      </form>

      {error && (
        <div className="mt-2">
          <p className="text-red-500 text-xs">{error}</p>
          <p className="text-gray-500 text-[11px] mt-2 mb-1">Try one of these instead:</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => pickExample(q)}
                className="text-[11px] px-2 py-1 rounded-full bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-100 transition"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeFilter && (
        <div className="mt-3 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-gray-800 text-xs font-semibold">Active filter: "{activeFilter.question}"</p>
              {activeFilter.summary && (
                <p className="text-gray-500 text-xs mt-0.5">{activeFilter.summary}</p>
              )}
              {activeFilter.audienceSize > 0 && (
                <p className="text-gray-400 text-xs mt-0.5">{activeFilter.audienceSize.toLocaleString()} users matched</p>
              )}
            </div>
            <button onClick={clearFilter} className="text-gray-400 hover:text-gray-600 mt-0.5 shrink-0">
              <X size={14} />
            </button>
          </div>

          {lastUserQuery?.sql && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <details className="flex-1 min-w-0">
                <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700">View SQL</summary>
                <pre className="mt-1 bg-white border border-violet-100 rounded p-2 text-[11px] text-gray-700 overflow-x-auto">{lastUserQuery.sql}</pre>
              </details>
              <FeedbackButtons question={lastUserQuery.question} sql={lastUserQuery.sql} />
            </div>
          )}
        </div>
      )}

      {answer && (
        <AnswerPanel answer={answer} onClose={() => setAnswer(null)} />
      )}
    </div>
  );
}

function AnswerPanel({ answer, onClose }) {
  const { question, summary, sql, columns, rows, rowCount, truncated, kind } = answer;
  const isScalar = kind === "scalar" && rows?.length === 1 && columns?.length === 1;

  return (
    <div className="mt-3 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-gray-800 text-xs font-semibold">Answer to: "{question}"</p>
          {summary && <p className="text-gray-600 text-xs mt-0.5">{summary}</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5 shrink-0">
          <X size={14} />
        </button>
      </div>

      {isScalar && (
        <div className="mt-2 text-2xl font-bold text-violet-700">
          {String(rows[0][0] ?? "—")}
          <span className="ml-2 text-xs font-medium text-gray-400">{columns[0]}</span>
        </div>
      )}

      {!isScalar && rows?.length > 0 && (
        <div className="mt-2 max-h-56 overflow-auto border border-violet-100 rounded bg-white">
          <table className="text-xs w-full">
            <thead className="bg-violet-100/60 text-gray-600 sticky top-0">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="text-left px-2 py-1 font-semibold whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-violet-50">
                  {r.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-gray-700 whitespace-nowrap">{v == null ? "—" : String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] text-gray-400">
          {rowCount} row{rowCount === 1 ? "" : "s"}{truncated ? " (showing first 500)" : ""}
        </p>
        <FeedbackButtons question={question} sql={sql} />
      </div>

      {sql && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700">View SQL</summary>
          <pre className="mt-1 bg-white border border-violet-100 rounded p-2 text-[11px] text-gray-700 overflow-x-auto">{sql}</pre>
        </details>
      )}
    </div>
  );
}

function FeedbackButtons({ question, sql }) {
  const [vote, setVote] = useState(null); // "up" | "down" | null
  const [busy, setBusy] = useState(false);

  async function send(v) {
    if (busy || vote) return;
    setBusy(true);
    try {
      await queryApi.feedback({ question, sql, vote: v });
      setVote(v);
    } catch {
      // Silent — feedback is best-effort.
    } finally {
      setBusy(false);
    }
  }

  if (vote) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-violet-600">
        <Check size={11} /> thanks for the feedback
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => send("up")}
        disabled={busy}
        title="This answer looks right"
        className="p-1 rounded hover:bg-violet-100 text-gray-400 hover:text-green-600 transition"
      >
        <ThumbsUp size={12} />
      </button>
      <button
        type="button"
        onClick={() => send("down")}
        disabled={busy}
        title="This answer is wrong"
        className="p-1 rounded hover:bg-violet-100 text-gray-400 hover:text-red-500 transition"
      >
        <ThumbsDown size={12} />
      </button>
    </span>
  );
}
