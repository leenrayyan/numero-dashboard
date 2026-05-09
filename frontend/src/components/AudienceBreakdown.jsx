import { useEffect, useState, useMemo } from "react";
import { Loader2, Users, Clock, DollarSign } from "lucide-react";
import { analytics } from "../api";
import { useGlobalFilter } from "../context/QueryFilterContext";
import { PALETTE, BRAND, KPI } from "../constants/colors";
import Panel from "./Panel";

/**
 * Audience Breakdown — a "where are they" panel that reacts to the global
 * filter / segment selection. Three sub-blocks:
 *   1. Top countries (horizontal bars, count + % of filtered audience)
 *   2. Platform split (iOS vs Android)
 *   3. Language split (top 6)
 *
 * The single most useful right-side companion to the cluster scatter when
 * the user is exploring "what does this segment look like?".
 */
export default function AudienceBreakdown({ className = "" }) {
  const { apiParams, hasActiveFilter } = useGlobalFilter();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.audienceBreakdown(apiParams)
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false));
  }, [JSON.stringify(apiParams)]); // eslint-disable-line

  const total = data?.total ?? 0;

  return (
    <Panel
      id="audience-breakdown"
      title="Audience Breakdown"
      className={className}
      subtitle={
        hasActiveFilter
          ? `Where the ${total.toLocaleString()} filtered users live & how they connect`
          : `Where all ${total.toLocaleString()} users live & how they connect`
      }
    >
      {loading || !data ? (
        <div className="h-72 flex items-center justify-center text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : total === 0 ? (
        <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
          No users match the current filter.
        </div>
      ) : (
        <div className="space-y-4">
          <CountryBars countries={data.countries} total={total} />
          <div className="grid grid-cols-2 gap-3">
            <CategoryBlock title="Platform" rows={data.platforms} total={total} />
            <CategoryBlock title="Language" rows={data.languages} total={total} />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <DistributionBars
              title="How dormant"
              icon={Clock}
              color={KPI.rose}
              rows={data.recency}
              total={total}
            />
            <DistributionBars
              title="Spend distribution"
              icon={DollarSign}
              color={KPI.green}
              rows={data.spend}
              total={total}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}


function CountryBars({ countries, total }) {
  const max = useMemo(() => Math.max(...countries.map(c => c.count), 1), [countries]);
  if (!countries.length) {
    return <div className="text-xs text-gray-400 italic">No country data.</div>;
  }
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Users size={11} className="text-gray-400" />
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Top countries</h3>
      </div>
      <div className="space-y-1.5">
        {countries.map((c) => {
          const pct = total ? (c.count / total) * 100 : 0;
          const w   = (c.count / max) * 100;
          return (
            <div key={c.name} className="flex items-center gap-2 text-xs">
              <div className="w-24 truncate text-gray-700" title={c.name}>{c.name}</div>
              <div className="flex-1 h-4 bg-gray-50 rounded-sm relative overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{ width: `${w}%`, backgroundColor: BRAND.purple, opacity: 0.8 }}
                />
              </div>
              <div className="w-20 text-right tabular-nums text-gray-500">
                {c.count.toLocaleString()}{" "}
                <span className="text-gray-400">{pct.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function DistributionBars({ title, icon: Icon, color, rows, total }) {
  const max = useMemo(() => Math.max(...rows.map(r => r.count), 1), [rows]);
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={11} className="text-gray-400" />}
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="space-y-1">
        {rows.map(r => {
          const pct = total ? (r.count / total) * 100 : 0;
          const w = (r.count / max) * 100;
          return (
            <div key={r.label} className="flex items-center gap-1.5 text-xs">
              <div className="w-14 text-gray-600 shrink-0">{r.label}</div>
              <div className="flex-1 h-3 bg-gray-50 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${w}%`, backgroundColor: color, opacity: 0.85 }} />
              </div>
              <div className="w-12 text-right tabular-nums text-gray-500">{pct.toFixed(0)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function CategoryBlock({ title, rows, total }) {
  if (!rows.length) return null;
  const sum = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{title}</h3>
      {/* Stacked horizontal bar */}
      <div className="flex h-3 rounded-md overflow-hidden mb-1.5 bg-gray-100">
        {rows.map((r, i) => (
          <div
            key={r.name}
            style={{
              width: `${(r.count / sum) * 100}%`,
              backgroundColor: PALETTE[i % PALETTE.length],
            }}
            title={`${r.name}: ${r.count.toLocaleString()}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="space-y-0.5">
        {rows.map((r, i) => {
          const pct = total ? (r.count / total) * 100 : 0;
          return (
            <div key={r.name} className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <span className="capitalize text-gray-700 truncate flex-1" title={r.name}>{r.name}</span>
              <span className="tabular-nums text-gray-500">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
