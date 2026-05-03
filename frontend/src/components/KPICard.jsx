export default function KPICard({
  title, value, subtitle, change, icon: Icon,
  accentColor = "#5B3A9E", gradient,
  // pending = render the card in a faded "data-not-ready" state. The model-driven
  // Reactivation Score uses this until the ML pipeline starts populating values.
  pending = false,
}) {
  const isPositive = change && !change.startsWith("-");
  const bg = gradient
    ? { backgroundImage: gradient }
    : { backgroundColor: accentColor };
  const opacityStyle = pending ? { opacity: 0.55 } : {};

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-2 relative overflow-hidden shadow-md"
      style={{ ...bg, ...opacityStyle }}
    >
      <div
        className="absolute -top-6 -right-6 w-28 h-28 rounded-full"
        style={{ backgroundColor: "rgba(255,255,255,0.10)" }}
      />

      <div className="flex items-start justify-between relative">
        <span className="text-white/80 text-base font-medium">{title}</span>
        {Icon && <Icon size={22} className="text-white/55" />}
      </div>

      <div className="text-4xl font-bold text-white tracking-tight relative">
        {pending ? "—" : value}
      </div>

      {(subtitle || change) && (
        <div className="flex items-center gap-2 relative">
          {change && (
            <span className={`text-sm font-semibold px-1.5 py-0.5 rounded ${
              isPositive ? "bg-white/20 text-white" : "bg-white/20 text-white"
            }`}>
              {change}
            </span>
          )}
          {subtitle && <span className="text-white/65 text-sm">{subtitle}</span>}
        </div>
      )}
    </div>
  );
}
