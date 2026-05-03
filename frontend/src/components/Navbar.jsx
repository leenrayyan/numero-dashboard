import { NavLink, useNavigate } from "react-router-dom";
import { User, Megaphone } from "lucide-react";
import { useGlobalFilter } from "../context/QueryFilterContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Home" },
  { to: "/dormant",   label: "Explore" },
  { to: "/campaigns", label: "Campaigns" },
  { to: "/reports",   label: "Reports" },
  { to: "/settings",  label: "Settings" },
];

export default function Navbar() {
  const navigate = useNavigate();
  const { hasActiveFilter, selectedUserCount } = useGlobalFilter();

  return (
    <header
      className="w-full flex items-stretch"
      style={{
        background: "linear-gradient(135deg, #1B3D70 0%, #4A2D85 50%, #7A2F50 100%)",
        height: 92,
        boxShadow: "0 4px 24px 0 rgba(74,45,133,0.20), 0 1.5px 0 0 rgba(255,255,255,0.07)",
      }}
    >
      {/* Left: logo + title */}
      <div className="flex items-center gap-3 px-6 shrink-0">
        <img src="/numero_logo.png" alt="Numero" className="w-12 h-12 rounded-2xl object-cover" />
        <div>
          <div className="font-extrabold text-2xl leading-tight text-white">
            Dormant Users Reactivation Engine
          </div>
          <div className="text-white/50 text-sm mt-1">Numero eSIM Analytics</div>
        </div>
      </div>

      {/* Centre: nav tabs — stretch to full height so active border touches bottom */}
      <nav className="flex flex-1 items-stretch justify-center gap-0.5 px-4">
        {NAV_ITEMS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center px-6 text-sm font-semibold border-b-[3px] transition-all ${
                isActive
                  ? "border-violet-300 text-white bg-white/10"
                  : "border-transparent text-white/55 hover:text-white hover:bg-white/8"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Right: user + button */}
      <div className="flex items-center gap-4 px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
            <User size={15} className="text-white/70" />
          </div>
          <div className="text-white text-sm font-medium">Admin User</div>
        </div>

        <button
          onClick={() => navigate("/campaigns")}
          className="flex items-center gap-2 bg-white text-violet-800 hover:bg-violet-50 text-sm font-bold px-5 py-2 rounded-xl transition shadow-lg"
        >
          <Megaphone size={15} />
          {hasActiveFilter && selectedUserCount
            ? `Campaign · ${selectedUserCount.toLocaleString()}`
            : "Create Campaign"}
        </button>
      </div>
    </header>
  );
}
