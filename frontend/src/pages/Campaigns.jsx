import React, { useState, useEffect, useRef } from "react";
import {
  Megaphone, Users, Sparkles, Send, CheckCircle, ChevronDown,
  ChevronUp, Filter, Clock, DollarSign, Target, BarChart2,
  RefreshCw, Eye, FileText, Zap, AlertCircle, X, Copy, Check,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { analytics, campaigns as campaignsApi, segmentation } from "../api";
import { SEGMENT_COLORS, KPI } from "../constants/colors";

/** All 22 real promo codes from the Excel */
const OFFERS = [
  // Universal
  { code: "SAVEBIG",    label: "Save Big",            discount: "10% off",    product: "All",            description: "10% off any Numero purchase", tier: 3 },
  // eSIM
  { code: "TRAVEL5",    label: "Travel Data",          discount: "5% off",     product: "Data eSIM",      description: "5% off eSIM travel data plans", tier: 1 },
  { code: "ONLINE5",    label: "Full eSIM",            discount: "5% off",     product: "Data eSIM",      description: "5% off Full eSIM plans", tier: 2 },
  // Virtual Number
  { code: "NUMBER5",    label: "Virtual Number",       discount: "$5 off",     product: "Virtual Number", description: "$5 off any virtual number purchase", tier: 1 },
  { code: "NUMBER10",   label: "Virtual Number",       discount: "$10 off",    product: "Virtual Number", description: "$10 off any virtual number purchase", tier: 2 },
  { code: "NUMBER15",   label: "Virtual Number",       discount: "$15 off",    product: "Virtual Number", description: "$15 off any virtual number purchase", tier: 3 },
  { code: "NUMBER20",   label: "Virtual Number",       discount: "$20 off",    product: "Virtual Number", description: "$20 off any virtual number purchase", tier: 4 },
  { code: "SMNUMBER10", label: "US Social Media #",    discount: "$10 off",    product: "Virtual Number", description: "$10 off USA Social Media virtual number", tier: 2 },
  // Calls — credit bonus
  { code: "CALL5",      label: "Call Credit",          discount: "+$5 credit", product: "Calls",          description: "$5 bonus calling credit on next recharge", tier: 1 },
  { code: "CALL10",     label: "Call Credit",          discount: "+$10 credit",product: "Calls",          description: "$10 bonus calling credit on next recharge", tier: 2 },
  { code: "CALL15",     label: "Call Credit",          discount: "+$15 credit",product: "Calls",          description: "$15 bonus calling credit on next recharge", tier: 3 },
  { code: "CALL20",     label: "Call Credit",          discount: "+$20 credit",product: "Calls",          description: "$20 bonus calling credit on next recharge", tier: 4 },
  // Calls — offer discount
  { code: "TALK5",      label: "Calling Offers",       discount: "5% off",     product: "Calls",          description: "5% off all calling offers", tier: 1 },
  { code: "TALK10",     label: "Calling Offers",       discount: "10% off",    product: "Calls",          description: "10% off all calling offers", tier: 2 },
  { code: "TALK15",     label: "Calling Offers",       discount: "15% off",    product: "Calls",          description: "15% off all calling offers", tier: 3 },
  { code: "TALK20",     label: "Calling Offers",       discount: "20% off",    product: "Calls",          description: "20% off all calling offers", tier: 4 },
  // Local plans
  { code: "LOCAL5",     label: "Local Plan",           discount: "$5 off",     product: "Local",          description: "$5 off local calling plans", tier: 1 },
  { code: "LOCAL10",    label: "Local Plan",           discount: "$10 off",    product: "Local",          description: "$10 off local calling plans", tier: 2 },
  { code: "LOCAL15",    label: "Local Plan",           discount: "$15 off",    product: "Local",          description: "$15 off local calling plans", tier: 3 },
  { code: "LOCAL20",    label: "Local Plan",           discount: "$20 off",    product: "Local",          description: "$20 off local calling plans", tier: 4 },
];

/** Returns { code, altCode, reason, confidence } */
function matchOffer(segment, productGroup, recencyMin) {
  const TIER_MAP = {
    "High Value Loyal":             1,
    "High Value Customers":         1,
    "New / Low-Value Active Users": 1,
    "Low Value Active":             2,
    "Mid Value At-Risk":            2,
    "Occasional High Spenders":     3,
    "High Value At-Risk":           3,
    "Churned / At-Risk Users":      4,
  };
  let tier = TIER_MAP[segment] ?? 2;

  // Very dormant → one tier more aggressive
  if (recencyMin != null && recencyMin >= 365 && tier < 4) tier++;

  // Confidence: how many signals we have
  const signals = [segment, productGroup, recencyMin != null ? 1 : null].filter(Boolean).length;
  const confidence = Math.round((signals / 3) * 100);

  const product = productGroup || "All";

  if (product === "Calls") {
    const code    = ["CALL5",  "CALL10",  "CALL15",  "CALL20"][tier - 1];
    const altCode = ["TALK5",  "TALK10",  "TALK15",  "TALK20"][tier - 1];
    return {
      code, altCode, confidence,
      reason: tier <= 2
        ? "Calling credit bonuses drive re-engagement better than discounts — immediate tangible value users can see on their balance."
        : "Heavy credit bonus chosen: this segment has high churn risk. A large credit feels like a gift, lowering price-resistance.",
    };
  }
  if (product === "Data eSIM") {
    if (tier === 1) return { code: "TRAVEL5",  confidence, reason: "Light travel discount for recently active eSIM users — keeps them engaged without over-investing." };
    if (tier === 2) return { code: "ONLINE5",  confidence, reason: "Full eSIM discount for at-risk users — broader applicability increases redemption rate." };
    return              { code: "SAVEBIG",   confidence, reason: "Max 10% all-product offer: churned eSIM users need a big nudge to overcome inertia. Broad validity removes friction." };
  }
  if (product === "Virtual Number") {
    const code = ["NUMBER5", "NUMBER10", "NUMBER15", "NUMBER20"][tier - 1];
    return {
      code, confidence,
      reason: "Dollar-off codes directly address renewal cost — the #1 reason virtual number users churn. Higher discount for higher-risk segments.",
    };
  }
  // Mixed / no product
  if (tier >= 3) return { code: "SAVEBIG",  confidence, reason: "No dominant product — broad 10% discount maximises relevance across any product the user might choose." };
  return               { code: "LOCAL5",   confidence, reason: "Gentle local-plan nudge for low-risk audience. Avoids over-discounting users who were already active." };
}

function buildMessage(offer, filters) {
  const productLine = {
    "Calls":          "calling credits & recharge offers",
    "Data eSIM":      "eSIM data plans",
    "Virtual Number": "virtual number plans",
  }[filters.productType] || "Numero products";

  return `Hi [First Name] 👋

We noticed it's been a while — we've missed you at Numero!

As a valued customer, here's an exclusive offer just for you:

🎁 *${offer.code}* — ${offer.discount}
${offer.description}

Apply at checkout on your next ${productLine} purchase.

⏰ This offer is valid for *7 days only* — don't let it slip!

👉 Tap to explore: https://numero.app/

Questions? Just reply here, we're always happy to help.

— The Numero Team`;
}

/* ─────────────────────────── Sub-components ─────────────────────────── */

function KpiCard({ icon: Icon, label, value, sub, color = "purple" }) {
  const colors = {
    purple: "bg-purple-50 text-purple-600",
    green:  "bg-green-50  text-green-600",
    amber:  "bg-amber-50  text-amber-600",
    blue:   "bg-blue-50   text-blue-600",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3 shadow-sm">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-gray-400 font-medium">{label}</div>
        <div className="text-xl font-bold text-gray-800 leading-tight">{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function ConfidenceBar({ pct }) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-gray-300";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function WaPreview({ message }) {
  return (
    <div
      className="relative mx-auto rounded-[36px] border-[6px] border-gray-800 shadow-2xl overflow-hidden bg-[#111B21] flex flex-col"
      style={{ width: 260, height: 470 }}
    >
      {/* Status bar */}
      <div className="flex justify-between px-5 pt-2 pb-0.5">
        <span className="text-white/60 text-[9px] font-medium">9:41</span>
        <span className="text-white/60 text-[9px]">●●● 🔋</span>
      </div>
      {/* WA header */}
      <div className="bg-[#1F2C34] px-3 py-2 flex items-center gap-2 border-b border-white/5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">N</div>
        <div className="min-w-0">
          <div className="text-white text-[11px] font-semibold leading-tight">Numero eSIM</div>
          <div className="text-green-400 text-[9px]">online</div>
        </div>
      </div>
      {/* Chat bg */}
      <div className="flex-1 bg-[#0B141A] p-2 overflow-hidden">
        {/* Incoming bubble */}
        <div className="bg-[#1F2C34] rounded-xl rounded-tl-none px-3 py-2 max-w-[95%] shadow-sm">
          <div className="text-[10px] text-gray-200 leading-relaxed whitespace-pre-line break-words">
            {message.split(/(\*[^*]+\*)/g).map((part, i) =>
              part.startsWith("*") && part.endsWith("*")
                ? <strong key={i} className="text-white">{part.slice(1, -1)}</strong>
                : <span key={i}>{part}</span>
            )}
          </div>
          <div className="text-right text-gray-600 text-[8px] mt-1">10:24 AM ✓✓</div>
        </div>
      </div>
      {/* Input bar */}
      <div className="bg-[#1F2C34] px-3 py-2 flex items-center gap-2 border-t border-white/5">
        <div className="flex-1 bg-[#2A3942] rounded-full px-3 py-1.5 text-gray-500 text-[9px]">Message…</div>
        <div className="w-6 h-6 bg-[#00A884] rounded-full flex items-center justify-center">
          <Send size={10} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft:     "bg-gray-100   text-gray-600",
    queued:    "bg-amber-100  text-amber-700",
    sending:   "bg-blue-100   text-blue-700",
    sent:      "bg-green-100  text-green-700",
    completed: "bg-green-100  text-green-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${map[status] || map.draft}`}>
      {status}
    </span>
  );
}

function PctCell({ num, denom }) {
  if (!denom) return <span className="text-gray-300">—</span>;
  const pct = Math.round((num / denom) * 100);
  return (
    <span>
      {num.toLocaleString()}
      <span className="text-gray-400 text-xs ml-1">({pct}%)</span>
    </span>
  );
}

/* ─────────────────────────── Audience Selector ─────────────────────────── */

const AUDIENCE_PRODUCT_TABS = ["All", "Calls", "Data eSIM", "Virtual Number"];

function AudienceSelector({ segments, loadingSegments, selectedSegment, selectedProductType, onSelectSegment, onSelectProductType }) {
  const maxCount = segments.length ? Math.max(...segments.map(s => s.user_count)) : 1;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <Target size={16} className="text-purple-500" />
          Select Audience
        </h2>
        {loadingSegments && <RefreshCw size={13} className="animate-spin text-gray-400" />}
      </div>

      {/* Product type tabs */}
      <div>
        <div className="text-xs text-gray-400 font-medium mb-2">Filter by product type</div>
        <div className="flex gap-1.5 flex-wrap">
          {AUDIENCE_PRODUCT_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => onSelectProductType(tab === "All" ? null : tab)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition ${
                (tab === "All" ? !selectedProductType : selectedProductType === tab)
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Use the filter bar above to also filter by country, recency, or spend
        </p>
      </div>

      {/* Segment cards grid + bar chart side by side */}
      <div className="flex gap-5 items-start">

        {/* 4-column segment card grid */}
        <div className="flex-1 grid grid-cols-4 gap-3 min-w-0">
          {loadingSegments && segments.length === 0
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-3 animate-pulse bg-gray-50 h-24" />
              ))
            : segments.map(seg => {
                const color = SEGMENT_COLORS[seg.segment] || KPI.purple;
                const isSelected = selectedSegment === seg.segment;
                return (
                  <div
                    key={seg.segment}
                    className={`border rounded-xl p-3 flex flex-col gap-1.5 transition cursor-pointer hover:shadow-md ${
                      isSelected
                        ? "border-purple-400 bg-purple-50 shadow-sm"
                        : "border-gray-100 hover:border-gray-200 bg-white"
                    }`}
                    onClick={() => onSelectSegment(isSelected ? null : seg.segment)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-semibold text-gray-700 leading-tight line-clamp-2">
                        {seg.segment}
                      </span>
                    </div>
                    <div className="text-base font-bold text-gray-800 tabular-nums">
                      {seg.user_count != null ? seg.user_count.toLocaleString() : "—"}
                    </div>
                    <div className="text-[10px] text-gray-400 leading-tight">
                      {seg.percentage != null ? `${seg.percentage.toFixed(1)}% of users` : "users"}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onSelectSegment(isSelected ? null : seg.segment); }}
                      className={`mt-auto text-[10px] font-semibold px-2.5 py-1 rounded-full transition w-fit ${
                        isSelected
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-700"
                      }`}
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
                  </div>
                );
              })
          }
        </div>

        {/* Mini horizontal bar chart */}
        {segments.length > 0 && (
          <div className="shrink-0 w-56">
            <div className="text-xs text-gray-400 font-medium mb-2">Users per segment</div>
            <ResponsiveContainer width="100%" height={segments.length * 28}>
              <BarChart
                data={segments}
                layout="vertical"
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                barSize={10}
              >
                <XAxis
                  type="number"
                  hide
                  domain={[0, maxCount]}
                />
                <YAxis
                  type="category"
                  dataKey="segment"
                  width={0}
                  tick={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(124,46,190,0.06)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2 text-xs">
                        <div className="font-semibold text-gray-700">{d.segment}</div>
                        <div className="text-gray-500">{d.user_count?.toLocaleString()} users</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="user_count" radius={[0, 4, 4, 0]}>
                  {segments.map(seg => (
                    <Cell
                      key={seg.segment}
                      fill={SEGMENT_COLORS[seg.segment] || KPI.purple}
                      opacity={selectedSegment && selectedSegment !== seg.segment ? 0.35 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Main page ─────────────────────────── */

export default function Campaigns() {
  const {
    filters, apiParams, hasActiveFilter, selectedUserCount,
    setSegment, setProductType, clearAll,
  } = useGlobalFilter();

  /* Segment overview (always loaded) */
  const [allSegments,     setAllSegments]     = useState([]);
  const [loadingSegments, setLoadingSegments] = useState(false);

  /* Audience data (loaded when filters active) */
  const [stats,        setStats]        = useState(null);
  const [segBreakdown, setSegBreakdown] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);

  /* Past campaigns */
  const [pastCampaigns, setPastCampaigns] = useState([]);

  /* Builder state */
  const [campaignName,    setCampaignName]   = useState("");
  const [selectedCode,    setSelectedCode]   = useState(null);   // manual override
  const [showAllOffers,   setShowAllOffers]  = useState(false);
  const [offerTab,        setOfferTab]       = useState("All");
  const [sending,         setSending]        = useState(false);
  const [sentCampaign,    setSentCampaign]   = useState(null);
  const [nameError,       setNameError]      = useState(false);
  const [copied,          setCopied]         = useState(false);

  /* AI recommendation */
  const rec = matchOffer(filters.segment, filters.productType, filters.recencyMin);
  const activeCode  = selectedCode || rec.code;
  const activeOffer = OFFERS.find(o => o.code === activeCode) || OFFERS[0];
  const messageText = buildMessage(activeOffer, filters);

  /* Fetch all segment overview once on mount */
  useEffect(() => {
    setLoadingSegments(true);
    segmentation.overview({})
      .then(r => {
        const segs = r.data?.segments || [];
        setAllSegments(segs);
      })
      .catch(() => {})
      .finally(() => setLoadingSegments(false));
  }, []);

  /* Fetch audience stats whenever filters change */
  useEffect(() => {
    if (!hasActiveFilter) { setStats(null); setSegBreakdown([]); return; }
    setLoadingStats(true);
    Promise.all([
      analytics.overview(apiParams),
      analytics.segmentSummary(apiParams),
    ]).then(([ov, seg]) => {
      setStats(ov.data);
      setSegBreakdown(seg.data || []);
    }).catch(() => {}).finally(() => setLoadingStats(false));
  }, [JSON.stringify(apiParams), hasActiveFilter]);  // eslint-disable-line

  /* Fetch past campaigns once */
  useEffect(() => {
    campaignsApi.list({}).then(r => setPastCampaigns(r.data || [])).catch(() => {});
  }, []);

  /* Reset override when product/segment filter changes */
  useEffect(() => { setSelectedCode(null); }, [filters.segment, filters.productType]);

  /* Send */
  async function handleSend() {
    if (!campaignName.trim()) { setNameError(true); return; }
    setNameError(false);
    setSending(true);
    try {
      const payload = {
        name:               campaignName.trim(),
        offer_code:         activeCode,
        message_template:   messageText,
        segment_filter:     filters.segment     || null,
        product_filter:     filters.productType || null,
        country_filter:     filters.country     || null,
        recency_min_filter: filters.recencyMin  ?? null,
        recency_max_filter: filters.recencyMax  ?? null,
        spend_min_filter:   filters.spendMin    ?? null,
        spend_max_filter:   filters.spendMax    ?? null,
        total_targeted:     stats?.total_users  || selectedUserCount || 0,
        status:             "queued",
      };
      const r = await campaignsApi.create(payload);
      setSentCampaign(r.data);
      setPastCampaigns(prev => [r.data, ...prev]);
    } finally {
      setSending(false);
    }
  }

  function handleSaveDraft() {
    if (!campaignName.trim()) { setNameError(true); return; }
    setNameError(false);
    const payload = {
      name:               campaignName.trim(),
      offer_code:         activeCode,
      message_template:   messageText,
      segment_filter:     filters.segment     || null,
      product_filter:     filters.productType || null,
      country_filter:     filters.country     || null,
      recency_min_filter: filters.recencyMin  ?? null,
      recency_max_filter: filters.recencyMax  ?? null,
      total_targeted:     stats?.total_users  || selectedUserCount || 0,
      status:             "draft",
    };
    campaignsApi.create(payload)
      .then(r => setPastCampaigns(prev => [r.data, ...prev]))
      .catch(() => {});
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(activeCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /* Filter chips for display */
  const filterChips = [
    filters.segment      && { label: `Segment: ${filters.segment}`,                        color: SEGMENT_COLORS[filters.segment] || KPI.purple },
    filters.productType  && { label: `Product: ${filters.productType}`,                    color: KPI.purple },
    filters.country      && { label: `🌍 ${filters.country}`,                              color: KPI.blue },
    filters.recencyMin != null && { label: `Recency: ${filters.recencyMin}–${filters.recencyMax ?? "∞"}d`, color: KPI.pink },
    filters.spendMin   != null && { label: `Spend: $${filters.spendMin}–${filters.spendMax ?? "∞"}`,       color: KPI.teal },
    filters.nlUserIds    && { label: `NL: "${filters.nlQuestion}"`,                         color: KPI.purple },
    filters.lassoUserIds && { label: `${filters.lassoUserIds.length.toLocaleString()} map-selected`, color: KPI.purple },
  ].filter(Boolean);

  /* Post-send success screen */
  if (sentCampaign) {
    return (
      <div>
        <PageHeader />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-5">
            <CheckCircle size={40} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">Campaign Queued!</h2>
          <p className="text-gray-500 text-sm mb-1">
            <strong>{sentCampaign.name}</strong> is queued for{" "}
            <strong>{(sentCampaign.total_targeted || 0).toLocaleString()} users</strong>.
          </p>
          <p className="text-xs text-gray-400 mb-2">
            Offer code <strong className="font-mono">{sentCampaign.offer_code}</strong> · wa-bot will start sending within 60 seconds
          </p>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setSentCampaign(null)} className="btn-primary">Create Another</button>
            <button onClick={clearAll}                    className="btn-outline">Clear Filters</button>
          </div>
        </div>

        <PastCampaignsTable campaigns={pastCampaigns} />
      </div>
    );
  }

  /* Offer picker tabs */
  const PRODUCT_TABS = ["All", "Calls", "Data eSIM", "Virtual Number", "Local"];
  const filteredOffers = offerTab === "All" ? OFFERS : OFFERS.filter(o => o.product === offerTab || o.product === "All");

  return (
    <div className="space-y-5">
      <PageHeader />

      {/* ── Section 1: Audience Selector (always visible) ───────── */}
      <AudienceSelector
        segments={allSegments}
        loadingSegments={loadingSegments}
        selectedSegment={filters.segment || null}
        selectedProductType={filters.productType || null}
        onSelectSegment={seg => setSegment(seg)}
        onSelectProductType={pt => setProductType(pt)}
      />

      {/* ── Audience stats (shown when filters active) ────────────── */}
      {hasActiveFilter && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Users size={16} className="text-purple-500" />
              Who you're targeting
            </h2>
            {loadingStats && <RefreshCw size={13} className="animate-spin text-gray-400" />}
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <KpiCard
              icon={Users} color="purple" label="Users targeted"
              value={
                loadingStats ? "…" :
                stats ? stats.total_users.toLocaleString() :
                selectedUserCount ? selectedUserCount.toLocaleString() : "—"
              }
              sub="matching your filters"
            />
            <KpiCard
              icon={DollarSign} color="green" label="Avg spend"
              value={stats ? `$${stats.avg_revenue_per_user.toLocaleString()}` : "—"}
              sub="per user (lifetime)"
            />
            <KpiCard
              icon={Clock} color="amber" label="Avg recency"
              value={stats ? `${Math.round(stats.avg_recency_days)}d` : "—"}
              sub="since last purchase"
            />
            <KpiCard
              icon={BarChart2} color="blue" label="Avg frequency"
              value={stats ? `${stats.avg_frequency}` : "—"}
              sub="purchases per user"
            />
          </div>

          {/* Filter chips + segment mini-bars in two columns */}
          <div className="flex gap-4 flex-wrap items-start">
            {/* Active filters */}
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs text-gray-400 font-medium mb-2">Active filters</div>
              <div className="flex flex-wrap gap-1.5">
                {filterChips.map((chip, i) => (
                  <span
                    key={i}
                    className="text-xs font-medium px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: chip.color }}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Segment breakdown mini-bars */}
            {segBreakdown.length > 0 && (
              <div className="flex-1 min-w-[220px]">
                <div className="text-xs text-gray-400 font-medium mb-2">Segment breakdown</div>
                <div className="space-y-1.5">
                  {segBreakdown.slice(0, 5).map(s => {
                    const total = segBreakdown.reduce((a, b) => a + b.user_count, 0);
                    const pct   = total ? Math.round((s.user_count / total) * 100) : 0;
                    return (
                      <div key={s.segment} className="flex items-center gap-2">
                        <div className="text-xs text-gray-600 w-36 truncate shrink-0">{s.segment}</div>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: SEGMENT_COLORS[s.segment] || "#6B7280" }}
                          />
                        </div>
                        <div className="text-xs text-gray-400 w-10 text-right shrink-0">{s.user_count.toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sections 2 + 3: Offer + Message (always visible) ──────── */}
      <div className="grid grid-cols-5 gap-5">

        {/* ── Section 2: AI Offer Recommendation ──────────────── */}
        <div className="col-span-3 space-y-4">

          {/* AI Pick */}
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={15} className="text-amber-500" />
              <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">AI Recommendation</span>
              {!filters.segment && !filters.productType && (
                <span className="ml-1 text-xs text-gray-400 font-normal">(generic audience)</span>
              )}
              <span className="ml-auto text-xs text-gray-400">Match confidence</span>
            </div>
            <ConfidenceBar pct={rec.confidence} />

            <div className="mt-4 flex items-start gap-4">
              {/* Code badge */}
              <div className="shrink-0">
                <div
                  className="bg-gradient-to-br from-purple-600 to-purple-800 text-white font-mono font-bold text-xl px-5 py-3 rounded-xl shadow-lg tracking-wider cursor-pointer select-all hover:opacity-90 transition"
                  onClick={handleCopyCode}
                  title="Click to copy"
                >
                  {activeCode}
                </div>
                <button
                  onClick={handleCopyCode}
                  className="mt-1.5 w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition"
                >
                  {copied ? <><Check size={10} className="text-green-500" /> Copied!</> : <><Copy size={10} /> Copy code</>}
                </button>
              </div>

              {/* Offer details */}
              <div className="flex-1 min-w-0">
                <div className="text-lg font-bold text-gray-800 leading-tight">{activeOffer.discount}</div>
                <div className="text-sm text-gray-500 mt-0.5">{activeOffer.description}</div>

                <div className="mt-3 bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <div className="text-xs font-semibold text-amber-700 mb-1">Why this offer?</div>
                  <p className="text-xs text-amber-800 leading-relaxed">{rec.reason}</p>
                </div>

                {rec.altCode && !selectedCode && (
                  <button
                    onClick={() => setSelectedCode(rec.altCode)}
                    className="mt-2 text-xs text-purple-600 hover:text-purple-800 underline"
                  >
                    Alternative: use {rec.altCode} instead →
                  </button>
                )}
                {selectedCode && (
                  <button
                    onClick={() => setSelectedCode(null)}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                  >
                    ↩ Revert to AI pick ({rec.code})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Override picker */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <button
              onClick={() => setShowAllOffers(v => !v)}
              className="w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              <span className="flex items-center gap-2">
                <RefreshCw size={14} className="text-gray-400" />
                Choose a different offer
                <span className="text-xs text-gray-400 font-normal">({OFFERS.length} available)</span>
              </span>
              {showAllOffers ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>

            {showAllOffers && (
              <div className="mt-4">
                {/* Product tabs */}
                <div className="flex gap-1 mb-3 flex-wrap">
                  {PRODUCT_TABS.map(t => (
                    <button
                      key={t}
                      onClick={() => setOfferTab(t)}
                      className={`px-3 py-1 text-xs font-medium rounded-full transition ${
                        offerTab === t
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Offer grid */}
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {filteredOffers.map(offer => (
                    <button
                      key={offer.code}
                      onClick={() => { setSelectedCode(offer.code); setShowAllOffers(false); }}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        activeCode === offer.code
                          ? "border-purple-400 bg-purple-50"
                          : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-bold text-gray-800 text-xs">{offer.code}</span>
                        <span className="text-xs text-purple-600 font-semibold">{offer.discount}</span>
                      </div>
                      <div className="text-xs text-gray-400 leading-tight">{offer.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Section 3: Message Preview + Send ────────────────── */}
        <div className="col-span-2 space-y-4">

          {/* Campaign name */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
              Campaign Name
            </label>
            <input
              value={campaignName}
              onChange={e => { setCampaignName(e.target.value); setNameError(false); }}
              placeholder="e.g. May Win-back · Calls Segment"
              className={`w-full border rounded-xl px-4 py-2.5 text-sm outline-none transition ${
                nameError
                  ? "border-red-300 focus:border-red-400 bg-red-50"
                  : "border-gray-200 focus:border-purple-400 focus:ring-1 focus:ring-purple-100"
              }`}
            />
            {nameError && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={11} /> Please name your campaign before sending
              </p>
            )}
          </div>

          {/* WA preview */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Message Preview
            </div>
            <WaPreview message={messageText} />
            <p className="text-center text-xs text-gray-400 mt-3 leading-relaxed">
              Each user receives a version personalised with their name.
              The wa-bot also adapts tone based on their segment.
            </p>
          </div>

          {/* Actions */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white font-semibold py-3 rounded-xl hover:bg-purple-700 disabled:opacity-60 transition shadow-sm"
            >
              {sending
                ? <><RefreshCw size={15} className="animate-spin" /> Queuing…</>
                : <><Send size={15} /> Approve &amp; Send Campaign</>
              }
            </button>
            <button
              onClick={handleSaveDraft}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition text-sm"
            >
              <FileText size={14} />
              Save as Draft
            </button>
          </div>
        </div>
      </div>

      {/* ── Section 4: Past Campaigns ─────────────────────────────── */}
      <PastCampaignsTable campaigns={pastCampaigns} />
    </div>
  );
}

/* ─────────────────────────── Past Campaigns ─────────────────────────── */

function PastCampaignsTable({ campaigns }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <BarChart2 size={16} className="text-purple-500" />
          Past Campaigns
        </h2>
        <span className="text-xs text-gray-400">{campaigns.length} total</span>
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center py-14 text-center">
          <Megaphone size={32} className="text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No campaigns sent yet</p>
          <p className="text-xs text-gray-300 mt-1">Approved campaigns will appear here with live delivery stats</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 font-medium border-b border-gray-50">
                <th className="text-left px-5 py-3">Campaign</th>
                <th className="text-left px-3 py-3">Offer</th>
                <th className="text-left px-3 py-3">Audience</th>
                <th className="text-right px-3 py-3">Targeted</th>
                <th className="text-right px-3 py-3">Delivered</th>
                <th className="text-right px-3 py-3">Read</th>
                <th className="text-right px-3 py-3">Replied</th>
                <th className="text-right px-3 py-3">Converted</th>
                <th className="text-center px-3 py-3">Status</th>
                <th className="text-right px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">{c.name}</div>
                    {c.segment_filter && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]">{c.segment_filter}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-semibold">
                      {c.offer_code || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {[c.product_filter, c.country_filter].filter(Boolean).join(" · ") || "All"}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-gray-700">
                    {(c.total_targeted || 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-600">
                    <PctCell num={c.delivered_count} denom={c.sent_count} />
                  </td>
                  <td className="px-3 py-3 text-right text-gray-600">
                    <PctCell num={c.read_count} denom={c.sent_count} />
                  </td>
                  <td className="px-3 py-3 text-right text-gray-600">
                    <PctCell num={c.replied_count} denom={c.sent_count} />
                  </td>
                  <td className="px-3 py-3 text-right text-gray-600">
                    <PctCell num={c.converted_count} denom={c.sent_count} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mb-1">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
        <Megaphone size={22} className="text-purple-600" />
        Campaign Builder
      </h1>
      <p className="text-gray-400 text-sm mt-0.5">
        Target a segment · get an AI-matched offer · preview &amp; send via WhatsApp
      </p>
    </div>
  );
}
