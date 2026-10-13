import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  AlertOctagon,
  CheckCircle2,
  Users,
  Shield,
  Layers,
  Sparkles,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Ban,
  RotateCcw,
  Calendar,
} from "lucide-react";
import {
  useListOrgs,
  useGetOrgDetail,
  useGetOrgMembers,
  useSuspendOrg,
  useReinstateOrg,
  getListOrgsQueryKey,
  getGetOrgDetailQueryKey,
} from "@/api/endpoints/orgs/orgs";
import type { OrgRow, OrgMemberRow } from "@/api/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/_main/orgs")({
  component: OrganizationsPage,
});

const PAGE_SIZE = 15;

function OrganizationsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("created_at");

  // Selected Org for Details Dialog
  const [detailOrgId, setDetailOrgId] = useState<string | null>(null);

  // Suspend Dialog State
  const [suspendOrg, setSuspendOrg] = useState<OrgRow | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  // Reinstate Dialog State
  const [reinstateOrg, setReinstateOrg] = useState<OrgRow | null>(null);

  // Query orgs list
  const isSuspendedParam =
    statusFilter === "all" ? undefined : statusFilter === "suspended";

  const { data, isLoading, isError } = useListOrgs({
    page,
    page_size: PAGE_SIZE,
    q: search.trim() ? search.trim() : undefined,
    is_suspended: isSuspendedParam,
    sort: sortBy,
  });

  const orgs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  // Suspend mutation
  const suspendMutation = useSuspendOrg({
    mutation: {
      onSuccess: () => {
        toast.success("Organization suspended successfully.");
        queryClient.invalidateQueries({ queryKey: getListOrgsQueryKey() });
        if (detailOrgId) {
          queryClient.invalidateQueries({
            queryKey: getGetOrgDetailQueryKey(detailOrgId),
          });
        }
        setSuspendOrg(null);
        setSuspendReason("");
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to suspend organization.";
        toast.error(message);
      },
    },
  });

  // Reinstate mutation
  const reinstateMutation = useReinstateOrg({
    mutation: {
      onSuccess: () => {
        toast.success("Organization reinstated successfully.");
        queryClient.invalidateQueries({ queryKey: getListOrgsQueryKey() });
        if (detailOrgId) {
          queryClient.invalidateQueries({
            queryKey: getGetOrgDetailQueryKey(detailOrgId),
          });
        }
        setReinstateOrg(null);
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to reinstate organization.";
        toast.error(message);
      },
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">

            Organizations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage multi-tenant customer organizations, inspect membership
            metadata, and handle suspensions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs px-2.5 py-1">
            Total: {total.toLocaleString()} Orgs
          </Badge>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-4">
            {/* Search */}
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search organizations by name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 h-9 text-sm"
              />
            </div>

            {/* Status Filter */}
            <div>
              <NativeSelect
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="all">
                  All Statuses
                </NativeSelectOption>
                <NativeSelectOption value="active">
                  Active Only
                </NativeSelectOption>
                <NativeSelectOption value="suspended">
                  Suspended Only
                </NativeSelectOption>
              </NativeSelect>
            </div>

            {/* Sort Filter */}
            <div>
              <NativeSelect
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="created_at">
                  Newest First
                </NativeSelectOption>
                <NativeSelectOption value="+created_at">
                  Oldest First
                </NativeSelectOption>
                <NativeSelectOption value="name">Name (A-Z)</NativeSelectOption>
                <NativeSelectOption value="-name">
                  Name (Z-A)
                </NativeSelectOption>
                <NativeSelectOption value="-last_active_at">
                  Recently Active
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orgs Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[280px]">Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Members</TableHead>
                <TableHead className="text-center">Teams</TableHead>
                <TableHead className="text-center">Plans</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8} className="py-4">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-destructive"
                  >
                    Failed to load organizations. Please try again.
                  </TableCell>
                </TableRow>
              ) : orgs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No organizations match the selected criteria.
                  </TableCell>
                </TableRow>
              ) : (
                orgs.map((org) => (
                  <TableRow key={org.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-semibold shrink-0">
                          {org.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setDetailOrgId(org.id)}
                            className="font-semibold text-sm hover:underline text-left truncate block text-foreground cursor-pointer"
                          >
                            {org.name}
                          </button>
                          <span className="text-[11px] text-muted-foreground font-mono truncate block">
                            {org.id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      {org.is_suspended ? (
                        <Badge
                          variant="destructive"
                          className="text-[10px] px-2 py-0.5"
                        >
                          Suspended
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30 px-2 py-0.5"
                        >
                          Active
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-center text-xs font-medium">
                      {org.member_count ?? 0}
                    </TableCell>

                    <TableCell className="text-center text-xs font-medium">
                      {org.team_count ?? 0}
                    </TableCell>

                    <TableCell className="text-center text-xs font-medium">
                      {org.plan_count ?? 0}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {org.last_active_at
                        ? new Date(org.last_active_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                        : "Never"}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </TableCell>

                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer">
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">Open menu</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onClick={() => setDetailOrgId(org.id)}
                          >
                            <ExternalLink className="size-4 mr-2" />
                            View Org Details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {org.is_suspended ? (
                            <DropdownMenuItem
                              onClick={() => setReinstateOrg(org)}
                              className="text-emerald-600 focus:text-emerald-600 focus:bg-emerald-500/10"
                            >
                              <RotateCcw className="size-4 mr-2" />
                              Reinstate Org
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => {
                                setSuspendOrg(org);
                                setSuspendReason("");
                              }}
                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            >
                              <Ban className="size-4 mr-2" />
                              Suspend Org
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <div>
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)} to{" "}
              {Math.min(page * PAGE_SIZE, total)} of {total} organizations
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Previous
              </Button>
              <span className="px-2 font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Suspend Confirmation Dialog */}
      <Dialog
        open={!!suspendOrg}
        onOpenChange={(open) => !open && setSuspendOrg(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertOctagon className="size-5" />
              Suspend Organization
            </DialogTitle>
            <DialogDescription>
              Suspending <strong>{suspendOrg?.name}</strong> will immediately
              block all members from accessing StickPeel for this tenant.
              Existing active tokens will be rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-xs font-semibold text-foreground">
              Reason for suspension (recorded in audit log):
            </label>
            <Textarea
              placeholder="e.g. Terms of Service violation, payment delinquency, requested by owner..."
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              className="text-xs resize-none h-20"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSuspendOrg(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={suspendMutation.isPending}
              onClick={() => {
                if (suspendOrg) {
                  suspendMutation.mutate({
                    orgId: suspendOrg.id,
                    data: { reason: suspendReason.trim() || undefined },
                  });
                }
              }}
            >
              {suspendMutation.isPending
                ? "Suspending..."
                : "Confirm Suspension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reinstate Confirmation Dialog */}
      <Dialog
        open={!!reinstateOrg}
        onOpenChange={(open) => !open && setReinstateOrg(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="size-5" />
              Reinstate Organization
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to lift the suspension for{" "}
              <strong>{reinstateOrg?.name}</strong>? Customer members will
              immediately regain access to their weekly plans and dashboard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setReinstateOrg(null)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={reinstateMutation.isPending}
              onClick={() => {
                if (reinstateOrg) {
                  reinstateMutation.mutate({ orgId: reinstateOrg.id });
                }
              }}
            >
              {reinstateMutation.isPending
                ? "Reinstating..."
                : "Confirm Reinstatement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Org Detail Modal */}
      {detailOrgId && (
        <OrgDetailModal
          orgId={detailOrgId}
          open={!!detailOrgId}
          onOpenChange={(open) => !open && setDetailOrgId(null)}
          onSuspend={(org) => {
            setDetailOrgId(null);
            setSuspendOrg(org);
            setSuspendReason("");
          }}
          onReinstate={(org) => {
            setDetailOrgId(null);
            setReinstateOrg(org);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Org Detail Modal Component
// ---------------------------------------------------------------------------

function OrgDetailModal({
  orgId,
  open,
  onOpenChange,
  onSuspend,
  onReinstate,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuspend: (org: OrgRow) => void;
  onReinstate: (org: OrgRow) => void;
}) {
  const { data: org, isLoading, isError } = useGetOrgDetail(orgId);
  const [membersPage, setMembersPage] = useState(1);
  const { data: membersData, isLoading: membersLoading } = useGetOrgMembers(
    orgId,
    { page: membersPage, page_size: 10 }
  );

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <div className="p-8 space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isError || !org) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>
              Failed to load organization details.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const orgRowForAction: OrgRow = {
    id: org.id,
    name: org.name,
    is_suspended: org.is_suspended,
    member_count: org.member_count ?? 0,
    team_count: org.team_count ?? 0,
    plan_count: org.plan_count ?? 0,
    last_active_at: org.last_active_at,
    created_at: org.created_at,
  };

  const ownersList = org.owners ?? [];
  const plansStatus = org.plans_by_status;
  const aiStats = org.ai_calls_30d;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl font-bold">
                  {org.name}
                </DialogTitle>
                {org.is_suspended ? (
                  <Badge variant="destructive" className="text-xs">
                    Suspended
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                  >
                    Active
                  </Badge>
                )}
              </div>
              <DialogDescription className="mt-1 font-mono text-xs">
                Organization ID: {org.id}
              </DialogDescription>
            </div>
            <div>
              {org.is_suspended ? (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs cursor-pointer"
                  onClick={() => onReinstate(orgRowForAction)}
                >
                  <RotateCcw className="size-3.5 mr-1" />
                  Reinstate
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs cursor-pointer"
                  onClick={() => onSuspend(orgRowForAction)}
                >
                  <Ban className="size-3.5 mr-1" />
                  Suspend Org
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Overview Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2">
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="size-3 text-primary" /> Members
            </span>
            <div className="text-lg font-bold mt-0.5">
              {org.member_count ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="size-3 text-blue-500" /> Teams
            </span>
            <div className="text-lg font-bold mt-0.5">
              {org.team_count ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Layers className="size-3 text-amber-500" /> Total Plans
            </span>
            <div className="text-lg font-bold mt-0.5">
              {org.plan_count ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="size-3 text-purple-500" /> Created
            </span>
            <div className="text-xs font-semibold mt-1">
              {new Date(org.created_at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview" className="mt-3">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview & Telemetry</TabsTrigger>
            <TabsTrigger value="members">
              Members ({membersData?.total ?? org.member_count ?? 0})
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 pt-3">
            {/* Owners Card */}
            <div className="rounded-lg border p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Organization Owners
              </h4>
              {ownersList.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active owner recorded.
                </p>
              ) : (
                <div className="space-y-2">
                  {ownersList.map((owner) => (
                    <div
                      key={owner.user_id}
                      className="flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-foreground">
                          {owner.name || "Owner"}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          ({owner.email})
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        Owner
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Plan Lifecycle Counts */}
            <div className="rounded-lg border p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Weekly Plans by Lifecycle Stage
              </h4>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-muted/40 p-2.5 rounded-md">
                  <div className="text-xs text-muted-foreground">Draft</div>
                  <div className="text-base font-bold mt-0.5">
                    {plansStatus?.draft ?? 0}
                  </div>
                </div>
                <div className="bg-amber-500/10 p-2.5 rounded-md">
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    Submitted
                  </div>
                  <div className="text-base font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                    {plansStatus?.submitted ?? 0}
                  </div>
                </div>
                <div className="bg-blue-500/10 p-2.5 rounded-md">
                  <div className="text-xs text-blue-700 dark:text-blue-400">
                    Approved
                  </div>
                  <div className="text-base font-bold text-blue-700 dark:text-blue-400 mt-0.5">
                    {plansStatus?.approved ?? 0}
                  </div>
                </div>
                <div className="bg-emerald-500/10 p-2.5 rounded-md">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">
                    Done
                  </div>
                  <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {plansStatus?.done ?? 0}
                  </div>
                </div>
              </div>
            </div>

            {/* 30-Day AI Invocations */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-purple-600" />
                  AI Invocations (Last 30 Days)
                </h4>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/30 p-2.5 rounded-md border">
                  <div className="text-xs text-muted-foreground">
                    Total Invocations
                  </div>
                  <div className="text-lg font-bold mt-0.5">
                    {aiStats?.total ?? 0}
                  </div>
                </div>
                <div className="bg-rose-500/10 p-2.5 rounded-md border border-rose-500/20">
                  <div className="text-xs text-rose-600 dark:text-rose-400">
                    Failures
                  </div>
                  <div className="text-lg font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                    {aiStats?.failed ?? 0}
                  </div>
                </div>
                <div className="bg-amber-500/10 p-2.5 rounded-md border border-amber-500/20">
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    Rate Limited
                  </div>
                  <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    {aiStats?.rate_limited ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members" className="pt-3">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">User</TableHead>
                    <TableHead className="text-xs">Role</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membersLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-xs text-muted-foreground"
                      >
                        Loading members...
                      </TableCell>
                    </TableRow>
                  ) : !membersData?.items || membersData.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-6 text-center text-xs text-muted-foreground"
                      >
                        No members found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    membersData.items.map((m: OrgMemberRow) => (
                      <TableRow key={m.membership_id} className="text-xs">
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {m.name || "Member"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {m.email}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px] capitalize font-mono"
                          >
                            {m.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              m.status === "active" ? "secondary" : "outline"
                            }
                            className="text-[10px] capitalize"
                          >
                            {m.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[11px]">
                          {new Date(m.joined_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {/* Members Pagination */}
            {membersData && membersData.total > 10 && (
              <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
                <span>Total {membersData.total} members</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={membersPage <= 1}
                    onClick={() => setMembersPage((p) => p - 1)}
                  >
                    Prev
                  </Button>
                  <span>Page {membersPage}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={membersPage * 10 >= membersData.total}
                    onClick={() => setMembersPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
