import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertCircle,
  Flag,
  User,
  Users,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  XCircle,
  Check,
  Send,
} from "lucide-react";
import { useActiveOrg } from "@/contexts/org-context";
import {
  useListTeamPlans,
  useGetTeamPlan,
  useApproveTeamPlan,
  useReturnTeamPlan,
  useGetTeamWeekView,
  useGetTeamHistory,
  useGetMyTeams,
} from "@/api/endpoints/orgs/orgs";
import type { TeamPlanSummaryOut } from "@/api/model";
import { getApiErrorMessage } from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function getMonday(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const dayStr = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayStr}`;
}

interface TeamLeadReviewProps {
  initialTeamId?: string;
}

export function TeamLeadReview({ initialTeamId }: TeamLeadReviewProps) {
  const { activeOrgId, activeMembership } = useActiveOrg();
  const queryClient = useQueryClient();

  // Load teams where caller is team_lead
  const { data: myTeams = [] } = useGetMyTeams(activeOrgId ?? "", {
    query: { enabled: Boolean(activeOrgId) },
  });

  const leadTeams = useMemo(() => {
    return myTeams.filter((t) => t.my_team_role === "team_lead" && t.can_enter);
  }, [myTeams]);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const activeTeamId = useMemo(() => {
    if (initialTeamId && leadTeams.some((t) => t.team.id === initialTeamId)) {
      return initialTeamId;
    }
    if (selectedTeamId && leadTeams.some((t) => t.team.id === selectedTeamId)) {
      return selectedTeamId;
    }
    return leadTeams[0]?.team.id ?? "";
  }, [initialTeamId, selectedTeamId, leadTeams]);

  // Section tabs: 'plans' | 'week' | 'history'
  const [activeTab, setActiveTab] = useState<"plans" | "week" | "history">(
    "plans"
  );

  // Plans sub-filter: 'submitted' | 'approved' | 'done' | 'all'
  const [statusFilter, setStatusFilter] = useState<string>("submitted");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // Return Dialog state
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnComment, setReturnComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Week View state
  const [selectedWeekDate, setSelectedWeekDate] = useState<string>(getMonday());

  // Invalidate queries helper
  const invalidateTeamQueries = async () => {
    if (activeOrgId) {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.includes("/teams") || key.includes("/plans"))
          );
        },
      });
      await Promise.all([
        refetchTeamPlans(),
        refetchPlanDetail(),
        refetchWeek(),
        refetchHistory(),
      ]);
    }
  };

  // Queries
  const {
    data: teamPlansData,
    isLoading: isLoadingPlans,
    refetch: refetchTeamPlans,
  } = useListTeamPlans(
    activeOrgId ?? "",
    activeTeamId,
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      page: 1,
      page_size: 50,
    },
    {
      query: {
        enabled: Boolean(activeOrgId && activeTeamId && activeTab === "plans"),
      },
    }
  );

  const teamPlans: TeamPlanSummaryOut[] = useMemo(
    () => teamPlansData?.items ?? [],
    [teamPlansData?.items]
  );

  const activeSelectedPlanId = useMemo(() => {
    if (selectedPlanId && teamPlans.some((p) => p.id === selectedPlanId)) {
      return selectedPlanId;
    }
    return teamPlans.length > 0 && teamPlans[0] ? teamPlans[0].id : null;
  }, [selectedPlanId, teamPlans]);

  const {
    data: selectedPlanDetail,
    isLoading: isLoadingDetail,
    refetch: refetchPlanDetail,
  } = useGetTeamPlan(
    activeOrgId ?? "",
    activeTeamId,
    activeSelectedPlanId ?? "",
    {
      query: {
        enabled: Boolean(
          activeOrgId &&
          activeTeamId &&
          activeSelectedPlanId &&
          activeTab === "plans"
        ),
      },
    }
  );

  const planTasks = useMemo(
    () => selectedPlanDetail?.tasks ?? [],
    [selectedPlanDetail?.tasks]
  );

  // Week Matrix Query
  const {
    data: weekData,
    isLoading: isLoadingWeek,
    refetch: refetchWeek,
  } = useGetTeamWeekView(
    activeOrgId ?? "",
    activeTeamId,
    { week_start_date: selectedWeekDate },
    {
      query: {
        enabled: Boolean(activeOrgId && activeTeamId && activeTab === "week"),
      },
    }
  );

  // Team History Query
  const {
    data: historyData,
    isLoading: isLoadingHistory,
    refetch: refetchHistory,
  } = useGetTeamHistory(
    activeOrgId ?? "",
    activeTeamId,
    { page: 1, page_size: 20 },
    {
      query: {
        enabled: Boolean(
          activeOrgId && activeTeamId && activeTab === "history"
        ),
      },
    }
  );

  // Mutations
  const approvePlanMutation = useApproveTeamPlan({
    mutation: {
      onSuccess: async () => {
        setActionError(null);
        if (statusFilter === "submitted") {
          setSelectedPlanId(null);
        }
        await invalidateTeamQueries();
      },
      onError: (err: unknown) => {
        setActionError(getApiErrorMessage(err, "Failed to approve plan"));
      },
    },
  });

  const returnPlanMutation = useReturnTeamPlan({
    mutation: {
      onSuccess: async () => {
        setActionError(null);
        setReturnDialogOpen(false);
        setReturnComment("");
        if (statusFilter === "submitted") {
          setSelectedPlanId(null);
        }
        await invalidateTeamQueries();
      },
      onError: (err: unknown) => {
        setActionError(getApiErrorMessage(err, "Failed to return plan"));
      },
    },
  });

  // Week stepper helper
  const shiftWeek = (weeksDelta: number) => {
    const cur = new Date(selectedWeekDate);
    cur.setDate(cur.getDate() + weeksDelta * 7);
    setSelectedWeekDate(getMonday(cur));
  };

  const isAuthorSelf = useMemo(() => {
    if (!selectedPlanDetail?.author?.member_id || !activeMembership?.membership?.membership_id) {
      return false;
    }
    return (
      selectedPlanDetail.author.member_id ===
      activeMembership.membership.membership_id
    );
  }, [selectedPlanDetail, activeMembership]);

  if (leadTeams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center">
        <Users className="size-8 text-muted-foreground/60" />
        <h3 className="mt-3 text-base font-semibold">No Team Lead Access</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          You are not currently designated as a Team Lead for any active teams
          in this organization.
        </p>
      </div>
    );
  }

  const selectedTeamName =
    leadTeams.find((t) => t.team.id === activeTeamId)?.team.name ?? "Team";

  return (
    <div className="space-y-6">
      {/* Top Controls: Team Switcher & Tab Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold">
            TL
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Team Lead Workspace
            </h2>
            <p className="text-xs text-muted-foreground">
              Review and approve weekly plans for your team members.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!initialTeamId && leadTeams.length > 1 && (
            <div className="flex items-center gap-2">
              <Label
                htmlFor="team-select"
                className="text-xs text-muted-foreground"
              >
                Team:
              </Label>
              <select
                id="team-select"
                value={activeTeamId}
                onChange={(e) => {
                  setSelectedTeamId(e.target.value);
                  setSelectedPlanId(null);
                }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {leadTeams.map((t) => (
                  <option key={t.team.id} value={t.team.id}>
                    {t.team.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex rounded-lg border bg-muted/40 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab("plans")}
              className={`rounded-md px-3 py-1 transition-colors ${
                activeTab === "plans"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Plans to Review
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("week")}
              className={`rounded-md px-3 py-1 transition-colors ${
                activeTab === "week"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Week Matrix
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`rounded-md px-3 py-1 transition-colors ${
                activeTab === "history"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              History
            </button>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/15 p-3 text-xs text-destructive flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: Plans to Review */}
      {activeTab === "plans" && (
        <div className="space-y-4">
          {/* Sub-filter tabs */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto border-b pb-2 text-xs">
            <div className="flex items-center gap-2">
              {[
                { id: "submitted", label: "Needs Review" },
                { id: "approved", label: "Approved" },
                { id: "done", label: "Completed" },
                { id: "all", label: "All Visible" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === f.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {teamPlans.length} {teamPlans.length === 1 ? "plan" : "plans"}{" "}
              listed
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left list */}
            <div className="space-y-3 lg:col-span-4">
              {isLoadingPlans ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Loading team plans...
                </div>
              ) : teamPlans.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Check className="mx-auto size-7 text-emerald-600 mb-2" />
                    <p className="text-sm font-medium">All caught up!</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No team plans currently match "{statusFilter}".
                    </p>
                  </CardContent>
                </Card>
              ) : (
                teamPlans.map((p) => {
                  const isSelected = p.id === activeSelectedPlanId;
                  const authorName =
                    `${p.author?.first_name || ""} ${p.author?.last_name || ""}`.trim() ||
                    "Team Member";
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20"
                          : "bg-card hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <User className="size-3.5 text-primary shrink-0" />
                            <span className="truncate">{authorName}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Week of {p.week_start_date}
                          </p>
                        </div>
                        <Badge
                          variant={
                            p.status === "approved"
                              ? "default"
                              : p.status === "done"
                                ? "outline"
                                : "secondary"
                          }
                          className="capitalize text-[10px]"
                        >
                          {p.status}
                        </Badge>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground border-t pt-2">
                        <span>
                          {p.done_count} / {p.task_count} tasks done
                        </span>
                        {p.main_shipped !== null &&
                          p.main_shipped !== undefined && (
                            <span
                              className={
                                p.main_shipped
                                  ? "text-emerald-600 font-medium"
                                  : "text-amber-600 font-medium"
                              }
                            >
                              {p.main_shipped ? "Shipped" : "Not Shipped"}
                            </span>
                          )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Right details */}
            <div className="lg:col-span-8">
              {isLoadingDetail ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  Loading plan details...
                </div>
              ) : selectedPlanDetail ? (
                <Card className="shadow-xs">
                  <CardHeader className="border-b bg-muted/20 pb-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">
                            {selectedPlanDetail.author?.first_name || ""}{" "}
                            {selectedPlanDetail.author?.last_name || ""}
                          </CardTitle>
                          <Badge
                            variant={
                              selectedPlanDetail.status === "approved"
                                ? "default"
                                : selectedPlanDetail.status === "done"
                                  ? "outline"
                                  : "secondary"
                            }
                            className="capitalize text-xs"
                          >
                            {selectedPlanDetail.status}
                          </Badge>
                        </div>
                        <CardDescription className="mt-1 text-xs">
                          Weekly Plan for{" "}
                          <span className="font-medium text-foreground">
                            {selectedPlanDetail.week_start_date}
                          </span>{" "}
                          in {selectedTeamName}
                        </CardDescription>
                      </div>

                      {/* Lead actions */}
                      {selectedPlanDetail.status === "submitted" && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              isAuthorSelf || returnPlanMutation.isPending
                            }
                            onClick={() => {
                              setActionError(null);
                              setReturnComment("");
                              setReturnDialogOpen(true);
                            }}
                            className="gap-1.5 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                          >
                            <RotateCcw className="size-3.5" />
                            <span>Return to Draft</span>
                          </Button>

                          <Button
                            size="sm"
                            disabled={
                              isAuthorSelf || approvePlanMutation.isPending
                            }
                            onClick={() => {
                              setActionError(null);
                              approvePlanMutation.mutate({
                                orgId: activeOrgId ?? "",
                                teamId: activeTeamId,
                                planId: selectedPlanDetail.id,
                              });
                            }}
                            className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Check className="size-3.5" />
                            <span>
                              {approvePlanMutation.isPending
                                ? "Approving..."
                                : "Approve Plan"}
                            </span>
                          </Button>
                        </div>
                      )}
                    </div>

                    {isAuthorSelf && (
                      <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertCircle className="size-3.5 shrink-0" />
                        <span>
                          This is your own weekly plan. Team leads cannot
                          approve or return their own plan.
                        </span>
                      </p>
                    )}

                    {selectedPlanDetail.lead_comment && (
                      <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                        <p className="font-semibold text-[11px]">
                          Previous Lead Feedback:
                        </p>
                        <p className="mt-0.5">
                          {selectedPlanDetail.lead_comment}
                        </p>
                      </div>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-6 pt-6">
                    {/* Main Goal Section */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Flag className="size-4 text-primary" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          1. Main Task (Outcome)
                        </h3>
                      </div>

                      {planTasks
                        .filter((t) => t.task_type === "main")
                        .map((t) => (
                          <div
                            key={t.id}
                            className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2"
                          >
                            <p className="text-sm font-semibold">{t.title}</p>
                            {t.why_it_matters && (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-semibold text-foreground">
                                  Why it matters:{" "}
                                </span>
                                {t.why_it_matters}
                              </div>
                            )}
                            {t.description && (
                              <p className="text-xs text-muted-foreground/80 mt-1">
                                {t.description}
                              </p>
                            )}
                          </div>
                        ))}
                    </div>

                    {/* Sub-goals */}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Sub-Goals (
                        {planTasks.filter((t) => t.task_type === "sub").length})
                      </h3>

                      <div className="space-y-2">
                        {planTasks.filter((t) => t.task_type === "sub")
                          .length === 0 ? (
                          <p className="text-xs italic text-muted-foreground">
                            No sub-goals specified.
                          </p>
                        ) : (
                          planTasks
                            .filter((t) => t.task_type === "sub")
                            .map((t) => (
                              <div
                                key={t.id}
                                className="flex items-start gap-2.5 rounded-lg border bg-card p-3 text-sm"
                              >
                                {t.status === "done" ? (
                                  <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                                ) : (
                                  <Clock className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                                )}
                                <div>
                                  <p
                                    className={
                                      t.status === "done"
                                        ? "line-through text-muted-foreground"
                                        : "font-medium"
                                    }
                                  >
                                    {t.title}
                                  </p>
                                  {t.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {t.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    {/* Go-To-Market Tasks */}
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Go-To-Market Tasks (
                        {
                          planTasks.filter(
                            (t) => t.task_type === "go_to_market"
                          ).length
                        }
                        )
                      </h3>

                      <div className="space-y-2">
                        {planTasks.filter((t) => t.task_type === "go_to_market")
                          .length === 0 ? (
                          <p className="text-xs italic text-muted-foreground">
                            No go-to-market tasks specified.
                          </p>
                        ) : (
                          planTasks
                            .filter((t) => t.task_type === "go_to_market")
                            .map((t) => (
                              <div
                                key={t.id}
                                className="flex items-start gap-2.5 rounded-lg border bg-card p-3 text-sm"
                              >
                                {t.status === "done" ? (
                                  <CheckCircle2 className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                                ) : (
                                  <Clock className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                                )}
                                <div>
                                  <p
                                    className={
                                      t.status === "done"
                                        ? "line-through text-muted-foreground"
                                        : "font-medium"
                                    }
                                  >
                                    {t.title}
                                  </p>
                                  {t.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {t.description}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
                  Select a plan from the list to review outcomes and tasks.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Week Status Matrix */}
      {activeTab === "week" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <span className="font-semibold text-sm">
                Week Matrix: {selectedWeekDate}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => shiftWeek(-1)}
                className="h-8 gap-1 text-xs"
              >
                <ChevronLeft className="size-3.5" /> Previous Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => shiftWeek(1)}
                className="h-8 gap-1 text-xs"
              >
                Next Week <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>

          {isLoadingWeek ? (
            <div className="p-12 text-center text-xs text-muted-foreground">
              Loading week matrix...
            </div>
          ) : weekData ? (
            <div className="space-y-6">
              {/* Summary Totals Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Card className="p-3 bg-muted/30">
                  <p className="text-[11px] text-muted-foreground uppercase font-semibold">
                    Total Members
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {weekData.totals.members}
                  </p>
                </Card>
                <Card className="p-3 bg-blue-500/10 border-blue-500/20">
                  <p className="text-[11px] text-blue-700 dark:text-blue-300 uppercase font-semibold">
                    Needs Review
                  </p>
                  <p className="text-2xl font-bold mt-1 text-blue-700 dark:text-blue-300">
                    {weekData.totals.submitted}
                  </p>
                </Card>
                <Card className="p-3 bg-emerald-500/10 border-emerald-500/20">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 uppercase font-semibold">
                    Approved
                  </p>
                  <p className="text-2xl font-bold mt-1 text-emerald-700 dark:text-emerald-300">
                    {weekData.totals.approved}
                  </p>
                </Card>
                <Card className="p-3 bg-purple-500/10 border-purple-500/20">
                  <p className="text-[11px] text-purple-700 dark:text-purple-300 uppercase font-semibold">
                    Completed
                  </p>
                  <p className="text-2xl font-bold mt-1 text-purple-700 dark:text-purple-300">
                    {weekData.totals.done}
                  </p>
                </Card>
                <Card className="p-3 bg-amber-500/10 border-amber-500/20">
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 uppercase font-semibold">
                    No Plan
                  </p>
                  <p className="text-2xl font-bold mt-1 text-amber-700 dark:text-amber-300">
                    {weekData.totals.no_plan}
                  </p>
                </Card>
              </div>

              {/* Members Matrix Table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">
                    Team Members Status
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Every member in {selectedTeamName} for the week of{" "}
                    {selectedWeekDate}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground border-y text-left">
                        <tr>
                          <th className="py-2.5 px-4 font-semibold">Member</th>
                          <th className="py-2.5 px-4 font-semibold">Status</th>
                          <th className="py-2.5 px-4 font-semibold">
                            Tasks Progress
                          </th>
                          <th className="py-2.5 px-4 font-semibold">
                            Main Shipped
                          </th>
                          <th className="py-2.5 px-4 font-semibold text-right">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {weekData.members.map((m) => {
                          const name =
                            `${m.first_name || ""} ${m.last_name || ""}`.trim() ||
                            "Member";
                          return (
                            <tr key={m.member_id} className="hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium flex items-center gap-2">
                                <User className="size-3.5 text-muted-foreground" />
                                <span>{name}</span>
                              </td>
                              <td className="py-3 px-4">
                                <Badge
                                  variant={
                                    m.status === "approved"
                                      ? "default"
                                      : m.status === "done"
                                        ? "outline"
                                        : m.status === "submitted"
                                          ? "secondary"
                                          : "outline"
                                  }
                                  className="text-[10px] capitalize"
                                >
                                  {m.status.replace("_", " ")}
                                </Badge>
                              </td>
                              <td className="py-3 px-4 text-muted-foreground">
                                {m.plan_id ? (
                                  <span>
                                    {m.tasks_done} / {m.tasks_total} done
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="py-3 px-4">
                                {m.main_shipped === true && (
                                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                    <CheckCircle2 className="size-3.5" />{" "}
                                    Shipped
                                  </span>
                                )}
                                {m.main_shipped === false && (
                                  <span className="flex items-center gap-1 text-amber-600 font-medium">
                                    <XCircle className="size-3.5" /> Missed
                                  </span>
                                )}
                                {m.main_shipped === null && (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {m.plan_id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedPlanId(m.plan_id ?? null);
                                      setActiveTab("plans");
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    View Plan
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 3: History View */}
      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <TrendingUp className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">
              Weekly Historical Performance
            </h3>
          </div>

          {isLoadingHistory ? (
            <div className="p-12 text-center text-xs text-muted-foreground">
              Loading team history...
            </div>
          ) : (historyData?.items ?? []).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-xs text-muted-foreground">
                No past weekly data recorded yet for {selectedTeamName}.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground border-y text-left">
                      <tr>
                        <th className="py-2.5 px-4 font-semibold">
                          Week Of (Monday)
                        </th>
                        <th className="py-2.5 px-4 font-semibold">Team Size</th>
                        <th className="py-2.5 px-4 font-semibold">Submitted</th>
                        <th className="py-2.5 px-4 font-semibold">Approved</th>
                        <th className="py-2.5 px-4 font-semibold">Completed</th>
                        <th className="py-2.5 px-4 font-semibold">
                          Outcomes Shipped
                        </th>
                        <th className="py-2.5 px-4 font-semibold">
                          Tasks Completed
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(historyData?.items ?? []).map((h) => (
                        <tr
                          key={h.week_start_date}
                          className="hover:bg-muted/30"
                        >
                          <td className="py-3 px-4 font-medium flex items-center gap-2">
                            <Calendar className="size-3.5 text-primary" />
                            <span>{h.week_start_date}</span>
                          </td>
                          <td className="py-3 px-4">{h.members}</td>
                          <td className="py-3 px-4">{h.submitted}</td>
                          <td className="py-3 px-4">{h.approved}</td>
                          <td className="py-3 px-4">{h.done}</td>
                          <td className="py-3 px-4 font-medium text-emerald-600">
                            {h.shipped}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {h.tasks_done} / {h.tasks_total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Return Plan Feedback Dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Plan for Revisions</DialogTitle>
            <DialogDescription>
              Provide clear feedback so the engineer knows what to clarify or
              adjust before resubmitting.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!returnComment.trim() || !selectedPlanDetail) {
                return;
              }
              returnPlanMutation.mutate({
                orgId: activeOrgId ?? "",
                teamId: activeTeamId,
                planId: selectedPlanDetail.id,
                data: { comment: returnComment.trim() },
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="lead-comment">
                Feedback / Instructions (required)
              </Label>
              <Textarea
                id="lead-comment"
                placeholder="e.g. Please clarify how this outcome will be verified on staging, or add an analytics event GTM task..."
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                rows={4}
                required
                minLength={1}
                maxLength={2000}
              />
              <p className="text-[10px] text-muted-foreground text-right">
                {returnComment.length} / 2000 characters
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReturnDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!returnComment.trim() || returnPlanMutation.isPending}
                className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Send className="size-3.5" />
                {returnPlanMutation.isPending
                  ? "Sending Back..."
                  : "Send Feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
