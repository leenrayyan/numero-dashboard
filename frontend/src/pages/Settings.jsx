import { useState, useEffect } from "react";
import {
  Settings2, CheckCircle, XCircle, Loader2, RefreshCw,
  MessageSquare, Database, Zap, Info, Copy, Check, Phone,
} from "lucide-react";
import api from "../api";

const OFFERS = [
  { code: "SAVEBIG",    discount: "10% off",     product: "All",            tier: 3 },
  { code: "TRAVEL5",    discount: "5% off",      product: "Data eSIM",      tier: 1 },
  { code: "ONLINE5",    discount: "5% off",      product: "Data eSIM",      tier: 2 },
  { code: "NUMBER5",    discount: "$5 off",      product: "Virtual Number", tier: 1 },
  { code: "NUMBER10",   discount: "$10 off",     product: "Virtual Number", tier: 2 },
  { code: "NUMBER15",   discount: "$15 off",     product: "Virtual Number", tier: 3 },
  { code: "NUMBER20",   discount: "$20 off",     product: "Virtual Number", tier: 4 },
  { code: "SMNUMBER10", discount: "$10 off",     product: "Virtual Number", tier: 2 },
  { code: "CALL5",      discount: "+$5 credit",  product: "Calls",          tier: 1 },
  { code: "CALL10",     discount: "+$10 credit", product: "Calls",          tier: 2 },
  { code: "CALL15",     discount: "+$15 credit", product: "Calls",          tier: 3 },
  { code: "CALL20",     discount: "+$20 credit", product: "Calls",          tier: 4 },
  { code: "TALK5",      discount: "5% off",      product: "Calls",          tier: 1 },
  { code: "TALK10",     discount: "10% off",     product: "Calls",          tier: 2 },
  { code: "TALK15",     discount: "15% off",     product: "Calls",          tier: 3 },
  { code: "TALK20",     discount: "20% off",     product: "Calls",          tier: 4 },
  { code: "LOCAL5",     discount: "$5 off",      product: "Local",          tier: 1 },
  { code: "LOCAL10",    discount: "$10 off",     product: "Local",          tier: 2 },
  { code: "LOCAL15",    discount: "$15 off",     product: "Local",          tier: 3 },
  { code: "LOCAL20",    discount: "$20 off",     product: "Local",          tier: 4 },
];

const TIER_LABELS = { 1: "Loyal / Low-risk", 2: "At-risk", 3: "High-risk", 4: "Churned" };
const TIER_COLORS = { 1: "bg-green-100 text-green-700", 2: "bg-amber-100 text-amber-700", 3: "bg-orange-100 text-orange-700", 4: "bg-red-100 text-red-700" };

function StatusDot({ ok, loading }) {
  if (loading) return <Loader2 size={14} className="animate-spin text-gray-400" />;
  return ok
    ? <CheckCircle size={14} className="text-green-500 shrink-0" />
    : <XCircle    size={14} className="text-red-400  shrink-0" />;
}

function ServiceCard({ name, url, status, loading, note }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-start gap-3">
      <StatusDot ok={status} loading={loading} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-800">{name}</div>
        <div className="text-xs text-gray-400 font-mono mt-0.5">{url}</div>
        {note && <div className="text-xs text-gray-400 mt-1">{note}</div>}
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
        loading ? "bg-gray-100 text-gray-400"
        : status ? "bg-green-100 text-green-700"
        : "bg-red-100 text-red-500"
      }`}>
        {loading ? "checking…" : status ? "online" : "offline"}
      </span>
    </div>
  );
}

function CopyCode({ code }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} className="ml-1 text-gray-400 hover:text-purple-600 transition">
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  );
}

export default function Settings() {
  const [backendOk, setBackendOk]   = useState(null);
  const [wabotOk,   setWabotOk]     = useState(null);
  const [aiOk,      setAiOk]        = useState(null);
  const [dbStats,   setDbStats]     = useState(null);
  const [checking,  setChecking]    = useState(true);
  const [offerTab,  setOfferTab]    = useState("All");

  const PRODUCTS = ["All", "Calls", "Data eSIM", "Virtual Number", "Local"];
  const visibleOffers = offerTab === "All" ? OFFERS : OFFERS.filter(o => o.product === offerTab || o.product === "All");

  async function checkServices() {
    setChecking(true);
    setBackendOk(null); setWabotOk(null); setAiOk(null);

    // Backend — we're already connected if the page loaded, but ping /health explicitly
    try {
      await api.get("/health");
      setBackendOk(true);
    } catch { setBackendOk(false); }

    // wa-bot — ping via backend proxy to avoid CORS
    try {
      // The backend doesn't proxy wa-bot, so we try direct (may fail due to CORS — just try)
      const r = await fetch("http://localhost:3000/health", { mode: "no-cors" });
      setWabotOk(true);
    } catch { setWabotOk(false); }

    // ai-server — same approach
    try {
      await fetch("http://localhost:5000/health", { mode: "no-cors" });
      setAiOk(true);
    } catch { setAiOk(false); }

    setChecking(false);
  }

  useEffect(() => {
    checkServices();
    // Fetch a quick DB stat
    api.get("/api/users/", { params: { page: 1, page_size: 1 } })
      .then(r => setDbStats({ users: r.data.total }))
      .catch(() => {});
    api.get("/api/campaigns/")
      .then(r => setDbStats(prev => ({ ...prev, campaigns: r.data.length })))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Settings2 size={22} className="text-purple-600" />
          Settings
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">System status · configuration · promo codes</p>
      </div>

      {/* ── System Status ──────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Zap size={15} className="text-purple-500" />
            System Status
          </h2>
          <button
            onClick={checkServices}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-purple-600 transition"
          >
            <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="space-y-3">
          <ServiceCard
            name="Dashboard Backend"
            url="http://localhost:8000"
            status={backendOk}
            loading={checking}
            note="FastAPI · PostgreSQL · all /api/* routes"
          />
          <ServiceCard
            name="WhatsApp Bot"
            url="http://localhost:3000"
            status={wabotOk}
            loading={checking}
            note="Node.js · Meta Cloud API · campaign sender cron (every 60s)"
          />
          <ServiceCard
            name="AI Server"
            url="http://localhost:5000"
            status={aiOk}
            loading={checking}
            note="Python · Groq LLM · offer matching · chat replies"
          />
        </div>

        {dbStats && (
          <div className="mt-4 flex gap-4 pt-4 border-t border-gray-50">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Database size={13} className="text-purple-400" />
              <strong>{dbStats.users?.toLocaleString() ?? "—"}</strong> users in DB
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MessageSquare size={13} className="text-purple-400" />
              <strong>{dbStats.campaigns ?? "—"}</strong> campaigns created
            </div>
          </div>
        )}
      </div>

      {/* ── WhatsApp Configuration ─────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <MessageSquare size={15} className="text-purple-500" />
          WhatsApp Configuration
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-400 font-medium mb-1">Mode</div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                WA_DEV_MODE = true
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              Plain-text messages · only works within 24h window · safe for testing
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-400 font-medium mb-1">For production</div>
            <div className="text-sm font-mono text-gray-700">numero_reactivation</div>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              Meta-approved template — set WA_DEV_MODE=false after approval to enable cold outbound
            </p>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 col-span-2">
            <div className="text-xs text-gray-400 font-medium mb-2 flex items-center gap-1">
              <Phone size={11} />
              Phone number loading
            </div>
            <p className="text-xs text-gray-600 leading-relaxed mb-2">
              The <code className="bg-gray-200 px-1 rounded">phone_number</code> column in the users table is currently empty — it needs to be populated from the company's production database. Run this SQL after exporting phone numbers:
            </p>
            <pre className="text-xs bg-gray-800 text-green-300 rounded-lg p-3 overflow-x-auto leading-relaxed">
{`UPDATE users
SET phone_number = prod.phone   -- E.164 without +, e.g. 447911123456
FROM prod_export prod
WHERE users.id_client = prod.id_client;`}
            </pre>
            <p className="text-xs text-gray-400 mt-2">
              Once populated, the wa-bot will automatically use these numbers for campaign sending.
              Phone numbers are never shown in the dashboard UI.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl p-3">
          <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 leading-relaxed">
            To start sending to real users: (1) populate phone_number in DB, (2) register ngrok webhook in Meta Developer portal, (3) add your number as a test recipient, (4) set WA_DEV_MODE=false + get template approved for cold outbound.
          </p>
        </div>
      </div>

      {/* ── Promo Codes ────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <Zap size={15} className="text-purple-500" />
          Promo Codes
          <span className="text-xs font-normal text-gray-400 ml-1">{OFFERS.length} active codes</span>
        </h2>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {PRODUCTS.map(p => (
            <button
              key={p}
              onClick={() => setOfferTab(p)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition ${
                offerTab === p
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 font-medium border-b border-gray-100">
                <th className="text-left py-2 pr-4">Code</th>
                <th className="text-left py-2 pr-4">Discount</th>
                <th className="text-left py-2 pr-4">Product</th>
                <th className="text-left py-2">Audience tier</th>
              </tr>
            </thead>
            <tbody>
              {visibleOffers.map(o => (
                <tr key={o.code} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                  <td className="py-2.5 pr-4">
                    <span className="font-mono font-bold text-gray-800 text-xs">{o.code}</span>
                    <CopyCode code={o.code} />
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600 text-xs">{o.discount}</td>
                  <td className="py-2.5 pr-4 text-gray-500 text-xs">{o.product}</td>
                  <td className="py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[o.tier]}`}>
                      Tier {o.tier} — {TIER_LABELS[o.tier]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
