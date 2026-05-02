import { useState } from "react";
import { EyeOff, Eye } from "lucide-react";

/**
 * Hideable card panel — wraps any card section.
 * State is persisted to localStorage so it survives page refresh.
 *
 * Props:
 *  id            – unique string key for localStorage
 *  title         – card heading (required for the hidden pill to show label)
 *  subtitle      – optional small grey sub-heading
 *  children      – card body
 *  headerRight   – optional JSX rendered left of the hide button
 *  defaultVisible – default open state (default true)
 *  className     – extra classes on the wrapper
 *  noPadding     – skip the default card padding (for charts that need full bleed)
 */
export default function Panel({
  id,
  title,
  subtitle,
  children,
  headerRight,
  defaultVisible = true,
  className = "",
  noPadding = false,
}) {
  const [visible, setVisible] = useState(() => {
    try {
      const v = localStorage.getItem(`panel:${id}`);
      return v !== null ? JSON.parse(v) : defaultVisible;
    } catch {
      return defaultVisible;
    }
  });

  function toggle(val) {
    setVisible(val);
    try { localStorage.setItem(`panel:${id}`, JSON.stringify(val)); } catch {}
  }

  if (!visible) {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-white border border-dashed border-gray-200 rounded-xl text-xs mb-0">
        <span className="text-gray-400 font-medium">{title} — hidden</span>
        <button
          onClick={() => toggle(true)}
          className="flex items-center gap-1 text-purple-500 hover:text-purple-700 font-medium transition"
        >
          <Eye size={12} /> Show
        </button>
      </div>
    );
  }

  return (
    <div className={`card ${className}`} style={noPadding ? { padding: 0 } : {}}>
      {title && (
        <div className={`flex items-start justify-between ${noPadding ? "px-4 pt-4" : ""} mb-2`}>
          <div>
            <h2 className="font-semibold text-gray-700 text-sm">{title}</h2>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              onClick={() => toggle(false)}
              title="Hide this panel"
              className="text-gray-300 hover:text-gray-500 transition p-1 rounded hover:bg-gray-50"
            >
              <EyeOff size={13} />
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
