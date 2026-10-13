import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarCheck,
  Users,
  Building2,
  ArrowRight,
  Plus,
  Sparkles,
} from "lucide-react";
import { useCurrentUser } from "@/contexts/user-context";
import { useActiveOrg } from "@/contexts/org-context";
import { useListPlans, useGetMyTeams } from "@/api/endpoints/orgs/orgs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_main/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const user = useCurrentUser();
  const { activeOrgId, activeOrg, activeMembership } = useActiveOrg();

  const { data: plansData } = useListPlans(
    activeOrgId ?? "",
    { page: 1, page_size: 10 },
    { query: { enabled: Boolean(activeOrgId) } }
  );

  const { data: myTeams = [] } = useGetMyTeams(activeOrgId ?? "", {
    query: { enabled: Boolean(activeOrgId) },
  });

  const plans = plansData?.items ?? [];
  const latestPlan = plans[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome{user ? `, ${user.first_name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            StickPeel weekly planning workspace.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/plans">
            <Button className="gap-2 shadow-xs">
              <Plus className="size-4" />
              <span>Weekly Plan</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Active Organization */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Organization</span>
              <Building2 className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-lg">
              {activeOrg?.name || activeMembership?.org_info.org_name || "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="capitalize text-xs font-semibold"
              >
                {activeOrg?.my_role ||
                  activeMembership?.org_info.role_name ||
                  "Member"}
              </Badge>
              {activeOrg?.is_suspended && (
                <Badge variant="destructive" className="text-xs">
                  Suspended
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Teams Count */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>My Teams</span>
              <Users className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-lg">
              {myTeams.length} {myTeams.length === 1 ? "Team" : "Teams"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Link
              to="/teams"
              className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
            >
              View teams <ArrowRight className="size-3" />
            </Link>
          </CardContent>
        </Card>

        {/* Weekly Plans Count */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Plans Authored</span>
              <CalendarCheck className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-lg">{plans.length} Weeks</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <Link
              to="/plans"
              className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
            >
              Manage plans <ArrowRight className="size-3" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Latest Plan Spotlight Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              <CardTitle className="text-base font-semibold">
                Weekly Outcome Focus
              </CardTitle>
            </div>
            {latestPlan && (
              <Badge
                variant="secondary"
                className="capitalize text-xs font-semibold"
              >
                {latestPlan.status}
              </Badge>
            )}
          </div>
          <CardDescription>
            Every engineer ships one significant thing by Friday and carries
            nothing into Monday.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {latestPlan ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Week of {latestPlan.week_start_date}
                </p>
                <p className="text-xs text-muted-foreground">
                  {latestPlan.done_count} of {latestPlan.task_count} tasks
                  completed
                </p>
              </div>
              <Link to="/plans">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <span>Open Plan</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                No active plan for this week yet. Draft your commitments now.
              </p>
              <Link to="/plans">
                <Button size="sm" className="gap-1.5">
                  <Plus className="size-4" />
                  <span>Draft This Week&apos;s Plan</span>
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
