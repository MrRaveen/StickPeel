import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { logout } from "@/api/endpoints/auth/auth";
import { useCurrentUser } from "@/contexts/user-context";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orgs", label: "Organizations", icon: Building2 },
  { href: "/users", label: "Platform Users", icon: Users },
  { href: "/staff", label: "Staff Members", icon: Shield },
  { href: "/ai-usage", label: "AI Usage", icon: Sparkles },
  { href: "/audit-logs", label: "Audit Logs", icon: ClipboardList },
] as const;

export function Sidebar() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useCurrentUser();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logout();
    },
    onSettled: () => {
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  const initials =
    user &&
    `${(user.first_name || "").charAt(0)}${(user.last_name || "").charAt(0)}`.toUpperCase();

  return (
    <aside className="my-3 ml-3 mr-2 flex h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col rounded-2xl border border-border/80 bg-card text-card-foreground shadow-md overflow-hidden">
      {/* Brand & Internal marker */}
      <div className="flex h-16 items-center justify-between border-b px-5">
        <a
          href="http://localhost:3000"
          title="Go to StickPeel Landing Page"
          aria-label="StickPeel Home"
          className="flex items-center gap-2 transition-opacity hover:opacity-85"
        >
          <Logo className="h-6" />
        </a>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 border border-amber-500/20">
          Internal
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1.5 px-3 py-4 overflow-y-auto">
        <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Platform Admin
        </div>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              to={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Current staff member info & logout */}
      <div className="border-t p-3 bg-muted/20">
        {user && (
          <div className="flex items-center gap-3 rounded-md p-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-xs border border-primary/20">
              {initials || "ST"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-semibold text-foreground">
                  {user.first_name} {user.last_name}
                </p>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Badge
                  variant="outline"
                  className="text-[10px] py-0 px-1.5 font-mono h-4"
                >
                  {user.role}
                </Badge>
              </div>
              <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                {user.email}
              </p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-start text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          disabled={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut className="size-3.5 mr-2" />
          {logoutMutation.isPending ? "Signing out..." : "Sign Out"}
        </Button>
      </div>
    </aside>
  );
}
