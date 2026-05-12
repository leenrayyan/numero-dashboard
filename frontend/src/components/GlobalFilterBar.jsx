import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { SlidersHorizontal, X, ChevronDown } from "lucide-react";
import { KPI } from "../constants/colors";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { users as usersApi } from "../api";

const SEGMENTS = [
  // Calls (2)
  "Calls - Regular Calling Offer Users",
  "Calls - Infrequent Casual Users",
  // eSIM (3)
  "eSIM - High-Value Bundle Subscribers",
  "eSIM - High-Velocity Light Spenders",
  "eSIM - Dormant Local Data Users",
  // Virtual (3)
  "Virtual - High-Spend Power Users",
  "Virtual - Mid-Tier Phone Plan Holders",
  "Virtual - Light Occasional Users",
];

const PRODUCTS = ["Calls", "Data eSIM", "Virtual Number"];

const RECENCY_OPTIONS = [
  { label: "0–90 days (recent)",     min: 0,   max: 90    },
  { label: "90–180 days",            min: 90,  max: 180   },
  { label: "180–365 days",           min: 180, max: 365   },
  { label: "1–2 years dormant",      min: 365, max: 730   },
  { label: "2+ years dormant",       min: 730, max: 99999 },
];

const SPEND_OPTIONS = [
  { label: "Under $10",    min: null, max: 10   },
  { label: "$10 – $50",    min: 10,   max: 50   },
  { label: "$50 – $100",   min: 50,   max: 100  },
  { label: "$100 – $250",  min: 100,  max: 250  },
  { label: "$250+",        min: 250,  max: null },
];

const AGE_OPTIONS = [
  { label: "New (< 6 months)",       min: null, max: 180  },
  { label: "6–12 months",            min: 180,  max: 365  },
  { label: "1–2 years",              min: 365,  max: 730  },
  { label: "Long-term (2+ years)",   min: 730,  max: null },
];

function useClickOutside(ref, handler) {
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) handler(); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, handler]);
}

/**
 * Single-select dropdown — only used for the three range filters
 * (Recency, Spend, Age). Each bucket is mutually exclusive. In addition
 * to the presets, a "Custom range…" entry expands two number inputs so
 * the analyst can type any min/max combination, matching the original
 * HTML prototype's free-text filter UX.
 *
 * `customPrefix`/`customSuffix` decorate the custom-range inputs (e.g.
 * "$" for spend, "d" for days). `applyCustom` calls onSelect with a
 * synthetic option carrying the typed min/max.
 */
function RangeDropdown({ label, value, options, onSelect, onClear, activeColor = KPI.purple, customPrefix = "", customSuffix = "" }) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const [customMax, setCustomMax] = useState("");
  const ref = useRef();
  useClickOutside(ref, () => { setOpen(false); setCustomMode(false); });
  const active = value != null;

  function applyCustom() {
    const min = customMin === "" ? null : Number(customMin);
    const max = customMax === "" ? null : Number(customMax);
    if (min == null && max == null) return;                // need at least one
    if (min != null && Number.isNaN(min)) return;
    if (max != null && Number.isNaN(max)) return;
    const display = `${customPrefix}${min ?? 0}–${customPrefix}${max ?? "∞"}${customSuffix}`;
    onSelect({ min, max, label: display, display });
    setOpen(false);
    setCustomMode(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-all whitespace-nowrap ${
          active
            ? "text-white border-transparent shadow-sm"
            : "border-gray-200 text-gray-600 bg-white hover:border-purple-300 hover:text-purple-700 shadow-sm"
        }`}
        style={active ? { backgroundColor: activeColor } : {}}
      >
        {active ? value : label}
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onClear(); }} className="hover:opacity-70 ml-0.5 cursor-pointer">
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={12} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-10 left-0 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[230px] py-1.5 overflow-hidden">
          {customMode ? (
            <div className="p-3">
              <div className="text-[11px] text-gray-500 font-semibold mb-2 tracking-wide uppercase">Custom range</div>
              <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                  {customPrefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{customPrefix}</span>}
                  <input
                    type="number"
                    placeholder="Min"
                    value={customMin}
                    onChange={e => setCustomMin(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyCustom()}
                    autoFocus
                    className={`w-full border border-gray-200 rounded-lg py-1.5 text-sm outline-none focus:border-purple-400 ${customPrefix ? "pl-5 pr-2" : "px-2"}`}
                  />
                </div>
                <span className="text-gray-400">–</span>
                <div className="relative flex-1">
                  {customPrefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{customPrefix}</span>}
                  <input
                    type="number"
                    placeholder="Max"
                    value={customMax}
                    onChange={e => setCustomMax(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyCustom()}
                    className={`w-full border border-gray-200 rounded-lg py-1.5 text-sm outline-none focus:border-purple-400 ${customPrefix ? "pl-5 pr-2" : "px-2"}`}
                  />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <button onClick={() => setCustomMode(false)} className="text-xs text-gray-400 hover:text-gray-600">← Back to presets</button>
                <button onClick={applyCustom} className="text-xs bg-purple-600 text-white font-semibold px-3 py-1.5 rounded-lg hover:bg-purple-700 transition">
                  Apply
                </button>
              </div>
            </div>
          ) : (
            <>
              {options.map(opt => (
                <button
                  key={opt.value ?? opt.label}
                  onClick={() => { onSelect(opt); setOpen(false); }}
                  className={`w-full text-left text-sm px-4 py-2.5 hover:bg-purple-50 hover:text-purple-700 transition ${
                    value === (opt.display ?? opt.label) ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                onClick={() => setCustomMode(true)}
                className="w-full text-left text-sm px-4 py-2.5 border-t border-gray-100 text-purple-600 font-semibold hover:bg-purple-50 transition"
              >
                + Custom range…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Generic multi-select dropdown with checkbox list, optional search, and a
 * selected counter. Used for every categorical filter (Segment, Product,
 * Country, Platform, Language). Values are arrays.
 *
 * Two ways to pass options:
 *  - `staticOptions`: array of plain strings (e.g. SEGMENTS, PRODUCTS).
 *  - `fetcher`+`valueKey`: lazy fetch from the API, where each row has a
 *    `valueKey` field and a `count` field (Country / Platform / Language).
 */
function MultiSelectDropdown({
  label, value, onChange, onClear,
  activeColor = KPI.purple,
  staticOptions, fetcher, valueKey,
  searchable = false,
  width = "w-56",
  capitalize = false,
}) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState("");
  const [fetched, setFetched] = useState([]);
  const ref = useRef();
  useClickOutside(ref, () => { setOpen(false); setSearch(""); });

  // Fetch once on mount if a fetcher is provided.
  useEffect(() => {
    if (fetcher) fetcher().then(r => setFetched(r.data)).catch(() => {});
  }, [fetcher]);

  // Normalize options to a uniform { value, count? } shape.
  const options = useMemo(() => {
    if (staticOptions) return staticOptions.map(v => ({ value: v }));
    if (fetched && valueKey) return fetched.map(row => ({ value: row[valueKey], count: row.count }));
    return [];
  }, [staticOptions, fetched, valueKey]);

  const selected = Array.isArray(value) ? value : [];
  const selectedSet = new Set(selected);
  const visible = searchable
    ? options.filter(o => String(o.value).toLowerCase().includes(search.toLowerCase()))
    : options;
  const active = selected.length > 0;

  function toggle(v) {
    onChange(selectedSet.has(v) ? selected.filter(x => x !== v) : [...selected, v]);
  }

  // Chip label: "Calls" / "Calls +2" — first item plus "+N" for the rest.
  const chipLabel = !active
    ? label
    : selected.length === 1
      ? selected[0]
      : `${selected[0]} +${selected.length - 1}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-all whitespace-nowrap ${
          active
            ? "text-white border-transparent shadow-sm"
            : "border-gray-200 text-gray-600 bg-white hover:border-purple-300 hover:text-purple-700 shadow-sm"
        }`}
        style={active ? { backgroundColor: activeColor } : {}}
        title={active ? selected.join(", ") : undefined}
      >
        <span className="truncate max-w-[160px]">{chipLabel}</span>
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onClear(); }} className="hover:opacity-70 ml-0.5 cursor-pointer">
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={12} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className={`absolute z-50 top-10 left-0 bg-white border border-gray-200 rounded-xl shadow-xl ${width} p-2`}>
          {searchable && (
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs mb-1.5 outline-none focus:border-purple-400"
            />
          )}
          <div className="flex items-center justify-between text-[10px] text-gray-400 px-2 mb-1">
            <span>{selected.length} selected</span>
            {active && (
              <button onClick={onClear} className="hover:text-purple-700">Clear</button>
            )}
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {visible.map(opt => {
              const isSel = selectedSet.has(opt.value);
              return (
                <button
                  key={String(opt.value)}
                  onClick={() => toggle(opt.value)}
                  className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg flex justify-between items-center transition ${
                    isSel ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700 hover:bg-purple-50"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                        isSel ? "bg-purple-600 border-purple-600" : "border-gray-300"
                      }`}
                    >
                      {isSel && <span className="text-white text-[10px] leading-none">✓</span>}
                    </span>
                    <span className={`truncate ${capitalize ? "capitalize" : ""}`} title={opt.value}>{opt.value}</span>
                  </span>
                  {opt.count != null && (
                    <span className="text-gray-400 text-[10px]">{opt.count.toLocaleString()}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GlobalFilterBar() {
  const location = useLocation();
  const {
    filters, hasActiveFilter,
    setSegment, setRecency, setCountry, setProductType, setSpend, setAge,
    setPlatform, setLanguage,
    clearNL, clearLasso, clearAll,
  } = useGlobalFilter();

  if (location.pathname === "/settings") return null;

  const recencyLabel = filters.recencyMin != null
    ? RECENCY_OPTIONS.find(o => o.min === filters.recencyMin)?.label ?? `${filters.recencyMin}–${filters.recencyMax ?? "∞"}d`
    : null;

  const spendLabel = filters.spendMin != null || filters.spendMax != null
    ? SPEND_OPTIONS.find(o => o.min === filters.spendMin && o.max === filters.spendMax)?.label
      ?? `$${filters.spendMin ?? 0}–$${filters.spendMax ?? "∞"}`
    : null;

  const ageLabel = filters.ageMin != null || filters.ageMax != null
    ? AGE_OPTIONS.find(o => o.min === filters.ageMin && o.max === filters.ageMax)?.label
      ?? `${filters.ageMin ?? 0}–${filters.ageMax ?? "∞"}d`
    : null;

  const activeCount = [
    filters.segment?.length > 0      ? "segment"   : null,
    filters.productType?.length > 0  ? "product"   : null,
    recencyLabel,
    filters.country?.length > 0      ? "country"   : null,
    spendLabel, ageLabel,
    filters.platform?.length > 0     ? "platform"  : null,
    filters.language?.length > 0     ? "language"  : null,
    filters.nlAudienceId, filters.lassoUserIds,
  ].filter(Boolean).length;

  return (
    <div className="w-full bg-gray-50 border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div className="w-full px-8 py-3 flex items-center justify-center gap-2.5 flex-wrap">

        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 tracking-wide mr-1 shrink-0">
          <SlidersHorizontal size={13} />
          Filters
          {activeCount > 0 && (
            <span className="bg-purple-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center ml-0.5">
              {activeCount}
            </span>
          )}
        </div>

        {/* Categorical multi-select filters */}

        <MultiSelectDropdown
          label="Segment"
          value={filters.segment}
          onChange={v => setSegment(v)}
          onClear={() => setSegment([])}
          activeColor={KPI.purple}
          staticOptions={SEGMENTS}
          width="w-72"
        />

        <MultiSelectDropdown
          label="Product"
          value={filters.productType}
          onChange={v => setProductType(v)}
          onClear={() => setProductType([])}
          activeColor={KPI.green}
          staticOptions={PRODUCTS}
          width="w-48"
        />

        <MultiSelectDropdown
          label="Country"
          value={filters.country}
          onChange={v => setCountry(v)}
          onClear={() => setCountry([])}
          activeColor={KPI.blue}
          fetcher={usersApi.countries}
          valueKey="country"
          searchable
          width="w-64"
        />

        <MultiSelectDropdown
          label="Platform"
          value={filters.platform}
          onChange={v => setPlatform(v)}
          onClear={() => setPlatform([])}
          activeColor={KPI.indigo}
          fetcher={usersApi.platforms}
          valueKey="platform"
          width="w-48"
        />

        <MultiSelectDropdown
          label="Language"
          value={filters.language}
          onChange={v => setLanguage(v)}
          onClear={() => setLanguage([])}
          activeColor={KPI.coral}
          fetcher={usersApi.languages}
          valueKey="language"
          width="w-48"
          capitalize
        />

        {/* Range filters — single-select since the buckets are mutually exclusive */}

        <RangeDropdown
          label="Recency"
          value={recencyLabel}
          options={RECENCY_OPTIONS.map(o => ({ label: o.label, display: o.label, ...o }))}
          onSelect={opt => setRecency(opt.min, opt.max)}
          onClear={() => setRecency(null, null)}
          activeColor={KPI.rose}
          customSuffix="d"
        />

        <RangeDropdown
          label="Spend"
          value={spendLabel}
          options={SPEND_OPTIONS.map(o => ({ label: o.label, display: o.label, ...o }))}
          onSelect={opt => setSpend(opt.min, opt.max)}
          onClear={() => setSpend(null, null)}
          activeColor={KPI.green}
          customPrefix="$"
        />

        <RangeDropdown
          label="Age"
          value={ageLabel}
          options={AGE_OPTIONS.map(o => ({ label: o.label, display: o.label, ...o }))}
          onSelect={opt => setAge(opt.min, opt.max)}
          onClear={() => setAge(null, null)}
          activeColor={KPI.purple}
          customSuffix="d"
        />

        {/* NL chip — shows the smart-query question that produced the active
            audience. Truncated for layout, but the full text appears on hover
            (title attr). The SQL Vanna generated is also surfaced so the
            analyst can verify exactly what was filtered. */}
        {filters.nlAudienceId && (
          <span
            className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg bg-purple-600 text-white"
            title={[
              filters.nlQuestion ? `Question: ${filters.nlQuestion}` : null,
              filters.nlSummary  ? `Summary: ${filters.nlSummary}`   : null,
              filters.nlSql      ? `SQL: ${filters.nlSql}`           : null,
            ].filter(Boolean).join("\n\n")}
          >
            "{filters.nlQuestion?.slice(0, 28)}{filters.nlQuestion?.length > 28 ? "…" : ""}"
            <button onClick={clearNL} className="hover:opacity-70"><X size={12} /></button>
          </span>
        )}
        {filters.lassoUserIds && (
          <span className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg bg-purple-600 text-white">
            {filters.lassoUserIds.length.toLocaleString()} map-selected
            <button onClick={clearLasso} className="hover:opacity-70"><X size={12} /></button>
          </span>
        )}

        {/* Clear all */}
        {hasActiveFilter && (
          <button
            onClick={clearAll}
            className="text-xs text-red-400 hover:text-red-600 font-semibold transition px-1 ml-1"
          >
            Clear all ×
          </button>
        )}
      </div>
    </div>
  );
}
