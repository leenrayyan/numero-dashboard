import { useState, useEffect } from "react";
import {
  Download, BarChart2, Users, FileText, Megaphone,
  TrendingUp, AlertCircle, RefreshCw,
  ChevronDown, ChevronUp, Info, Clock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { campaigns as campaignsApi, exports as exportsApi, analytics } from "../api";
import { FUNNEL_COLORS } from "../constants/colors";

function pct(num, denom) {
  if (!denom || !num) return 0;
  return Math.round((num / denom) * 100);
}
function fmt(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString();
}

function PendingBadge({ label }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
      <Clock size={10} />
      {label || "Pending wa-bot"}
    </span>
  );
}

function StatCard({ label, value, sub, pending = false }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="text-xs text-gray-400 font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-800 leading-tight">
        {pending ? <PendingBadge /> : value ?? "—"}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    draft:     "bg-gray-100  text-gray-600",
    queued:    "bg-amber-100 text-amber-700",
    sending:   "bg-blue-100  text-blue-700",
    sent:      "bg-green-100 text-green-700",
    completed: "bg-green-100 text-green-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize shrink-0 ${map[status] || map.draft}`}>
      {status}
    </span>
  );
}

function FilterChip({ label }) {
  return <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">{label}</span>;
}

function CampaignFunnel({ campaign }) {
  const t = campaign.total_targeted  || 0;
  const s = campaign.sent_count      || 0;
  const d = campaign.delivered_count || 0;
  const r = campaign.read_count      || 0;
  const p = campaign.replied_count   || 0;
  const c = campaign.converted_count || 0;

  const stages = [
    { label: "Targeted",  value: t, key: "targeted"  },
    { label: "Sent",      value: s, key: "sent"       },
    { label: "Delivered", value: d, key: "delivered"  },
    { label: "Read",      value: r, key: "read"       },
    { label: "Replied",   value: p, key: "replied"    },
    { label: "Converted", value: c, key: "converted"  },
  ];

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={stages} layout="vertical" margin={{ left: 60, right: 50, top: 4, bottom: 4 }}>
        <XAxis type="number" hide domain={[0, Math.max(t, 1)]} />
        <YAxis type="category" dataKey="label" width={60} tick={{ fontSize: 11, fill: "#6B7280" }} />
        <Tooltip
          formatter={(val, _name, props) => {
            const p = t ? `(${pct(val, t)}%)` : "";
            return [`${val.toLocaleString()} ${p}`, props.payload.label];
          }}
          contentStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {stages.map(s => <Cell key={s.key} fill={FUNNEL_COLORS[s.key]} />)}
          <LabelList
            dataKey="value"
            position="right"
            style={{ fontSize: 10, fill: "#6B7280" }}
            formatter={v => v ? v.toLocaleString() : ""}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ExportCard({ icon: Icon, title, description, filterNote, onDownload, disabled = false }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-start gap-3 mb-4 flex-1">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
          <Icon size={18} className="text-purple-600" />
        </div>
        <div>
          <div className="font-semibold text-gray-800">{title}</div>
          <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</div>
          {filterNote && (
            <div className="text-xs text-purple-600 mt-1.5 flex items-center gap-1">
              <Info size={10} /> {filterNote}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDownload}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-purple-700 disabled:opacity-40 transition shadow-sm"
      >
        <Download size={14} />
        Download CSV
      </button>
    </div>
  );
}

/* ─── Main ─── */
export default function Reports() {
  const { apiParams, hasActiveFilter, filters } = useGlobalFilter();

  const [campaigns,    setCampaigns]   = useState([]);
  const [stats,        setStats]       = useState(null);
  const [loading,      setLoading]     = useState(true);
  const [expandedRow,  setExpandedRow] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      campaignsApi.list({}).catch(() => ({ data: [] })),
      analytics.overview(apiParams).catch(() => ({ data: null })),
    ]).then(([c, s]) => {
      setCampaigns(c.data || []);
      setStats(s.data);
    }).finally(() => setLoading(false));
  }, [JSON.stringify(apiParams)]); // eslint-disable-line

  /* Aggregate KPIs */
  const totalTargeted  = campaigns.reduce((a, c) => a + (c.total_targeted  || 0), 0);
  const totalSent      = campaigns.reduce((a, c) => a + (c.sent_count      || 0), 0);
  const totalDelivered = campaigns.reduce((a, c) => a + (c.delivered_count || 0), 0);
  const totalRead      = campaigns.reduce((a, c) => a + (c.read_count      || 0), 0);
  const totalConverted = campaigns.reduce((a, c) => a + (c.converted_count || 0), 0);

  const sentCampaigns   = campaigns.filter(c => ["sent","sending","completed"].includes(c.status));
  const draftCampaigns  = campaigns.filter(c => c.status === "draft");
  const queuedCampaigns = campaigns.filter(c => c.status === "queued");

  function downloadUsers() {
    window.open(exportsApi.usersUrl(apiParams), "_blank");
  }
  function downloadSegments() {
    const p = {};
    if (filters.segment)     p.segment       = filters.segment;
    if (filters.productType) p.product_group = filters.productType;
    if (filters.country?.length > 0) p.country = filters.country.join(",");
    window.open(exportsApi.segmentsUrl(p), "_blank");
  }
  function downloadCampaigns() {
    window.open(exportsApi.campaignsUrl(), "_blank");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <BarChart2 size={22} className="text-purple-600" />
          Reports &amp; Exports
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Download filtered data · track campaign performance · monitor reactivation
        </p>
      </div>


      {/* ── Exports ─────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Download size={15} className="text-purple-500" />
          Export Data
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <ExportCard
            icon={Users}
            title="User Export"
            description="All users matching your active filters — segment, spend, recency, country, WA reachability flag, reactivation score."
            filterNote={hasActiveFilter ? "Your active filters will be applied" : "No filters active — exports all users (may be large)"}
            onDownload={downloadUsers}
          />
          <ExportCard
            icon={FileText}
            title="Segment Summary"
            description="Aggregated per-segment metrics: user count, avg spend, avg recency, total revenue, WA-reachable count."
            filterNote={filters.productType ? `Filtered to product: ${filters.productType}` : undefined}
            onDownload={downloadSegments}
          />
          <ExportCard
            icon={Megaphone}
            title="Campaign Results"
            description="All campaigns with full funnel rates: targeted → sent → delivered → read → replied → converted."
            onDownload={downloadCampaigns}
            disabled={campaigns.length === 0}
          />
        </div>
      </div>

      {/* ── Campaign Performance ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Megaphone size={15} className="text-purple-500" />
            Campaign Performance
          </h2>
          {loading && <RefreshCw size={13} className="animate-spin text-gray-300" />}
        </div>

        {/* Aggregate KPIs */}
        <div className="grid grid-cols-6 gap-3 p-5 border-b border-gray-50">
          <StatCard label="Campaigns"     value={campaigns.length} sub="total created" />
          <StatCard label="Users targeted" value={fmt(totalTargeted)} sub="across all campaigns" />
          <StatCard label="Sent"          value={fmt(totalSent)}      sub="messages dispatched" />
          <StatCard label="Delivery rate" value={totalSent ? `${pct(totalDelivered,totalSent)}%` : null} pending={!totalSent} sub="delivered / sent" />
          <StatCard label="Read rate"     value={totalSent ? `${pct(totalRead,totalSent)}%` : null}      pending={!totalSent} sub="read / sent" />
          <StatCard label="Conversion"    value={totalSent ? `${pct(totalConverted,totalSent)}%` : null} pending={!totalSent} sub="converted / sent" />
        </div>

        {/* Status summary */}
        <div className="flex gap-3 px-5 py-3 border-b border-gray-50 flex-wrap">
          {sentCampaigns.length   > 0 && <span className="text-xs bg-green-50  text-green-700  px-3 py-1 rounded-full font-medium">{sentCampaigns.length} sent</span>}
          {queuedCampaigns.length > 0 && <span className="text-xs bg-amber-50  text-amber-700  px-3 py-1 rounded-full font-medium">{queuedCampaigns.length} queued — wa-bot will pick up within 60s</span>}
          {draftCampaigns.length  > 0 && <span className="text-xs bg-gray-100  text-gray-600   px-3 py-1 rounded-full font-medium">{draftCampaigns.length} draft</span>}
          {campaigns.length === 0 && !loading && <span className="text-xs text-gray-400">No campaigns yet — create one on the Campaigns page</span>}
        </div>

        {/* Per-campaign rows (expandable) */}
        {campaigns.length > 0 && (
          <div className="divide-y divide-gray-50">
            {campaigns.map(c => (
              <div key={c.id}>
                <button
                  onClick={() => setExpandedRow(expandedRow === c.id ? null : c.id)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/60 transition text-left"
                >
                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 truncate">{c.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{c.created_at ? new Date(c.created_at).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }) : "—"}</span>
                      {c.offer_code && <span className="font-mono bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px]">{c.offer_code}</span>}
                      {c.segment_filter && <span>{c.segment_filter}</span>}
                    </div>
                  </div>

                  {/* Quick metrics */}
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-center">
                      <div className="text-sm font-semibold text-gray-700">{fmt(c.total_targeted)}</div>
                      <div className="text-xs text-gray-400">targeted</div>
                    </div>
                    {c.sent_count > 0 ? (
                      <>
                        <div className="text-center">
                          <div className="text-sm font-semibold text-indigo-600">{pct(c.delivered_count, c.sent_count)}%</div>
                          <div className="text-xs text-gray-400">delivered</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-semibold text-purple-600">{pct(c.read_count, c.sent_count)}%</div>
                          <div className="text-xs text-gray-400">read</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-semibold text-green-600">{pct(c.converted_count, c.sent_count)}%</div>
                          <div className="text-xs text-gray-400">converted</div>
                        </div>
                      </>
                    ) : (
                      <PendingBadge label={
                        c.status === "queued"  ? "Queued — sending soon" :
                        c.status === "sending" ? "Sending…" : "No stats yet"
                      } />
                    )}
                    <StatusPill status={c.status} />
                  </div>

                  {expandedRow === c.id
                    ? <ChevronUp size={16} className="text-gray-400 shrink-0" />
                    : <ChevronDown size={16} className="text-gray-400 shrink-0" />
                  }
                </button>

                {/* Expanded */}
                {expandedRow === c.id && (
                  <div className="px-5 pb-5 bg-gray-50/40 border-t border-gray-50">
                    <div className="text-xs text-gray-400 font-medium py-3">Delivery funnel</div>
                    {c.sent_count > 0 ? (
                      <CampaignFunnel campaign={c} />
                    ) : (
                      <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                        <AlertCircle size={14} className="text-amber-400 shrink-0" />
                        {c.status === "queued"
                          ? "Campaign queued — wa-bot will send messages within 60 seconds"
                          : c.status === "sending"
                          ? "Currently sending — delivery stats will appear as Meta confirms"
                          : "No delivery data yet — stats auto-update via Meta webhook events"
                        }
                      </div>
                    )}

                    {/* Filter chips used */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.segment_filter      && <FilterChip label={`Segment: ${c.segment_filter}`} />}
                      {c.product_filter      && <FilterChip label={`Product: ${c.product_filter}`} />}
                      {c.country_filter      && <FilterChip label={`🌍 ${c.country_filter}`} />}
                      {c.recency_min_filter != null && <FilterChip label={`Recency: ${c.recency_min_filter}–${c.recency_max_filter ?? "∞"}d`} />}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Reactivation Tracker ─────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={15} className="text-purple-500" />
          <h2 className="font-semibold text-gray-800">Reactivation Tracker</h2>
          <span className="ml-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            Partially live
          </span>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Live metrics where available. Conversion and revenue recovery require the wa-bot tracking loop to be fully active.
        </p>

        <div className="grid grid-cols-4 gap-4 mb-4">
          <StatCard
            label="Audience (filtered)"
            value={stats ? fmt(stats.total_users) : "—"}
            sub="users matching current filters"
          />
          <StatCard
            label="Campaigns launched"
            value={sentCampaigns.length}
            sub={`${draftCampaigns.length} draft · ${queuedCampaigns.length} queued`}
          />
          <StatCard
            label="Users reached"
            value={fmt(totalSent)}
            sub="messages dispatched so far"
          />
          <StatCard
            label="Conversions"
            value={totalConverted > 0 ? fmt(totalConverted) : null}
            pending={totalConverted === 0}
            sub="replies flagged as accepted"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Revenue recovered" pending sub="requires conversion → billing link" />
          <StatCard label="Avg time to reactivate" pending sub="days from send to reply" />
          <StatCard label="Best segment (conversion)" pending sub="highest conversion rate segment" />
        </div>

        <div className="mt-4 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl p-3">
          <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 leading-relaxed">
            <strong>Conversion flow:</strong> User replies → wa-bot AI classifies intent → if accepted,
            calls <code className="bg-blue-100 px-1 rounded">PATCH /api/campaigns/recipients/event?event=converted</code> →
            campaign stats update in real-time. Revenue linking requires a separate integration with the company's billing system (phase 2).
          </p>
        </div>
      </div>
    </div>
  );
}
