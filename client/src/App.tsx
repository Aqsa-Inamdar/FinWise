import { Switch, Route, useLocation } from "wouter";
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
import NotFound from "@/pages/not-found";

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
            <Switch>
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/goals" component={Goals} />
              <Route path="/insights" component={Insights} />
              <Route path="/assistant" component={Assistant} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  const [location] = useLocation();
  
  // Show login page for /login route or root route
  if (location === "/login" || location === "/") {
    return <Login />;
  }

  return <AuthenticatedLayout />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <Router />
        </ThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
