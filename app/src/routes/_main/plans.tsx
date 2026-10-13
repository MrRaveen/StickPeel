import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  CheckCircle2,
  Clock,
  Send,
  RotateCcw,
  Plus,
  Trash2,
  Edit3,
  AlertCircle,
  Flag,
  Sparkles,
  CheckSquare,
  Square,
  PartyPopper,
  XCircle,
  Crown,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useActiveOrg } from "@/contexts/org-context";
import { getApiErrorMessage } from "@/lib/api-client";
import { TeamLeadReview } from "@/components/plans/TeamLeadReview";
import {
  useListPlans,
  useGetPlan,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
  useUpdateTaskStatus,
  useSubmitPlan,
  useWithdrawPlan,
  useCompletePlan,
  useGetMyTeams,
} from "@/api/endpoints/orgs/orgs";
import {
  useGetOrgAiStatus,
  useCreatePlanDraftFromNotes,
  useReviewExistingPlan,
} from "@/api/endpoints/ai/ai";
import type { TaskIn, PlanOut, Finding, PlanReview } from "@/api/model";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_main/plans")({
  component: PlansPage,
});

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

function parseMondayDate(dateStr: string): Date | undefined {
  if (!dateStr) {
    return undefined;
  }
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    isNaN(y) ||
    isNaN(m) ||
    isNaN(d)
  ) {
    return undefined;
  }
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatMondayDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getUpcomingMondays(): string[] {
  const mondays: string[] = [];
  const today = new Date();
  for (let i = -3; i <= 4; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i * 7);
    mondays.push(getMonday(d));
  }
  return Array.from(new Set(mondays)).sort().reverse();
}

function PlansPage() {
  const { activeOrgId } = useActiveOrg();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"my_plans" | "team_review">(
    "my_plans"
  );


  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states for Plan Creation/Editing
  const [formWeekStart, setFormWeekStart] = useState<string>(getMonday());
  const [formTeamId, setFormTeamId] = useState<string>("");
  const [mainTitle, setMainTitle] = useState("");
  const [mainWhy, setMainWhy] = useState("");
  const [mainDesc, setMainDesc] = useState("");
  const [subTasks, setSubTasks] = useState<
    Array<{ id?: string; title: string; desc: string }>
  >([{ title: "", desc: "" }]);
  const [gtmTasks, setGtmTasks] = useState<
    Array<{ id?: string; title: string; desc: string }>
  >([{ title: "", desc: "" }]);

  // Complete Dialog state
  const [mainShippedAnswer, setMainShippedAnswer] = useState<boolean>(true);

  // AI States
  const [brainDumpDialogOpen, setBrainDumpDialogOpen] = useState(false);
  const [brainDumpNotes, setBrainDumpNotes] = useState("");
  const [brainDumpError, setBrainDumpError] = useState<string | null>(null);
  const [unclearNotes, setUnclearNotes] = useState<string[]>([]);

  interface ActiveReviewState {
    planId: string;
    review: PlanReview;
    planUpdatedAt: string | null;
    generatedAt: string;
  }
  const [activeReview, setActiveReview] = useState<ActiveReviewState | null>(
    null
  );
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [appliedFindingKeys, setAppliedFindingKeys] = useState<Set<string>>(
    new Set()
  );
  const [selectedFindingKeys, setSelectedFindingKeys] = useState<Set<string>>(
    new Set()
  );

  // Queries
  const { data: myTeams = [] } = useGetMyTeams(activeOrgId ?? "", {
    query: { enabled: Boolean(activeOrgId) },
  });

  const { data: aiStatus } = useGetOrgAiStatus(activeOrgId ?? "", {
    query: { enabled: Boolean(activeOrgId) },
  });
  const isAiAvailable = aiStatus?.available ?? true;

  // Filter eligible teams for plan creation (caller cannot be team lead, must have plan.create permission)
  const eligibleTeams = useMemo(() => {
    return myTeams.filter((t) => {
      if (!t.can_enter) {
        return false;
      }
      if (t.my_team_role === "team_lead") {
        return false;
      }
      if (t.permissions && t.permissions.length > 0) {
        return t.permissions.includes("plan.create");
      }
      return true;
    });
  }, [myTeams]);

  // Teams where caller is designated as team lead
  const leadTeams = useMemo(() => {
    return myTeams.filter((t) => t.my_team_role === "team_lead" && t.can_enter);
  }, [myTeams]);

  const {
    data: plansData,
    isLoading: isLoadingPlans,
    refetch: refetchPlans,
  } = useListPlans(
    activeOrgId ?? "",
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      page: 1,
      page_size: 50,
    },
    {
      query: { enabled: Boolean(activeOrgId) },
    }
  );

  const { data: allPlansData, refetch: refetchAllPlans } = useListPlans(
    activeOrgId ?? "",
    {
      page: 1,
      page_size: 100,
    },
    {
      query: { enabled: Boolean(activeOrgId) },
    }
  );

  const plans = useMemo(() => plansData?.items ?? [], [plansData?.items]);

  const existingWeeks = useMemo(() => {
    const all = allPlansData?.items ?? plansData?.items ?? [];
    return new Set(all.map((p) => p.week_start_date));
  }, [allPlansData?.items, plansData?.items]);

  // Automatically select the first plan if none selected
  const activeSelectedPlanId = useMemo(() => {
    if (selectedPlanId && plans.some((p) => p.id === selectedPlanId)) {
      return selectedPlanId;
    }
    return plans.length > 0 && plans[0] ? plans[0].id : null;
  }, [selectedPlanId, plans]);

  const { data: selectedPlan, refetch: refetchSelectedPlan } = useGetPlan(
    activeOrgId ?? "",
    activeSelectedPlanId ?? "",
    {
      query: { enabled: Boolean(activeOrgId && activeSelectedPlanId) },
    }
  );

  // Invalidate all plan queries across all filters/tabs and plan details
  const invalidateAllPlans = async () => {
    if (activeOrgId) {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.includes("/plans") || key.includes("/teams"))
          );
        },
      });
      await Promise.all([
        refetchPlans(),
        refetchAllPlans(),
        refetchSelectedPlan(),
      ]);
    }
  };

  // Mutations
  const createPlanMutation = useCreatePlan({
    mutation: {
      onSuccess: async (newPlan) => {
        await invalidateAllPlans();
        setSelectedPlanId(newPlan.id);
        setCreateDialogOpen(false);
        resetForm();
        if (statusFilter !== "all" && statusFilter !== "draft") {
          setStatusFilter("draft");
        }
      },
      onError: (err: unknown) => {
        setErrorMessage(getApiErrorMessage(err, "Failed to create plan"));
      },
    },
  });

  const updatePlanMutation = useUpdatePlan({
    mutation: {
      onSuccess: async () => {
        await invalidateAllPlans();
        setEditDialogOpen(false);
        resetForm();
      },
      onError: (err: unknown) => {
        setErrorMessage(getApiErrorMessage(err, "Failed to update plan"));
      },
    },
  });

  const deletePlanMutation = useDeletePlan({
    mutation: {
      onSuccess: async () => {
        setSelectedPlanId(null);
        await invalidateAllPlans();
      },
      onError: (err: unknown) => {
        alert(getApiErrorMessage(err, "Failed to delete plan"));
      },
    },
  });

  const submitPlanMutation = useSubmitPlan({
    mutation: {
      onSuccess: async (data) => {
        await invalidateAllPlans();
        if (data?.id) {
          setSelectedPlanId(data.id);
        }
        if (statusFilter === "draft") {
          setStatusFilter("submitted");
        }
      },
      onError: (err: unknown) => {
        alert(getApiErrorMessage(err, "Failed to submit plan"));
      },
    },
  });

  const withdrawPlanMutation = useWithdrawPlan({
    mutation: {
      onSuccess: async (data) => {
        await invalidateAllPlans();
        if (data?.id) {
          setSelectedPlanId(data.id);
        }
        if (statusFilter === "submitted") {
          setStatusFilter("draft");
        }
      },
      onError: (err: unknown) => {
        alert(getApiErrorMessage(err, "Failed to withdraw plan"));
      },
    },
  });

  const completePlanMutation = useCompletePlan({
    mutation: {
      onSuccess: async (data) => {
        await invalidateAllPlans();
        if (data?.id) {
          setSelectedPlanId(data.id);
        }
        setCompleteDialogOpen(false);
        if (statusFilter === "approved") {
          setStatusFilter("done");
        }
      },
      onError: (err: unknown) => {
        alert(getApiErrorMessage(err, "Failed to complete plan"));
      },
    },
  });

  const updateTaskStatusMutation = useUpdateTaskStatus({
    mutation: {
      onMutate: async (variables) => {
        if (!activeOrgId || !activeSelectedPlanId) {
          return { previousPlan: undefined, queryKey: undefined };
        }
        const queryKey = [
          `/orgs/${activeOrgId}/plans/${activeSelectedPlanId}`,
        ] as const;
        await queryClient.cancelQueries({ queryKey });
        const previousPlan = queryClient.getQueryData<PlanOut>(queryKey);
        if (previousPlan) {
          queryClient.setQueryData<PlanOut>(queryKey, {
            ...previousPlan,
            tasks: (previousPlan.tasks ?? []).map((t) =>
              t.id === variables.taskId
                ? { ...t, status: variables.data.status }
                : t
            ),
          });
        }
        return { previousPlan, queryKey };
      },
      onError: (
        _err: unknown,
        _vars: unknown,
        context?: { previousPlan?: PlanOut; queryKey?: readonly string[] }
      ) => {
        if (context?.queryKey && context.previousPlan) {
          queryClient.setQueryData(context.queryKey, context.previousPlan);
        }
      },
      onSuccess: async () => {
        await invalidateAllPlans();
        await refetchSelectedPlan();
      },
    },
  });

  // AI Mutations
  const createPlanDraftMutation = useCreatePlanDraftFromNotes({
    mutation: {
      onSuccess: (data) => {
        const draft = data.draft;
        if (draft.main_task) {
          setMainTitle(draft.main_task.title || "");
          setMainWhy(draft.main_task.why_it_matters || "");
          setMainDesc(draft.main_task.description || "");
        }
        if (draft.sub_goals && draft.sub_goals.length > 0) {
          setSubTasks(
            draft.sub_goals.map((g) => ({
              title: g.title,
              desc: g.description || "",
            }))
          );
        } else {
          setSubTasks([{ title: "", desc: "" }]);
        }
        if (draft.go_to_market && draft.go_to_market.length > 0) {
          setGtmTasks(
            draft.go_to_market.map((g) => ({
              title: g.title,
              desc: g.description || "",
            }))
          );
        } else {
          setGtmTasks([{ title: "", desc: "" }]);
        }
        if (draft.unclear && draft.unclear.length > 0) {
          setUnclearNotes(draft.unclear);
        } else {
          setUnclearNotes([]);
        }
        setBrainDumpDialogOpen(false);
        setBrainDumpNotes("");
        setBrainDumpError(null);
        setCreateDialogOpen(true);
      },
      onError: (err: unknown) => {
        setBrainDumpError(
          getApiErrorMessage(
            err,
            "Failed to generate plan draft. Please try again."
          )
        );
      },
    },
  });

  const reviewPlanMutation = useReviewExistingPlan({
    mutation: {
      onSuccess: (data, variables) => {
        setActiveReview({
          planId: variables.planId,
          review: data.review,
          planUpdatedAt: data.plan_updated_at ?? null,
          generatedAt: data.generated_at,
        });
        setReviewError(null);
        setAppliedFindingKeys(new Set());
        setSelectedFindingKeys(new Set());
      },
      onError: (err: unknown) => {
        setReviewError(
          getApiErrorMessage(err, "Failed to review plan with AI.")
        );
      },
    },
  });

  function formatIssueType(type: string): string {
    switch (type) {
      case "not_checkable": {
        return "Not an Inspectable Result";
      }
      case "missing_why": {
        return "Missing Why It Matters";
      }
      case "missing_gtm": {
        return "Missing Go-To-Market Tasks";
      }
      case "scope_too_big": {
        return "Scope Too Large for One Week";
      }
      default: {
        return "Suggestion";
      }
    }
  }

  function resetForm() {
    setMainTitle("");
    setMainWhy("");
    setMainDesc("");
    setSubTasks([{ title: "", desc: "" }]);
    setGtmTasks([{ title: "", desc: "" }]);
    setErrorMessage(null);
    setUnclearNotes([]);
  }

  function openBrainDumpDialog() {
    setBrainDumpNotes("");
    setBrainDumpError(null);
    const mondays = getUpcomingMondays();
    const currentMon = getMonday();
    let defaultWeek = currentMon;
    if (existingWeeks.has(defaultWeek)) {
      const upcomingAvailable = mondays
        .filter((m) => m >= currentMon && !existingWeeks.has(m))
        .sort();
      if (upcomingAvailable.length > 0 && upcomingAvailable[0]) {
        defaultWeek = upcomingAvailable[0];
      } else {
        const anyAvailable = mondays.find((m) => !existingWeeks.has(m));
        if (anyAvailable) {
          defaultWeek = anyAvailable;
        }
      }
    }
    setFormWeekStart(defaultWeek);
    if (eligibleTeams.length > 0 && eligibleTeams[0]) {
      setFormTeamId(eligibleTeams[0].team.id);
    } else {
      setFormTeamId("");
    }
    setBrainDumpDialogOpen(true);
  }

  function handleBrainDumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrgId || !brainDumpNotes.trim()) {
      return;
    }
    setBrainDumpError(null);
    createPlanDraftMutation.mutate({
      orgId: activeOrgId,
      data: {
        notes: brainDumpNotes.trim(),
        week_start_date: formWeekStart,
      },
    });
  }

  function openCreateDialog() {
    resetForm();
    const mondays = getUpcomingMondays();
    const currentMon = getMonday();
    let defaultWeek = currentMon;
    if (existingWeeks.has(defaultWeek)) {
      const upcomingAvailable = mondays
        .filter((m) => m >= currentMon && !existingWeeks.has(m))
        .sort();
      if (upcomingAvailable.length > 0 && upcomingAvailable[0]) {
        defaultWeek = upcomingAvailable[0];
      } else {
        const anyAvailable = mondays.find((m) => !existingWeeks.has(m));
        if (anyAvailable) {
          defaultWeek = anyAvailable;
        }
      }
    }
    setFormWeekStart(defaultWeek);
    if (eligibleTeams.length > 0 && eligibleTeams[0]) {
      setFormTeamId(eligibleTeams[0].team.id);
    } else {
      setFormTeamId("");
    }
    setCreateDialogOpen(true);
  }

  function openEditDialog() {
    if (!selectedPlan) {
      return;
    }
    setErrorMessage(null);
    setFormWeekStart(selectedPlan.week_start_date);
    setFormTeamId(selectedPlan.team_id || (eligibleTeams[0]?.team.id ?? ""));

    const tasks = selectedPlan.tasks ?? [];
    const mainTask = tasks.find((t) => t.task_type === "main");
    setMainTitle(mainTask?.title || "");
    setMainWhy(mainTask?.why_it_matters || "");
    setMainDesc(mainTask?.description || "");

    const subs = tasks
      .filter((t) => t.task_type === "sub")
      .map((t) => ({ id: t.id, title: t.title, desc: t.description || "" }));
    setSubTasks(subs.length > 0 ? subs : [{ title: "", desc: "" }]);

    const gtms = tasks
      .filter((t) => t.task_type === "go_to_market")
      .map((t) => ({ id: t.id, title: t.title, desc: t.description || "" }));
    setGtmTasks(gtms.length > 0 ? gtms : [{ title: "", desc: "" }]);

    setEditDialogOpen(true);
  }

  function toggleFindingSelection(key: string) {
    setSelectedFindingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function applyFinding(finding: Finding, key: string) {
    applyFindingsList([{ finding, key }]);
  }

  function applyFindingsList(items: Array<{ finding: Finding; key: string }>) {
    if (!selectedPlan || items.length === 0) {
      return;
    }

    const tasks = selectedPlan.tasks ?? [];
    const mainTask = tasks.find((t) => t.task_type === "main");
    const existingSubs = tasks
      .filter((t) => t.task_type === "sub")
      .map((t) => ({ id: t.id, title: t.title, desc: t.description || "" }));
    const existingGtms = tasks
      .filter((t) => t.task_type === "go_to_market")
      .map((t) => ({ id: t.id, title: t.title, desc: t.description || "" }));

    let currentMainTitle = editDialogOpen ? mainTitle : mainTask?.title || "";
    let currentMainWhy = editDialogOpen
      ? mainWhy
      : mainTask?.why_it_matters || "";
    let currentMainDesc = editDialogOpen
      ? mainDesc
      : mainTask?.description || "";
    let currentSubs = editDialogOpen
      ? [...subTasks]
      : existingSubs.length > 0
        ? existingSubs
        : [{ title: "", desc: "" }];
    let currentGtms = editDialogOpen
      ? [...gtmTasks]
      : existingGtms.length > 0
        ? existingGtms
        : [{ title: "", desc: "" }];

    setErrorMessage(null);
    setFormWeekStart(selectedPlan.week_start_date);
    setFormTeamId(selectedPlan.team_id || (eligibleTeams[0]?.team.id ?? ""));

    const newAppliedKeys: string[] = [];

    for (const { finding, key } of items) {
      if (finding.action === "rewrite" && finding.suggested_text) {
        if (finding.target_field === "why_it_matters") {
          currentMainWhy = finding.suggested_text;
        } else if (finding.target_field === "description") {
          if (mainTask && mainTask.id === finding.task_ref) {
            currentMainDesc = finding.suggested_text;
          } else {
            currentSubs = currentSubs.map((s) =>
              s.id === finding.task_ref
                ? { ...s, desc: finding.suggested_text }
                : s
            );
            currentGtms = currentGtms.map((g) =>
              g.id === finding.task_ref
                ? { ...g, desc: finding.suggested_text }
                : g
            );
          }
        } else {
          if (mainTask && mainTask.id === finding.task_ref) {
            currentMainTitle = finding.suggested_text;
          } else {
            currentSubs = currentSubs.map((s) =>
              s.id === finding.task_ref
                ? { ...s, title: finding.suggested_text }
                : s
            );
            currentGtms = currentGtms.map((g) =>
              g.id === finding.task_ref
                ? { ...g, title: finding.suggested_text }
                : g
            );
          }
        }
      } else if (finding.action === "add" && finding.suggested_text) {
        if (finding.suggested_task_type === "go_to_market") {
          const filtered = currentGtms.filter((t) => t.title.trim().length > 0);
          currentGtms = [
            ...filtered,
            { title: finding.suggested_text, desc: "" },
          ];
        } else {
          const filtered = currentSubs.filter((t) => t.title.trim().length > 0);
          currentSubs = [
            ...filtered,
            { title: finding.suggested_text, desc: "" },
          ];
        }
      }
      newAppliedKeys.push(key);
    }

    setMainTitle(currentMainTitle);
    setMainWhy(currentMainWhy);
    setMainDesc(currentMainDesc);
    setSubTasks(currentSubs);
    setGtmTasks(currentGtms);
    setAppliedFindingKeys((prev) => new Set([...prev, ...newAppliedKeys]));
    setSelectedFindingKeys((prev) => {
      const next = new Set(prev);
      newAppliedKeys.forEach((k) => next.delete(k));
      return next;
    });
    setEditDialogOpen(true);
  }

  function applySelectedFindings() {
    if (!currentReview?.review.findings || selectedFindingKeys.size === 0) {
      return;
    }
    const toApply: Array<{ finding: Finding; key: string }> = [];

    // Plan-level findings
    planLevelFindings.forEach((finding, idx) => {
      const key = `plan-${idx}`;
      if (selectedFindingKeys.has(key) && !appliedFindingKeys.has(key)) {
        toApply.push({ finding, key });
      }
    });

    // Task-level findings
    (selectedPlan?.tasks ?? []).forEach((t) => {
      const taskFindings = (currentReview.review.findings ?? []).filter(
        (f) => f.task_ref === t.id
      );
      taskFindings.forEach((finding, idx) => {
        const key = `${t.id}-${idx}`;
        if (selectedFindingKeys.has(key) && !appliedFindingKeys.has(key)) {
          toApply.push({ finding, key });
        }
      });
    });

    if (toApply.length > 0) {
      applyFindingsList(toApply);
    }
  }

  const currentReview = useMemo(() => {
    if (
      activeReview &&
      selectedPlan &&
      activeReview.planId === selectedPlan.id
    ) {
      return activeReview;
    }
    return null;
  }, [activeReview, selectedPlan]);

  const isReviewOutdated = useMemo(() => {
    if (!currentReview || !selectedPlan) {
      return false;
    }
    if (!currentReview.planUpdatedAt || !selectedPlan.updated_at) {
      return false;
    }
    return currentReview.planUpdatedAt !== selectedPlan.updated_at;
  }, [currentReview, selectedPlan]);

  const planLevelFindings = useMemo(() => {
    if (!currentReview?.review.findings) {
      return [];
    }
    return currentReview.review.findings.filter((f) => f.task_ref === "plan");
  }, [currentReview]);

  const applicableFindings = useMemo(() => {
    if (!currentReview?.review.findings || !selectedPlan) {
      return [];
    }
    const list: Array<{ finding: Finding; key: string }> = [];

    // Plan findings with action: add
    planLevelFindings.forEach((finding, idx) => {
      if (finding.action === "add" && finding.suggested_text) {
        list.push({ finding, key: `plan-${idx}` });
      }
    });

    // Task findings with action: rewrite
    (selectedPlan.tasks ?? []).forEach((t) => {
      const taskFindings = (currentReview.review.findings ?? []).filter(
        (f) => f.task_ref === t.id
      );
      taskFindings.forEach((finding, idx) => {
        if (finding.action === "rewrite" && finding.suggested_text) {
          list.push({ finding, key: `${t.id}-${idx}` });
        }
      });
    });

    return list;
  }, [currentReview, selectedPlan, planLevelFindings]);

  const unappliedFindings = useMemo(() => {
    return applicableFindings.filter((item) => !appliedFindingKeys.has(item.key));
  }, [applicableFindings, appliedFindingKeys]);

  const selectedUnappliedCount = useMemo(() => {
    return unappliedFindings.filter((item) => selectedFindingKeys.has(item.key))
      .length;
  }, [unappliedFindings, selectedFindingKeys]);

  function selectAllUnappliedFindings() {
    setSelectedFindingKeys((prev) => {
      const next = new Set(prev);
      unappliedFindings.forEach((item) => next.add(item.key));
      return next;
    });
  }

  function deselectAllFindings() {
    setSelectedFindingKeys(new Set());
  }

  function renderTaskFindings(taskId: string) {
    if (!currentReview?.review.findings) {
      return null;
    }
    const taskFindings = currentReview.review.findings.filter(
      (f) => f.task_ref === taskId
    );
    if (taskFindings.length === 0) {
      return null;
    }

    return (
      <div className="mt-2.5 space-y-2 border-t pt-2.5">
        {taskFindings.map((finding, idx) => {
          const findingKey = `${taskId}-${idx}`;
          const isApplied = appliedFindingKeys.has(findingKey);
          const isSelected = selectedFindingKeys.has(findingKey);
          return (
            <div
              key={idx}
              className={cn(
                "rounded-md border p-2.5 text-xs space-y-1.5 transition-colors",
                isSelected && !isApplied && "ring-1 ring-primary/40 bg-primary/5",
                finding.severity === "blocker"
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200"
                  : "border-muted bg-muted/40 text-foreground"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {!isApplied && selectedPlan?.status === "draft" && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleFindingSelection(findingKey)}
                      aria-label="Select change to apply"
                      className="size-3.5 mt-0.5"
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] uppercase font-semibold px-1.5 py-0",
                        finding.severity === "blocker"
                          ? "border-amber-500 text-amber-600"
                          : "text-muted-foreground"
                      )}
                    >
                      {finding.severity}
                    </Badge>
                    <span className="font-medium text-[11px]">
                      {formatIssueType(finding.issue_type)}
                    </span>
                  </div>
                </div>
                {finding.action === "rewrite" && finding.suggested_text && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isApplied ? "ghost" : "outline"}
                    disabled={isApplied || selectedPlan?.status !== "draft"}
                    onClick={() => applyFinding(finding, findingKey)}
                    className="shrink-0 gap-1 h-6 text-[10px] px-2"
                  >
                    {isApplied ? (
                      <>
                        <CheckCircle2 className="size-3 text-emerald-600" />
                        <span>Applied</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3 text-primary" />
                        <span>Apply Rewrite</span>
                      </>
                    )}
                  </Button>
                )}
              </div>

              <p className="text-muted-foreground text-[11px]">
                {finding.problem}
              </p>

              {finding.suggested_text && (
                <div className="rounded bg-background/90 p-1.5 text-[11px] border border-muted font-mono">
                  <span className="font-semibold text-primary font-sans">
                    Rewrite ({finding.target_field ?? "text"}):{" "}
                  </span>
                  <span>{finding.suggested_text}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrgId || !formTeamId || !mainTitle.trim() || !mainWhy.trim()) {
      setErrorMessage(
        "Please select a team and provide the Main Task title and Why it matters."
      );
      return;
    }

    if (existingWeeks.has(formWeekStart)) {
      setErrorMessage(
        `A plan already exists for the week of ${formWeekStart}. Please select a different week.`
      );
      return;
    }

    const selectedTeam = myTeams.find((t) => t.team.id === formTeamId);
    const canCreateInTeam =
      selectedTeam &&
      selectedTeam.can_enter &&
      selectedTeam.my_team_role !== "team_lead" &&
      (selectedTeam.permissions && selectedTeam.permissions.length > 0
        ? selectedTeam.permissions.includes("plan.create")
        : true);

    if (!canCreateInTeam) {
      setErrorMessage(
        "Team leads cannot create plans for teams they lead. Please select a team where you are a member."
      );
      return;
    }

    const tasksPayload: TaskIn[] = [];
    let order = 0;

    tasksPayload.push({
      task_type: "main",
      title: mainTitle.trim(),
      why_it_matters: mainWhy.trim(),
      description: mainDesc.trim() || null,
      order_index: order++,
    });

    for (const sub of subTasks) {
      if (sub.title.trim()) {
        tasksPayload.push({
          task_type: "sub",
          title: sub.title.trim(),
          description: sub.desc.trim() || null,
          why_it_matters: null,
          order_index: order++,
        });
      }
    }

    for (const gtm of gtmTasks) {
      if (gtm.title.trim()) {
        tasksPayload.push({
          task_type: "go_to_market",
          title: gtm.title.trim(),
          description: gtm.desc.trim() || null,
          why_it_matters: null,
          order_index: order++,
        });
      }
    }

    createPlanMutation.mutate({
      orgId: activeOrgId,
      data: {
        week_start_date: formWeekStart,
        team_id: formTeamId,
        tasks: tasksPayload,
      },
    });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrgId || !selectedPlan || !mainTitle.trim() || !mainWhy.trim()) {
      setErrorMessage("Please fill all required fields.");
      return;
    }

    if (formTeamId && formTeamId !== selectedPlan.team_id) {
      const selectedTeam = myTeams.find((t) => t.team.id === formTeamId);
      const canSelectTeam =
        selectedTeam &&
        selectedTeam.can_enter &&
        selectedTeam.my_team_role !== "team_lead" &&
        (selectedTeam.permissions && selectedTeam.permissions.length > 0
          ? selectedTeam.permissions.includes("plan.create")
          : true);
      if (!canSelectTeam) {
        setErrorMessage(
          "Team leads cannot assign plans to teams they lead. Please select a team where you are a member."
        );
        return;
      }
    }

    const tasksPayload: TaskIn[] = [];
    let order = 0;

    const existingMain = (selectedPlan.tasks ?? []).find(
      (t) => t.task_type === "main"
    );
    tasksPayload.push({
      id: existingMain?.id,
      task_type: "main",
      title: mainTitle.trim(),
      why_it_matters: mainWhy.trim(),
      description: mainDesc.trim() || null,
      order_index: order++,
    });

    for (const sub of subTasks) {
      if (sub.title.trim()) {
        tasksPayload.push({
          id: sub.id,
          task_type: "sub",
          title: sub.title.trim(),
          description: sub.desc.trim() || null,
          why_it_matters: null,
          order_index: order++,
        });
      }
    }

    for (const gtm of gtmTasks) {
      if (gtm.title.trim()) {
        tasksPayload.push({
          id: gtm.id,
          task_type: "go_to_market",
          title: gtm.title.trim(),
          description: gtm.desc.trim() || null,
          why_it_matters: null,
          order_index: order++,
        });
      }
    }

    updatePlanMutation.mutate({
      orgId: activeOrgId,
      planId: selectedPlan.id,
      data: {
        team_id: formTeamId,
        tasks: tasksPayload,
      },
    });
  }

  function handleTaskToggle(taskId: string, currentStatus: string) {
    if (!activeOrgId || !selectedPlan || selectedPlan.status !== "approved") {
      return;
    }
    const nextStatus = currentStatus === "done" ? "pending" : "done";
    updateTaskStatusMutation.mutate({
      orgId: activeOrgId,
      planId: selectedPlan.id,
      taskId,
      data: { status: nextStatus },
    });
  }

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case "approved":
        return "default";
      case "submitted":
        return "secondary";
      case "done":
        return "outline";
      case "draft":
      default:
        return "secondary";
    }
  };

  if (!activeOrgId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
        <Sparkles className="size-10 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No Organization Selected</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Select or create an organization from the sidebar to view and manage
          weekly plans.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Weekly Plans
            </h1>
            {leadTeams.length > 0 && (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-amber-500/30 text-amber-700 dark:text-amber-300"
              >
                <Crown className="size-3 text-amber-500" />
                <span>Team Lead</span>
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Publish weekly commitments. Focus on shipping one significant
            outcome by Friday.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {leadTeams.length > 0 && (
            <div className="flex rounded-lg border bg-muted/40 p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setViewMode("my_plans")}
                className={`rounded-md px-3 py-1.5 transition-colors ${viewMode === "my_plans"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                My Weekly Plans
              </button>
              <button
                type="button"
                onClick={() => setViewMode("team_review")}
                className={`rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5 ${viewMode === "team_review"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <span>Review Team Plans ({leadTeams.length})</span>
              </button>
            </div>
          )}

          {viewMode === "my_plans" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={openBrainDumpDialog}
                disabled={!isAiAvailable || eligibleTeams.length === 0}
                className="shrink-0 gap-2 border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary shadow-xs"
              >
                <Sparkles className="size-4" />
                <span>Draft with AI</span>
              </Button>
              <Button
                onClick={openCreateDialog}
                className="shrink-0 gap-2 shadow-xs"
              >
                <Plus className="size-4" />
                <span>New Weekly Plan</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {viewMode === "team_review" ? (
        <TeamLeadReview />
      ) : (
        <>
          {/* Filter Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto border-b pb-2 text-sm">
            {["all", "draft", "submitted", "approved", "done"].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${statusFilter === st
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Plans Content Grid */}
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left Column: List of Plans */}
            <div className="space-y-3 lg:col-span-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Weeks ({plans.length})
              </h2>

              {isLoadingPlans ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading plans...
                </div>
              ) : plans.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center">
                    <CalendarIcon className="mx-auto size-8 text-muted-foreground/60" />
                    <p className="mt-2 text-sm font-medium">No plans found</p>
                    <p className="text-xs text-muted-foreground">
                      Create a plan for the week to start tracking outcomes.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                plans.map((p) => {
                  const isSelected = p.id === activeSelectedPlanId;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`cursor-pointer rounded-lg border p-4 transition-all ${isSelected
                          ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20"
                          : "bg-card hover:bg-muted/50"
                        }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="size-3.5 text-muted-foreground" />
                            <span className="text-sm font-semibold">
                              Week of {p.week_start_date}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.done_count} / {p.task_count} tasks done
                          </p>
                        </div>
                        <Badge
                          variant={statusBadgeVariant(p.status)}
                          className="capitalize text-[10px]"
                        >
                          {p.status}
                        </Badge>
                      </div>

                      {p.status === "done" && (
                        <div className="mt-3 flex items-center gap-1.5 border-t pt-2 text-xs">
                          {p.main_shipped ? (
                            <span className="flex items-center gap-1 text-emerald-600 font-medium">
                              <CheckCircle2 className="size-3" /> Main goal
                              shipped
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600 font-medium">
                              <XCircle className="size-3" /> Main goal not
                              shipped
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Column: Detailed Plan View */}
            <div className="lg:col-span-8">
              {selectedPlan ? (
                <Card className="shadow-xs">
                  <CardHeader className="border-b bg-muted/20 pb-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <CardTitle className="text-xl">
                            Week of {selectedPlan.week_start_date}
                          </CardTitle>
                          <Badge
                            variant={statusBadgeVariant(selectedPlan.status)}
                            className="text-xs uppercase tracking-wider font-semibold"
                          >
                            {selectedPlan.status}
                          </Badge>
                        </div>
                        <CardDescription className="mt-1">
                          {selectedPlan.team_id
                            ? `Team: ${myTeams.find((t) => t.team.id === selectedPlan.team_id)?.team.name || "Assigned"}`
                            : "No team assigned"}
                        </CardDescription>
                      </div>

                      {/* Actions Bar */}
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedPlan.status === "draft" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (activeOrgId && selectedPlan) {
                                  setReviewError(null);
                                  reviewPlanMutation.mutate({
                                    orgId: activeOrgId,
                                    planId: selectedPlan.id,
                                  });
                                }
                              }}
                              disabled={
                                reviewPlanMutation.isPending || !isAiAvailable
                              }
                              className="gap-1.5 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                            >
                              {reviewPlanMutation.isPending ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              <span>
                                {reviewPlanMutation.isPending
                                  ? "Reviewing..."
                                  : "AI Review"}
                              </span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={openEditDialog}
                              className="gap-1.5"
                            >
                              <Edit3 className="size-3.5" />
                              <span>Edit</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (confirm("Delete this draft plan?")) {
                                  deletePlanMutation.mutate({
                                    orgId: activeOrgId,
                                    planId: selectedPlan.id,
                                  });
                                }
                              }}
                              className="text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                submitPlanMutation.mutate({
                                  orgId: activeOrgId,
                                  planId: selectedPlan.id,
                                })
                              }
                              disabled={submitPlanMutation.isPending}
                              className="gap-1.5"
                            >
                              <Send className="size-3.5" />
                              <span>Submit for Review</span>
                            </Button>
                          </>
                        )}

                        {selectedPlan.status === "submitted" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              withdrawPlanMutation.mutate({
                                orgId: activeOrgId,
                                planId: selectedPlan.id,
                              })
                            }
                            disabled={withdrawPlanMutation.isPending}
                            className="gap-1.5"
                          >
                            <RotateCcw className="size-3.5" />
                            <span>Withdraw to Draft</span>
                          </Button>
                        )}

                        {selectedPlan.status === "approved" && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setMainShippedAnswer(true);
                              setCompleteDialogOpen(true);
                            }}
                            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <PartyPopper className="size-3.5" />
                            <span>Complete Week</span>
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Lead comment notice */}
                    {selectedPlan.lead_comment && (
                      <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                        <AlertCircle className="size-4 shrink-0 text-amber-500 mt-0.5" />
                        <div>
                          <p className="font-semibold">Team Lead Feedback:</p>
                          <p className="mt-0.5">{selectedPlan.lead_comment}</p>
                        </div>
                      </div>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-6 pt-6">
                    {/* AI Review Loading State */}
                    {reviewPlanMutation.isPending && (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 animate-pulse space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-primary">
                          <Loader2 className="size-4 animate-spin" />
                          <span>
                            AI is reviewing your plan against weekly outcome
                            principles...
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Analyzing checkability of results, missing why
                          explanations, go-to-market scope, and week
                          feasibility.
                        </p>
                      </div>
                    )}

                    {/* AI Review Error State */}
                    {reviewError && (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="size-4 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold">AI Review Error</p>
                            <p className="mt-0.5">{reviewError}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-destructive hover:bg-destructive/20"
                          onClick={() => setReviewError(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    )}

                    {/* AI Review Card */}
                    {currentReview && (
                      <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="size-4 text-primary" />
                            <span className="text-sm font-semibold">
                              AI Plan Review
                            </span>
                            <Badge
                              variant={
                                currentReview.review.verdict === "approve"
                                  ? "default"
                                  : "secondary"
                              }
                              className={
                                currentReview.review.verdict === "approve"
                                  ? "bg-emerald-600 text-white"
                                  : "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30"
                              }
                            >
                              {currentReview.review.verdict === "approve"
                                ? "Ready for Submission"
                                : "Needs Adjustments"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {isReviewOutdated && (
                              <Badge
                                variant="outline"
                                className="text-[11px] text-amber-600 border-amber-500/30 bg-amber-500/5"
                              >
                                Outdated (plan edited)
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6 text-muted-foreground hover:text-foreground"
                              onClick={() => setActiveReview(null)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <p className="text-sm text-foreground">
                          {currentReview.review.summary}
                        </p>

                        {/* Plan-level recommendations */}
                        {planLevelFindings.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Plan Recommendations
                            </h5>
                            {planLevelFindings.map((finding, idx) => {
                              const findingKey = `plan-${idx}`;
                              const isApplied =
                                appliedFindingKeys.has(findingKey);
                              const isSelected = selectedFindingKeys.has(findingKey);
                              return (
                                <div
                                  key={idx}
                                  className={cn(
                                    "rounded-lg border p-3 text-xs space-y-2 transition-colors",
                                    isSelected && !isApplied && "ring-1 ring-primary/40 bg-primary/5",
                                    finding.severity === "blocker"
                                      ? "border-amber-500/30 bg-amber-500/5"
                                      : "border-muted bg-muted/30"
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        {!isApplied && selectedPlan.status === "draft" && (
                                          <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() => toggleFindingSelection(findingKey)}
                                            aria-label="Select recommendation to apply"
                                            className="size-3.5"
                                          />
                                        )}
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "text-[10px] uppercase font-semibold",
                                            finding.severity === "blocker"
                                              ? "border-amber-500 text-amber-600"
                                              : "text-muted-foreground"
                                          )}
                                        >
                                          {finding.severity}
                                        </Badge>
                                        <span className="font-medium text-foreground">
                                          {formatIssueType(finding.issue_type)}
                                        </span>
                                      </div>
                                      <p className="text-muted-foreground">
                                        {finding.problem}
                                      </p>
                                    </div>
                                    {finding.action === "add" &&
                                      finding.suggested_text && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={
                                            isApplied ? "ghost" : "outline"
                                          }
                                          disabled={
                                            isApplied ||
                                            selectedPlan.status !== "draft"
                                          }
                                          onClick={() =>
                                            applyFinding(finding, findingKey)
                                          }
                                          className="shrink-0 gap-1 h-7 text-xs"
                                        >
                                          {isApplied ? (
                                            <>
                                              <CheckCircle2 className="size-3 text-emerald-600" />
                                              <span>Added</span>
                                            </>
                                          ) : (
                                            <>
                                              <Plus className="size-3" />
                                              <span>Add to Plan</span>
                                            </>
                                          )}
                                        </Button>
                                      )}
                                  </div>
                                  {finding.suggested_text && (
                                    <div className="rounded border bg-background/80 p-2 text-[11px]">
                                      <span className="font-semibold text-primary">
                                        Suggestion:{" "}
                                      </span>
                                      <span>{finding.suggested_text}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Batch Apply Toolbar inside Review Card */}
                        {selectedPlan.status === "draft" && unappliedFindings.length > 0 && (
                          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-2.5 pt-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-medium">
                                {selectedUnappliedCount > 0 ? (
                                  <span className="text-foreground font-semibold">
                                    {selectedUnappliedCount} of {unappliedFindings.length} change{unappliedFindings.length !== 1 ? "s" : ""} selected
                                  </span>
                                ) : (
                                  <span>{unappliedFindings.length} suggested change{unappliedFindings.length !== 1 ? "s" : ""} available</span>
                                )}
                              </span>
                              <div className="flex items-center gap-1.5 pl-1 text-[11px]">
                                {selectedUnappliedCount < unappliedFindings.length ? (
                                  <button
                                    type="button"
                                    onClick={selectAllUnappliedFindings}
                                    className="text-primary hover:underline font-medium"
                                  >
                                    Select all
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={deselectAllFindings}
                                    className="text-muted-foreground hover:underline"
                                  >
                                    Deselect all
                                  </button>
                                )}
                              </div>
                            </div>

                            <Button
                              type="button"
                              size="sm"
                              disabled={selectedUnappliedCount === 0}
                              onClick={applySelectedFindings}
                              className="h-7 gap-1.5 text-xs shadow-xs"
                            >
                              <Sparkles className="size-3.5" />
                              <span>
                                {selectedUnappliedCount > 0
                                  ? `Apply Selected Changes (${selectedUnappliedCount})`
                                  : "Select changes to apply"}
                              </span>
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Main Goal Section */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Flag className="size-4 text-primary" />
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                          Main Task (Goal)
                        </h3>
                      </div>

                      {(selectedPlan.tasks ?? [])
                        .filter((t) => t.task_type === "main")
                        .map((t) => {
                          const isDone = t.status === "done";
                          const isCheckable =
                            selectedPlan.status === "approved";
                          return (
                            <div
                              key={t.id}
                              className={`rounded-xl border p-4 transition-all ${isDone
                                  ? "border-emerald-500/30 bg-emerald-500/5"
                                  : "border-primary/20 bg-primary/5"
                                }`}
                            >
                              <div className="flex items-start gap-3">
                                {isCheckable ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleTaskToggle(t.id, t.status)
                                    }
                                    className="mt-0.5 text-primary hover:opacity-80"
                                  >
                                    {isDone ? (
                                      <CheckSquare className="size-5 text-emerald-600" />
                                    ) : (
                                      <Square className="size-5 text-muted-foreground" />
                                    )}
                                  </button>
                                ) : (
                                  <div className="mt-0.5">
                                    {isDone ? (
                                      <CheckCircle2 className="size-5 text-emerald-600" />
                                    ) : (
                                      <Clock className="size-5 text-muted-foreground" />
                                    )}
                                  </div>
                                )}

                                <div className="flex-1 space-y-1.5">
                                  <h4
                                    className={`text-base font-semibold leading-snug ${isDone
                                        ? "line-through text-muted-foreground"
                                        : "text-foreground"
                                      }`}
                                  >
                                    {t.title}
                                  </h4>

                                  {t.why_it_matters && (
                                    <div className="rounded-md bg-background/80 p-2 text-xs border border-muted">
                                      <span className="font-semibold text-primary">
                                        Why it matters:{" "}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {t.why_it_matters}
                                      </span>
                                    </div>
                                  )}

                                  {t.description && (
                                    <p className="text-xs text-muted-foreground">
                                      {t.description}
                                    </p>
                                  )}

                                  {renderTaskFindings(t.id)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {/* Sub-Goals Section */}
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Sub-Goals (
                        {
                          (selectedPlan.tasks ?? []).filter(
                            (t) => t.task_type === "sub"
                          ).length
                        }
                        )
                      </h3>

                      <div className="space-y-2">
                        {(selectedPlan.tasks ?? []).filter(
                          (t) => t.task_type === "sub"
                        ).length === 0 ? (
                          <p className="text-xs italic text-muted-foreground">
                            No sub-goals defined.
                          </p>
                        ) : (
                          (selectedPlan.tasks ?? [])
                            .filter((t) => t.task_type === "sub")
                            .map((t) => {
                              const isDone = t.status === "done";
                              const isCheckable =
                                selectedPlan.status === "approved";
                              return (
                                <div
                                  key={t.id}
                                  className="flex items-start gap-3 rounded-lg border bg-card p-3"
                                >
                                  {isCheckable ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleTaskToggle(t.id, t.status)
                                      }
                                      className="mt-0.5 text-primary hover:opacity-80"
                                    >
                                      {isDone ? (
                                        <CheckSquare className="size-4 text-emerald-600" />
                                      ) : (
                                        <Square className="size-4 text-muted-foreground" />
                                      )}
                                    </button>
                                  ) : (
                                    <div className="mt-0.5">
                                      {isDone ? (
                                        <CheckCircle2 className="size-4 text-emerald-600" />
                                      ) : (
                                        <Clock className="size-4 text-muted-foreground" />
                                      )}
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p
                                      className={`text-sm font-medium ${isDone
                                          ? "line-through text-muted-foreground"
                                          : "text-foreground"
                                        }`}
                                    >
                                      {t.title}
                                    </p>
                                    {t.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {t.description}
                                      </p>
                                    )}
                                    {renderTaskFindings(t.id)}
                                  </div>
                                </div>
                              );
                            })
                        )}
                      </div>
                    </div>

                    {/* Go-To-Market Tasks Section */}
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Go-To-Market Tasks (
                        {
                          (selectedPlan.tasks ?? []).filter(
                            (t) => t.task_type === "go_to_market"
                          ).length
                        }
                        )
                      </h3>

                      <div className="space-y-2">
                        {(selectedPlan.tasks ?? []).filter(
                          (t) => t.task_type === "go_to_market"
                        ).length === 0 ? (
                          <p className="text-xs italic text-muted-foreground">
                            No go-to-market tasks defined.
                          </p>
                        ) : (
                          (selectedPlan.tasks ?? [])
                            .filter((t) => t.task_type === "go_to_market")
                            .map((t) => {
                              const isDone = t.status === "done";
                              const isCheckable =
                                selectedPlan.status === "approved";
                              return (
                                <div
                                  key={t.id}
                                  className="flex items-start gap-3 rounded-lg border bg-card p-3"
                                >
                                  {isCheckable ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleTaskToggle(t.id, t.status)
                                      }
                                      className="mt-0.5 text-primary hover:opacity-80"
                                    >
                                      {isDone ? (
                                        <CheckSquare className="size-4 text-emerald-600" />
                                      ) : (
                                        <Square className="size-4 text-muted-foreground" />
                                      )}
                                    </button>
                                  ) : (
                                    <div className="mt-0.5">
                                      {isDone ? (
                                        <CheckCircle2 className="size-4 text-emerald-600" />
                                      ) : (
                                        <Clock className="size-4 text-muted-foreground" />
                                      )}
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p
                                      className={`text-sm font-medium ${isDone
                                          ? "line-through text-muted-foreground"
                                          : "text-foreground"
                                        }`}
                                    >
                                      {t.title}
                                    </p>
                                    {t.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {t.description}
                                      </p>
                                    )}
                                    {renderTaskFindings(t.id)}
                                  </div>
                                </div>
                              );
                            })
                        )}
                      </div>
                    </div>

                    {/* Bottom Apply Selected Changes Bar */}
                    {currentReview &&
                      selectedPlan.status === "draft" &&
                      unappliedFindings.length > 0 && (
                        <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 p-4 backdrop-blur-sm shadow-md rounded-b-xl">
                          <div className="flex items-center gap-2">
                            <Sparkles className="size-4 text-primary" />
                            <span className="text-xs font-medium text-foreground">
                              {selectedUnappliedCount > 0 ? (
                                <span>
                                  <strong>{selectedUnappliedCount}</strong> of{" "}
                                  {unappliedFindings.length} AI suggestion
                                  {unappliedFindings.length !== 1 ? "s" : ""}{" "}
                                  selected
                                </span>
                              ) : (
                                <span>
                                  {unappliedFindings.length} AI suggestion
                                  {unappliedFindings.length !== 1 ? "s" : ""}{" "}
                                  available to apply
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1.5 pl-1.5 text-xs">
                              {selectedUnappliedCount < unappliedFindings.length ? (
                                <button
                                  type="button"
                                  onClick={selectAllUnappliedFindings}
                                  className="text-primary hover:underline font-medium"
                                >
                                  Select all
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={deselectAllFindings}
                                  className="text-muted-foreground hover:underline"
                                >
                                  Deselect all
                                </button>
                              )}
                            </div>
                          </div>

                          <Button
                            type="button"
                            disabled={selectedUnappliedCount === 0}
                            onClick={applySelectedFindings}
                            className="gap-2 shadow-sm"
                          >
                            <Sparkles className="size-4" />
                            <span>
                              {selectedUnappliedCount > 0
                                ? `Apply Selected Changes (${selectedUnappliedCount})`
                                : "Select Changes to Apply"}
                            </span>
                          </Button>
                        </div>
                      )}
                  </CardContent>
                </Card>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                  Select a plan from the list to view its details.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Create / Edit Plan Dialog */}
      <Dialog
        open={createDialogOpen || editDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditDialogOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <DialogTitle>
                  {createDialogOpen ? "Create Weekly Plan" : "Edit Draft Plan"}
                </DialogTitle>
                <DialogDescription>
                  A strong plan states an inspectable outcome, not just a task
                  to do.
                </DialogDescription>
              </div>
              {createDialogOpen &&
                isAiAvailable &&
                eligibleTeams.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCreateDialogOpen(false);
                      openBrainDumpDialog();
                    }}
                    className="gap-1.5 text-xs text-primary border-primary/20 bg-primary/5 hover:bg-primary/10 shrink-0"
                  >
                    <Sparkles className="size-3.5" />
                    <span>Draft from notes</span>
                  </Button>
                )}
            </div>
          </DialogHeader>

          <form
            onSubmit={createDialogOpen ? handleCreateSubmit : handleEditSubmit}
            className="space-y-5"
          >
            {createDialogOpen && unclearNotes.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="size-3.5 text-amber-500 shrink-0" />
                  <span>AI flagged items that were unclear in your notes:</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                  {unclearNotes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-week">Week Starting (Monday)</Label>
                <Popover
                  open={datePopoverOpen}
                  onOpenChange={setDatePopoverOpen}
                >
                  <PopoverTrigger
                    id="plan-week"
                    type="button"
                    disabled={editDialogOpen}
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                      !formWeekStart && "text-muted-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="size-4 text-muted-foreground" />
                      <span>
                        {formWeekStart ? formWeekStart : "Select Monday"}
                      </span>
                    </div>
                    <ChevronDown className="size-4 text-muted-foreground opacity-50" />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="start">
                    <Calendar
                      mode="single"
                      selected={parseMondayDate(formWeekStart)}
                      defaultMonth={
                        parseMondayDate(formWeekStart) ?? new Date()
                      }
                      weekStartsOn={1}
                      onSelect={(selectedDay) => {
                        if (selectedDay) {
                          setFormWeekStart(formatMondayDate(selectedDay));
                          setErrorMessage(null);
                          setDatePopoverOpen(false);
                        }
                      }}
                      disabled={(date) => {
                        // Disallow any day other than Monday
                        if (date.getDay() !== 1) {
                          return true;
                        }
                        // Disallow Monday if plan already exists for this week
                        if (
                          createDialogOpen &&
                          existingWeeks.has(formatMondayDate(date))
                        ) {
                          return true;
                        }
                        return false;
                      }}
                    />
                  </PopoverContent>
                </Popover>
                {createDialogOpen && existingWeeks.has(formWeekStart) && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="size-3 shrink-0" />
                    <span>
                      A plan already exists for this week ({formWeekStart}).
                      Please choose a different week.
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="plan-team">Team</Label>
                <select
                  id="plan-team"
                  value={formTeamId}
                  onChange={(e) => setFormTeamId(e.target.value)}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>
                    Select Team
                  </option>
                  {myTeams.map((t) => {
                    const isLead = t.my_team_role === "team_lead";
                    const isSuspended = !t.can_enter;
                    const canAuthor =
                      !isLead &&
                      !isSuspended &&
                      (t.permissions && t.permissions.length > 0
                        ? t.permissions.includes("plan.create")
                        : true);
                    const isBlocked = !canAuthor;
                    return (
                      <option
                        key={t.team.id}
                        value={t.team.id}
                        disabled={isBlocked}
                      >
                        {t.team.name}
                        {isLead
                          ? " (Team Lead — cannot author plan)"
                          : isSuspended
                            ? " (Suspended)"
                            : ""}
                      </option>
                    );
                  })}
                </select>
                {createDialogOpen && eligibleTeams.length === 0 && (
                  <p className="text-xs text-destructive">
                    You are a team lead in your current teams. Team leads cannot
                    create weekly plans for teams they lead.
                  </p>
                )}
              </div>
            </div>

            {/* Main Task Input */}
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Flag className="size-4 text-primary" />
                <h4 className="text-sm font-semibold">
                  1. Main Task (Outcome)
                </h4>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="main-title">
                  Outcome Title (checkable result)
                </Label>
                <Input
                  id="main-title"
                  placeholder='e.g. "Checkout handles expired cards, confirmed on staging"'
                  value={mainTitle}
                  onChange={(e) => setMainTitle(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="main-why">Why it matters (impact)</Label>
                <Input
                  id="main-why"
                  placeholder='e.g. "Prevents recurring card failure drops during renewal"'
                  value={mainWhy}
                  onChange={(e) => setMainWhy(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="main-desc">Notes / Scope (optional)</Label>
                <Textarea
                  id="main-desc"
                  placeholder="Testing guidelines or criteria..."
                  value={mainDesc}
                  onChange={(e) => setMainDesc(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            {/* Sub-goals */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sub-Goals
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSubTasks([...subTasks, { title: "", desc: "" }])
                  }
                  className="h-7 text-xs gap-1"
                >
                  <Plus className="size-3" /> Add Sub-Goal
                </Button>
              </div>

              {subTasks.map((sub, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Input
                    placeholder="Sub-goal outcome"
                    value={sub.title}
                    onChange={(e) => {
                      const copy = [...subTasks];
                      const item = copy[idx];
                      if (item) {
                        copy[idx] = { ...item, title: e.target.value };
                        setSubTasks(copy);
                      }
                    }}
                    className="flex-1"
                  />
                  {subTasks.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setSubTasks(subTasks.filter((_, i) => i !== idx))
                      }
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Go-to-market */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Go-To-Market Tasks
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setGtmTasks([...gtmTasks, { title: "", desc: "" }])
                  }
                  className="h-7 text-xs gap-1"
                >
                  <Plus className="size-3" /> Add GTM Task
                </Button>
              </div>

              {gtmTasks.map((gtm, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <Input
                    placeholder='e.g. "Changelog entry, feature flag enabled, docs updated"'
                    value={gtm.title}
                    onChange={(e) => {
                      const copy = [...gtmTasks];
                      const item = copy[idx];
                      if (item) {
                        copy[idx] = { ...item, title: e.target.value };
                        setGtmTasks(copy);
                      }
                    }}
                    className="flex-1"
                  />
                  {gtmTasks.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setGtmTasks(gtmTasks.filter((_, i) => i !== idx))
                      }
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {errorMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateDialogOpen(false);
                  setEditDialogOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createPlanMutation.isPending ||
                  updatePlanMutation.isPending ||
                  (createDialogOpen && eligibleTeams.length === 0) ||
                  (createDialogOpen && existingWeeks.has(formWeekStart))
                }
              >
                {createPlanMutation.isPending || updatePlanMutation.isPending
                  ? "Saving..."
                  : createDialogOpen
                    ? "Create Draft Plan"
                    : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Complete Plan Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Weekly Plan</DialogTitle>
            <DialogDescription>
              Mark this week as completed. Did your main goal ship to users by
              Friday?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMainShippedAnswer(true)}
                className={`flex flex-col items-center justify-center rounded-lg border p-4 text-center transition-all ${mainShippedAnswer
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20"
                    : "bg-card hover:bg-muted/50"
                  }`}
              >
                <CheckCircle2 className="size-6 mb-1 text-emerald-600" />
                <span className="font-semibold text-sm">Yes, Shipped</span>
                <span className="text-xs text-muted-foreground">
                  Main goal delivered
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMainShippedAnswer(false)}
                className={`flex flex-col items-center justify-center rounded-lg border p-4 text-center transition-all ${!mainShippedAnswer
                    ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-2 ring-amber-500/20"
                    : "bg-card hover:bg-muted/50"
                  }`}
              >
                <XCircle className="size-6 mb-1 text-amber-600" />
                <span className="font-semibold text-sm">Not Shipped</span>
                <span className="text-xs text-muted-foreground">
                  Blocked or carried over
                </span>
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCompleteDialogOpen(false)}
              disabled={completePlanMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedPlan && activeOrgId) {
                  completePlanMutation.mutate({
                    orgId: activeOrgId,
                    planId: selectedPlan.id,
                    data: { main_shipped: mainShippedAnswer },
                  });
                }
              }}
              disabled={completePlanMutation.isPending}
            >
              {completePlanMutation.isPending ? "Finishing..." : "Mark as Done"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Brain Dump / AI Draft Dialog */}
      <Dialog
        open={brainDumpDialogOpen}
        onOpenChange={(open) => {
          if (!createPlanDraftMutation.isPending) {
            setBrainDumpDialogOpen(open);
            if (!open) {
              setBrainDumpError(null);
            }
          }
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              <DialogTitle>Draft Weekly Plan with AI</DialogTitle>
            </div>
            <DialogDescription>
              Paste your raw thoughts, rough notes, or scratchpad bullet points.
              AI will structure them into a checkable main goal, sub-goals, and
              go-to-market tasks without saving to the database.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleBrainDumpSubmit} className="space-y-4">
            {brainDumpError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/15 p-3 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>{brainDumpError}</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="draft-week">Week Starting (Monday)</Label>
                <Popover
                  open={datePopoverOpen}
                  onOpenChange={setDatePopoverOpen}
                >
                  <PopoverTrigger
                    id="draft-week"
                    type="button"
                    disabled={createPlanDraftMutation.isPending}
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                      !formWeekStart && "text-muted-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="size-4 text-muted-foreground" />
                      <span>
                        {formWeekStart ? formWeekStart : "Select Monday"}
                      </span>
                    </div>
                    <ChevronDown className="size-4 text-muted-foreground opacity-50" />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="start">
                    <Calendar
                      mode="single"
                      selected={parseMondayDate(formWeekStart)}
                      defaultMonth={
                        parseMondayDate(formWeekStart) ?? new Date()
                      }
                      weekStartsOn={1}
                      onSelect={(selectedDay) => {
                        if (selectedDay) {
                          setFormWeekStart(formatMondayDate(selectedDay));
                          setBrainDumpError(null);
                          setDatePopoverOpen(false);
                        }
                      }}
                      disabled={(date) => {
                        if (date.getDay() !== 1) {
                          return true;
                        }
                        if (existingWeeks.has(formatMondayDate(date))) {
                          return true;
                        }
                        return false;
                      }}
                    />
                  </PopoverContent>
                </Popover>
                {existingWeeks.has(formWeekStart) && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="size-3 shrink-0" />
                    <span>
                      A plan already exists for this week ({formWeekStart}).
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="draft-team">Team</Label>
                <select
                  id="draft-team"
                  value={formTeamId}
                  onChange={(e) => setFormTeamId(e.target.value)}
                  disabled={createPlanDraftMutation.isPending}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>
                    Select Team
                  </option>
                  {myTeams.map((t) => {
                    const isLead = t.my_team_role === "team_lead";
                    const isSuspended = !t.can_enter;
                    const canAuthor =
                      !isLead &&
                      !isSuspended &&
                      (t.permissions && t.permissions.length > 0
                        ? t.permissions.includes("plan.create")
                        : true);
                    return (
                      <option
                        key={t.team.id}
                        value={t.team.id}
                        disabled={!canAuthor}
                      >
                        {t.team.name}
                        {isLead
                          ? " (Team Lead — cannot author plan)"
                          : isSuspended
                            ? " (Suspended)"
                            : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="brain-dump-notes">Raw Notes / Brain Dump</Label>
                <span className="text-[11px] text-muted-foreground">
                  {brainDumpNotes.length} / 4000
                </span>
              </div>
              <Textarea
                id="brain-dump-notes"
                rows={6}
                maxLength={4000}
                disabled={createPlanDraftMutation.isPending}
                placeholder="e.g. Need to ship the Stripe renewal fix before Friday. Staging repro is complete. Also remember to add telemetry for expired card errors and update the billing FAQ doc..."
                value={brainDumpNotes}
                onChange={(e) => setBrainDumpNotes(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Tip: Write what you want to achieve and why it matters. AI will
                extract the main outcome, sub-goals, and GTM tasks.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={createPlanDraftMutation.isPending}
                onClick={() => setBrainDumpDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createPlanDraftMutation.isPending ||
                  !brainDumpNotes.trim() ||
                  !formTeamId ||
                  existingWeeks.has(formWeekStart)
                }
                className="gap-2"
              >
                {createPlanDraftMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Structuring Draft...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    <span>Generate Draft</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
