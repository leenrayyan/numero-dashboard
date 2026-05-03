import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { SlidersHorizontal, X, ChevronDown } from "lucide-react";
import { KPI } from "../constants/colors";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { users as usersApi } from "../api";

const SEGMENTS = [
  // Calls
  "Calls - High Value Loyal (At Risk)",
  "Calls - Low Value Active",
  "Calls - Frequent Low Spenders (Cooling)",
  // eSIM
  "eSIM - High Value Users (At Risk)",
  "eSIM - Mid Value Active",
  "eSIM - Low Value Inactive",
  // Virtual
  "Virtual - High Value Loyal (At Risk)",
  "Virtual - Low Value Active",
  "Virtual - Mid Value Inactive",
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

function Dropdown({ label, value, options, onSelect, onClear, activeColor = KPI.purple }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useClickOutside(ref, () => setOpen(false));
  const active = value != null;

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
        <div className="absolute z-50 top-10 left-0 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[210px] py-1.5 overflow-hidden">
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
        </div>
      )}
    </div>
  );
}

/**
 * Generic distinct-values dropdown with counts (used by Platform & Language).
 * Pulls the list from the API once and shows it as a clickable list.
 */
function DistinctDropdown({ label, value, fetcher, valueKey, activeColor, onSelect, onClear }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const ref = useRef();
  useClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    fetcher().then(r => setOptions(r.data)).catch(() => {});
  }, [fetcher]);

  const active = !!value;

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
        <div className="absolute z-50 top-9 left-0 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[200px] py-1.5 overflow-hidden">
          {options.map(opt => (
            <button
              key={opt[valueKey]}
              onClick={() => { onSelect(opt[valueKey]); setOpen(false); }}
              className={`w-full text-left text-sm px-4 py-2.5 hover:bg-purple-50 hover:text-purple-700 flex justify-between items-center ${
                value === opt[valueKey] ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
              }`}
            >
              <span className="capitalize">{opt[valueKey]}</span>
              <span className="text-gray-400 text-xs">{opt.count?.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select country picker with searchable list and selected-counter chip.
 * `value` is an array of country names (or empty array). Selecting a country
 * toggles it in the array; clearing wipes the whole list.
 */
function CountryDropdown({ value, onChange, onClear }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [countries, setCountries] = useState([]);
  const ref = useRef();
  useClickOutside(ref, () => { setOpen(false); setSearch(""); });

  useEffect(() => {
    usersApi.countries().then(r => setCountries(r.data)).catch(() => {});
  }, []);

  const selected = Array.isArray(value) ? value : [];
  const selectedSet = new Set(selected);
  const filtered = countries.filter(c => c.country?.toLowerCase().includes(search.toLowerCase()));
  const active = selected.length > 0;

  function toggle(country) {
    onChange(
      selectedSet.has(country)
        ? selected.filter(c => c !== country)
        : [...selected, country]
    );
  }

  // Label shows first country + "+N more" if multiple, else "Country".
  const label = !active
    ? "Country"
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
        style={active ? { backgroundColor: KPI.blue } : {}}
      >
        {label}
        {active ? (
          <span onClick={(e) => { e.stopPropagation(); onClear(); }} className="hover:opacity-70 ml-0.5 cursor-pointer">
            <X size={12} />
          </span>
        ) : (
          <ChevronDown size={12} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-9 left-0 bg-white border border-gray-200 rounded-xl shadow-xl w-64 p-2">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search country…"
            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs mb-1.5 outline-none focus:border-purple-400"
          />
          <div className="flex items-center justify-between text-[10px] text-gray-400 px-2 mb-1">
            <span>{selected.length} selected</span>
            {active && (
              <button onClick={onClear} className="hover:text-purple-700">Clear</button>
            )}
          </div>
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {filtered.map(({ country, count }) => {
              const isSel = selectedSet.has(country);
              return (
                <button
                  key={country}
                  onClick={() => toggle(country)}
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
                    <span className="truncate">{country}</span>
                  </span>
                  <span className="text-gray-400 text-[10px]">{count?.toLocaleString()}</span>
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
    setPlatform, setLanguage, setWaReachable,
    clearNL, clearLasso, clearAll,
  } = useGlobalFilter();

  // WA Reachable toggle — stored in spendMin as a side-channel? No, use separate state pushed to URL or just local visual for now
  // We'll use the context's spend filter as a proxy for now and add wa_reachable as a local concept

  if (location.pathname === "/settings") return null;

  const recencyLabel = filters.recencyMin != null
    ? RECENCY_OPTIONS.find(o => o.min === filters.recencyMin)?.label ?? `${filters.recencyMin}–${filters.recencyMax ?? "∞"}d`
    : null;

  const spendLabel = filters.spendMin != null || filters.spendMax != null
    ? SPEND_OPTIONS.find(o => o.min === filters.spendMin && o.max === filters.spendMax)?.label
      ?? `$${filters.spendMin ?? 0}–$${filters.spendMax ?? "∞"}`
    : null;

  const activeCount = [
    filters.segment, filters.productType, recencyLabel,
    filters.country?.length > 0 ? "country" : null,
    spendLabel, filters.platform, filters.language,
    filters.nlUserIds, filters.lassoUserIds,
  ].filter(Boolean).length;

  return (
    <div className="w-full bg-gray-50 border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div className="w-full px-8 py-3 flex items-center justify-center gap-2.5 flex-wrap">

        {/* Label */}
        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 tracking-wide mr-1 shrink-0">
          <SlidersHorizontal size={13} />
          Filters
          {activeCount > 0 && (
            <span className="bg-purple-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center ml-0.5">
              {activeCount}
            </span>
          )}
        </div>

        {/* ── Dropdowns ── */}

        <Dropdown
          label="Segment"
          value={filters.segment}
          options={SEGMENTS.map(s => ({ label: s, display: s }))}
          onSelect={opt => setSegment(opt.label)}
          onClear={() => setSegment(null)}
          activeColor={KPI.purple}
        />

        <Dropdown
          label="Product"
          value={filters.productType}
          options={PRODUCTS.map(p => ({ label: p, display: p }))}
          onSelect={opt => setProductType(opt.label)}
          onClear={() => setProductType(null)}
          activeColor={KPI.teal}
        />

        <Dropdown
          label="Recency"
          value={recencyLabel}
          options={RECENCY_OPTIONS.map(o => ({ label: o.label, display: o.label, ...o }))}
          onSelect={opt => setRecency(opt.min, opt.max)}
          onClear={() => setRecency(null, null)}
          activeColor={KPI.pink}
        />

        <CountryDropdown
          value={filters.country}
          onChange={v => setCountry(v)}
          onClear={() => setCountry([])}
        />

        <Dropdown
          label="Spend"
          value={spendLabel}
          options={SPEND_OPTIONS.map(o => ({ label: o.label, display: o.label, ...o }))}
          onSelect={opt => setSpend(opt.min, opt.max)}
          onClear={() => setSpend(null, null)}
          activeColor={KPI.teal}
        />

        <Dropdown
          label="Age"
          value={filters.ageMin != null
            ? AGE_OPTIONS.find(o => o.min === filters.ageMin && o.max === filters.ageMax)?.label ?? "Custom"
            : null}
          options={AGE_OPTIONS.map(o => ({ label: o.label, display: o.label, ...o }))}
          onSelect={opt => setAge(opt.min, opt.max)}
          onClear={() => setAge(null, null)}
          activeColor={KPI.purple}
        />

        <DistinctDropdown
          label="Platform"
          value={filters.platform}
          fetcher={usersApi.platforms}
          valueKey="platform"
          activeColor={KPI.green}
          onSelect={(v) => setPlatform(v)}
          onClear={() => setPlatform(null)}
        />

        <DistinctDropdown
          label="Language"
          value={filters.language}
          fetcher={usersApi.languages}
          valueKey="language"
          activeColor={KPI.coral}
          onSelect={(v) => setLanguage(v)}
          onClear={() => setLanguage(null)}
        />

        {/* NL chip */}
        {filters.nlUserIds && (
          <span className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg bg-purple-600 text-white">
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
