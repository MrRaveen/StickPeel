import { Link, useLocation } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  UserCheck,
  Settings,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import { logout } from "@/api/endpoints/auth/auth";
import { useCurrentUser } from "@/contexts/user-context";
import { useActiveOrg } from "@/contexts/org-context";
import { Logo } from "@/components/Logo";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// `as const` keeps the hrefs as literal types, so TanStack Router can
// type-check them against the generated route tree.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/plans", label: "Weekly Plans", icon: CalendarCheck },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/members", label: "Members", icon: UserCheck },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const { isOrgSuspended } = useActiveOrg();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logout();
    },
    onSettled: () => {
      // Drop every cached query so the next session starts clean, then leave.
      queryClient.clear();
      window.location.href = "/login";
    },
  });

  const initials = user
    ? `${(user.first_name || "").charAt(0)}${(user.last_name || "").charAt(0)}`.toUpperCase() ||
      "SP"
    : "";

  return (
    <aside className="my-3 ml-3 mr-2 flex h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col rounded-2xl border border-border/80 bg-card shadow-md overflow-hidden">
      <div className="flex h-16 items-center px-6">
        <a
          href="http://localhost:3000"
          title="Go to StickPeel Landing Page"
          aria-label="StickPeel Home"
          className="transition-opacity hover:opacity-85"
        >
          <Logo className="h-7" />
        </a>
      </div>

      <OrgSwitcher />

      <nav className="flex-1 space-y-1 px-3 py-4">
        {isOrgSuspended && (
          <div className="mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-3.5 shrink-0" />
            <span>Workspace suspended</span>
          </div>
        )}
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          if (isOrgSuspended) {
            return (
              <div
                key={href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/40 cursor-not-allowed select-none"
              >
                <Icon className="size-4 opacity-40" />
                <span>{label}</span>
              </div>
            );
          }
          return (
            <Link
              key={href}
              to={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        {user && (
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {user.first_name} {user.last_name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          className="mt-1 w-full justify-start text-muted-foreground hover:text-foreground"
          disabled={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut className="size-4" />
          {logoutMutation.isPending ? "Signing out..." : "Logout"}
        </Button>
      </div>
    </aside>
  );
}
