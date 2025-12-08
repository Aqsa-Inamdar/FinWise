import { Home, Target, TrendingUp, MessageSquare, ReceiptText } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "react-router-dom";

const menuItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
    testId: "nav-dashboard",
  },
  {
    title: "Goals",
    url: "/goals",
    icon: Target,
    testId: "nav-goals",
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: ReceiptText,
    testId: "nav-transactions",
  },
  {
    title: "Insights",
    url: "/insights",
    icon: TrendingUp,
    testId: "nav-insights",
  },
  {
    title: "AI Assistant",
    url: "/assistant",
    icon: MessageSquare,
    testId: "nav-assistant",
  },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <Sidebar role="navigation" aria-label="Primary">
      <SidebarContent>
        <SidebarGroup aria-label="FinWise navigation">
          <SidebarGroupLabel aria-hidden="true">FinWise</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        to={item.url}
                        data-testid={item.testId}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <item.icon aria-hidden="true" focusable="false" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
