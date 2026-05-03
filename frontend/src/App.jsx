import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Navbar from "./components/Navbar";
import GlobalFilterBar from "./components/GlobalFilterBar";
import Dashboard from "./pages/Dashboard";
import DormantUsers from "./pages/DormantUsers";
import Reports from "./pages/Reports";
import Campaigns from "./pages/Campaigns";
import Settings from "./pages/Settings";
import { QueryFilterProvider } from "./context/QueryFilterContext";
import "./index.css";

export default function App() {
  return (
    <BrowserRouter>
      <QueryFilterProvider>
        <div className="min-h-screen flex flex-col bg-gray-50">
          <Navbar />
          <GlobalFilterBar />
          <main className="flex-1 w-full px-8 pt-5 pb-10">
            <Routes>
              <Route path="/"             element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard"    element={<Dashboard />} />
              {/* /segmentation now redirects to /dormant — Segments content was merged into Explore. */}
              <Route path="/segmentation" element={<Navigate to="/dormant" replace />} />
              <Route path="/dormant"      element={<DormantUsers />} />
              <Route path="/reports"      element={<Reports />} />
              <Route path="/campaigns"    element={<Campaigns />} />
              <Route path="/settings"     element={<Settings />} />
            </Routes>
          </main>
        </div>
      </QueryFilterProvider>
    </BrowserRouter>
  );
}
