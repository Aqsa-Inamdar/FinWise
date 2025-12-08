/* import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { SkipNav } from "@/components/SkipNav";
import { AccessibilityAnnouncer } from "@/components/AccessibilityAnnouncer";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Goals from "@/pages/Goals";
import Insights from "@/pages/Insights";
import Assistant from "@/pages/Assistant";
import Transactions from "@/pages/Transactions";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/contexts/AuthProvider";

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <SkipNav />
      <AccessibilityAnnouncer />
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b p-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <main id="main-content" className="flex-1 overflow-auto p-6" tabIndex={-1}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <ThemeProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/*"
                  element={
                    <RequireAuth>
                      <AuthenticatedLayout />
                    </RequireAuth>
                  }
                />
              </Routes>
            </ThemeProvider>
            <Toaster />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
*/

import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { SkipNav } from "@/components/SkipNav";
import { AccessibilityAnnouncer } from "@/components/AccessibilityAnnouncer";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Goals from "@/pages/Goals";
import Transactions from "@/pages/Transactions";
import Insights from "@/pages/Insights";
import Assistant from "@/pages/Assistant";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/contexts/AuthProvider";

// -----------------------------
// 🔵 Page Title Mapping Utility
// -----------------------------
const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard Overview",
  "/goals": "Financial Goals",
  "/transactions": "Transactions",
  "/insights": "Financial Insights",
  "/assistant": "AI Assistant",
  "/login": "Login to FinWise",
};

// -----------------------------
// 🔵 Layout With Accessibility
// -----------------------------
function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const srHeaderRef = useRef<HTMLHeadingElement | null>(null);

  const accessibleTitle =
    PAGE_TITLES[location.pathname] ?? "Page Not Found";

  // Handle announcements + focus shift
  useEffect(() => {
    // Update visible document title
    document.title = `${accessibleTitle} | FinWise`;

    // Update screen-reader hidden heading
    if (srHeaderRef.current) {
      srHeaderRef.current.textContent = accessibleTitle;
    }

    // Move focus to main content area after navigation
    if (mainRef.current) {
      mainRef.current.focus();
    }
  }, [location.pathname, accessibleTitle]);

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <SkipNav />
      <AccessibilityAnnouncer />

      <div className="flex h-screen w-full">
        <AppSidebar />

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b p-4" role="banner">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          {/* 🔵 Hidden Screen-Reader Title */}
          <h1 ref={srHeaderRef} className="sr-only">
            {accessibleTitle}
          </h1>

          <main
            id="main-content"
            role="main"
            ref={mainRef}
            className="flex-1 overflow-auto p-6 outline-none"
            tabIndex={-1}
            aria-live="polite"
          >
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

// -----------------------------
// 🔵 Authentication Wrapper
// -----------------------------
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// -----------------------------
// 🔵 Top-Level App Component
// -----------------------------
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <ThemeProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/*"
                  element={
                    <RequireAuth>
                      <AuthenticatedLayout />
                    </RequireAuth>
                  }
                />
              </Routes>
            </ThemeProvider>
            <Toaster />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
