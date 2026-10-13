import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2,
  Users,
  Shield,
  Sparkles,
  ClipboardList,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
} from "lucide-react";
import { useCurrentUser } from "@/contexts/user-context";
import { useListOrgs } from "@/api/endpoints/orgs/orgs";
import { useListUsers } from "@/api/endpoints/users/users";
import { useListStaff } from "@/api/endpoints/staff/staff";
import { useGetAiUsage } from "@/api/endpoints/ai-usage/ai-usage";
import { useListAuditLogs } from "@/api/endpoints/audit-logs/audit-logs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_main/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const user = useCurrentUser();

  const { data: orgsData, isLoading: orgsLoading } = useListOrgs({
    page: 1,
    page_size: 1,
  });

  const { data: usersData, isLoading: usersLoading } = useListUsers({
    page: 1,
    page_size: 1,
  });

  const { data: staffData, isLoading: staffLoading } = useListStaff(
    { page: 1, page_size: 1 },
    {
      query: {
        // If staff doesn't have permission to list staff, avoid crash
        retry: false,
      },
    }
  );

  const { data: aiData, isLoading: aiLoading } = useGetAiUsage(
    { page: 1, page_size: 1 },
    {
      query: {
        retry: false,
      },
    }
  );

  const { data: auditData, isLoading: auditLoading } = useListAuditLogs(
    { page: 1, page_size: 5 },
    {
      query: {
        retry: false,
      },
    }
  );

  const aiTotals = aiData?.totals;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Internal Overview
            </h1>
            <Badge
              variant="outline"
              className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30"
            >
              Staff Only
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {user?.first_name} {user?.last_name}. Platform
            management and operations console.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2 sm:mt-0">
          <Badge variant="secondary" className="font-mono text-xs px-2.5 py-1">
            Role: {user?.role || "Staff"}
          </Badge>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Organizations Card */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Organizations
            </CardTitle>
            <div className="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
              <Building2 className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            {orgsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {orgsData?.total?.toLocaleString() ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
              <span>Customer tenants</span>
              <Link
                to="/orgs"
                className="text-primary hover:underline flex items-center gap-0.5 text-xs font-medium"
              >
                Manage <ArrowUpRight className="size-3" />
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* Platform Users Card */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Users
            </CardTitle>
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
              <Users className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {usersData?.total?.toLocaleString() ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
              <span>Customer accounts</span>
              <Link
                to="/users"
                className="text-primary hover:underline flex items-center gap-0.5 text-xs font-medium"
              >
                Search <ArrowUpRight className="size-3" />
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* Staff Members Card */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Staff Members
            </CardTitle>
            <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
              <Shield className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            {staffLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {staffData?.total?.toLocaleString() ?? "—"}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
              <span>Platform operators</span>
              <Link
                to="/staff"
                className="text-primary hover:underline flex items-center gap-0.5 text-xs font-medium"
              >
                Team <ArrowUpRight className="size-3" />
              </Link>
            </p>
          </CardContent>
        </Card>

        {/* AI Usage Card */}
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              AI Invocations
            </CardTitle>
            <div className="p-2 bg-purple-500/10 text-purple-600 rounded-lg">
              <Sparkles className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            {aiLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {aiTotals?.total_calls?.toLocaleString() ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
              <span>
                {aiTotals
                  ? `${aiTotals.success ?? 0} OK / ${(aiTotals.failed ?? 0) + (aiTotals.rate_limited ?? 0)} issues`
                  : "Telemetry"}
              </span>
              <Link
                to="/ai-usage"
                className="text-primary hover:underline flex items-center gap-0.5 text-xs font-medium"
              >
                Stats <ArrowUpRight className="size-3" />
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* AI Telemetry Summary Breakdown */}
      {aiTotals && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="size-4 text-purple-600" />
                  Platform AI Health & Activity
                </CardTitle>
                <CardDescription>
                  Real-time telemetry across all customer AI requests (plans
                  review & drafting).
                </CardDescription>
              </div>
              <Link
                to="/ai-usage"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Detailed Breakdown
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  <span>Success</span>
                </div>
                <div className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                  {aiTotals.success ?? 0}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5 text-rose-500" />
                  <span>Failed</span>
                </div>
                <div className="text-xl font-bold mt-1 text-rose-600 dark:text-rose-400">
                  {aiTotals.failed ?? 0}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5 text-amber-500" />
                  <span>Rate Limited</span>
                </div>
                <div className="text-xl font-bold mt-1 text-amber-600 dark:text-amber-400">
                  {aiTotals.rate_limited ?? 0}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5 text-blue-500" />
                  <span>Timeout</span>
                </div>
                <div className="text-xl font-bold mt-1 text-blue-600 dark:text-blue-400">
                  {aiTotals.timeout ?? 0}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers className="size-3.5 text-purple-500" />
                  <span>Invalid Output</span>
                </div>
                <div className="text-xl font-bold mt-1 text-purple-600 dark:text-purple-400">
                  {aiTotals.invalid_output ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Audit Logs & Navigation Shortcuts */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Audit Logs (2 cols) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="size-4 text-primary" />
                Recent Platform Audit Logs
              </CardTitle>
              <CardDescription>
                Track changes and administrative interventions.
              </CardDescription>
            </div>
            <Link
              to="/audit-logs"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              View All
            </Link>
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !auditData?.items || auditData.items.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No audit events recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {auditData.items.map((log) => (
                  <div
                    key={log.id}
                    className="py-2.5 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="font-mono text-[11px] px-1.5 py-0"
                        >
                          {log.action}
                        </Badge>
                        <span className="text-muted-foreground truncate">
                          by {log.staff_email}
                        </span>
                      </div>
                      {log.detail && (
                        <p className="text-muted-foreground text-[11px] mt-0.5 truncate">
                          {log.detail}
                        </p>
                      )}
                    </div>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {new Date(log.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Nav Cards (1 col) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Navigation</CardTitle>
            <CardDescription>
              Direct shortcuts to platform controls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/orgs"
              className={buttonVariants({
                variant: "outline",
                className: "w-full justify-start text-xs h-9",
              })}
            >
              <Building2 className="size-3.5 mr-2 text-blue-500" />
              Manage Organizations
            </Link>
            <Link
              to="/users"
              className={buttonVariants({
                variant: "outline",
                className: "w-full justify-start text-xs h-9",
              })}
            >
              <Users className="size-3.5 mr-2 text-emerald-500" />
              Platform User Accounts
            </Link>
            <Link
              to="/staff"
              className={buttonVariants({
                variant: "outline",
                className: "w-full justify-start text-xs h-9",
              })}
            >
              <Shield className="size-3.5 mr-2 text-amber-500" />
              Staff Members & Roles
            </Link>
            <Link
              to="/ai-usage"
              className={buttonVariants({
                variant: "outline",
                className: "w-full justify-start text-xs h-9",
              })}
            >
              <Sparkles className="size-3.5 mr-2 text-purple-500" />
              AI Usage & Analytics
            </Link>
            <Link
              to="/audit-logs"
              className={buttonVariants({
                variant: "outline",
                className: "w-full justify-start text-xs h-9",
              })}
            >
              <ClipboardList className="size-3.5 mr-2 text-primary" />
              Audit Trail & History
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
