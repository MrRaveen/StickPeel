import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Shield,
  Building2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  UserX,
  UserCheck,
  AlertTriangle,
  Mail,
} from "lucide-react";
import {
  useListUsers,
  useGetUserDetail,
  useDeactivateUser,
  useReactivateUser,
  getListUsersQueryKey,
  getGetUserDetailQueryKey,
} from "@/api/endpoints/users/users";
import type { UserRow, UserMembership } from "@/api/model";
import { useCurrentUser } from "@/contexts/user-context";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_main/users")({
  component: UsersPage,
});

const PAGE_SIZE = 15;

function UsersPage() {
  const queryClient = useQueryClient();
  const currentStaff = useCurrentUser();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [staffFilter, setStaffFilter] = useState<string>("all");

  // Selected User for Detail View
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  // Deactivate User State
  const [deactivateUserTarget, setDeactivateUserTarget] =
    useState<UserRow | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");

  // Reactivate User State
  const [reactivateUserTarget, setReactivateUserTarget] =
    useState<UserRow | null>(null);

  // Query users
  const isActiveParam =
    activeFilter === "all" ? undefined : activeFilter === "active";
  const isStaffParam =
    staffFilter === "all" ? undefined : staffFilter === "staff";

  const { data, isLoading, isError } = useListUsers({
    page,
    page_size: PAGE_SIZE,
    q: search.trim() ? search.trim() : undefined,
    is_active: isActiveParam,
    is_staff: isStaffParam,
  });

  const users = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  // Deactivate mutation
  const deactivateMutation = useDeactivateUser({
    mutation: {
      onSuccess: () => {
        toast.success("User account deactivated.");
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        if (detailUserId) {
          queryClient.invalidateQueries({
            queryKey: getGetUserDetailQueryKey(detailUserId),
          });
        }
        setDeactivateUserTarget(null);
        setDeactivateReason("");
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to deactivate user.";
        toast.error(message);
      },
    },
  });

  // Reactivate mutation
  const reactivateMutation = useReactivateUser({
    mutation: {
      onSuccess: () => {
        toast.success("User account reactivated.");
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        if (detailUserId) {
          queryClient.invalidateQueries({
            queryKey: getGetUserDetailQueryKey(detailUserId),
          });
        }
        setReactivateUserTarget(null);
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to reactivate user.";
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

            Platform Users
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View all registered customer and staff accounts, inspect
            organization memberships, and manage account statuses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs px-2.5 py-1">
            Total: {total.toLocaleString()} Users
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
                placeholder="Search users by name or email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 h-9 text-sm"
              />
            </div>

            {/* Active Status Filter */}
            <div>
              <NativeSelect
                value={activeFilter}
                onChange={(e) => {
                  setActiveFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="all">
                  All Accounts
                </NativeSelectOption>
                <NativeSelectOption value="active">
                  Active Accounts
                </NativeSelectOption>
                <NativeSelectOption value="inactive">
                  Deactivated Accounts
                </NativeSelectOption>
              </NativeSelect>
            </div>

            {/* Staff / Customer Filter */}
            <div>
              <NativeSelect
                value={staffFilter}
                onChange={(e) => {
                  setStaffFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="all">
                  All Account Types
                </NativeSelectOption>
                <NativeSelectOption value="staff">
                  Platform Staff Only
                </NativeSelectOption>
                <NativeSelectOption value="customer">
                  Customers Only
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[300px]">User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Organizations</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="py-4">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-destructive"
                  >
                    Failed to load users. Please try again.
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No users match the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const isCurrentSelf = currentStaff?.user_id === u.id;
                  const fullName =
                    `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
                    "User";

                  return (
                    <TableRow key={u.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                            {fullName.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setDetailUserId(u.id)}
                              className="font-semibold text-sm hover:underline text-left truncate block text-foreground cursor-pointer"
                            >
                              {fullName}
                            </button>
                            <span className="text-xs text-muted-foreground truncate block">
                              {u.email}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        {u.is_active ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30 px-2 py-0.5"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-2 py-0.5"
                          >
                            Deactivated
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        {u.is_staff ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30 gap-1 font-mono"
                          >
                            <Shield className="size-3" /> Staff
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground"
                          >
                            Customer
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-center text-xs font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="size-3 text-muted-foreground" />
                          {u.org_count ?? 0}
                        </span>
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </TableCell>

                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer">
                            <MoreHorizontal className="size-4" />
                            <span className="sr-only">Actions</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => setDetailUserId(u.id)}
                            >
                              <ExternalLink className="size-4 mr-2" />
                              View User Details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {u.is_active ? (
                              <DropdownMenuItem
                                disabled={isCurrentSelf}
                                onClick={() => {
                                  setDeactivateUserTarget(u);
                                  setDeactivateReason("");
                                }}
                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                              >
                                <UserX className="size-4 mr-2" />
                                Deactivate Account
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setReactivateUserTarget(u)}
                                className="text-emerald-600 focus:text-emerald-600 focus:bg-emerald-500/10"
                              >
                                <UserCheck className="size-4 mr-2" />
                                Reactivate Account
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <div>
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)} to{" "}
              {Math.min(page * PAGE_SIZE, total)} of {total} users
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

      {/* Deactivate User Modal */}
      <Dialog
        open={!!deactivateUserTarget}
        onOpenChange={(open) => !open && setDeactivateUserTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Deactivate User Account
            </DialogTitle>
            <DialogDescription>
              Deactivating <strong>{deactivateUserTarget?.email}</strong> will
              revoke their login session immediately. They will not be able to
              log in to StickPeel until reactivated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-xs font-semibold text-foreground">
              Reason for deactivation (recorded in audit trail):
            </label>
            <Textarea
              placeholder="e.g. Employee offboarding, security violation, spam prevention..."
              value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)}
              className="text-xs resize-none h-20"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeactivateUserTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deactivateMutation.isPending}
              onClick={() => {
                if (deactivateUserTarget) {
                  deactivateMutation.mutate({
                    userId: deactivateUserTarget.id,
                    data: { reason: deactivateReason.trim() || undefined },
                  });
                }
              }}
            >
              {deactivateMutation.isPending
                ? "Deactivating..."
                : "Confirm Deactivation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate User Modal */}
      <Dialog
        open={!!reactivateUserTarget}
        onOpenChange={(open) => !open && setReactivateUserTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <UserCheck className="size-5" />
              Reactivate User Account
            </DialogTitle>
            <DialogDescription>
              Reactivate login access for{" "}
              <strong>{reactivateUserTarget?.email}</strong>? They will be able
              to log in again and access their organizations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setReactivateUserTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={reactivateMutation.isPending}
              onClick={() => {
                if (reactivateUserTarget) {
                  reactivateMutation.mutate({
                    userId: reactivateUserTarget.id,
                  });
                }
              }}
            >
              {reactivateMutation.isPending
                ? "Reactivating..."
                : "Confirm Reactivation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Detail Modal */}
      {detailUserId && (
        <UserDetailModal
          userId={detailUserId}
          open={!!detailUserId}
          onOpenChange={(open) => !open && setDetailUserId(null)}
          onDeactivate={(target) => {
            setDetailUserId(null);
            setDeactivateUserTarget(target);
            setDeactivateReason("");
          }}
          onReactivate={(target) => {
            setDetailUserId(null);
            setReactivateUserTarget(target);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Detail Modal
// ---------------------------------------------------------------------------

function UserDetailModal({
  userId,
  open,
  onOpenChange,
  onDeactivate,
  onReactivate,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeactivate: (u: UserRow) => void;
  onReactivate: (u: UserRow) => void;
}) {
  const { data: user, isLoading, isError } = useGetUserDetail(userId);

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <div className="p-8 space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isError || !user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>Failed to load user details.</DialogDescription>
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

  const fullName =
    `${user.first_name || ""} ${user.last_name || ""}`.trim() || "User";
  const userRowForAction: UserRow = {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    is_active: user.is_active,
    is_staff: user.is_staff,
    org_count: user.org_count ?? 0,
    created_at: user.created_at,
  };

  const membershipsList = user.memberships ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl font-bold">
                  {fullName}
                </DialogTitle>
                {user.is_active ? (
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs">
                    Deactivated
                  </Badge>
                )}
                {user.is_staff && (
                  <Badge
                    variant="secondary"
                    className="text-xs bg-purple-500/10 text-purple-700 dark:text-purple-300"
                  >
                    Platform Staff
                  </Badge>
                )}
              </div>
              <DialogDescription className="mt-1 flex items-center gap-2 text-xs">
                <Mail className="size-3 text-muted-foreground" />
                {user.email}
              </DialogDescription>
            </div>
            <div>
              {user.is_active ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs cursor-pointer"
                  onClick={() => onDeactivate(userRowForAction)}
                >
                  <UserX className="size-3.5 mr-1" />
                  Deactivate
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs cursor-pointer"
                  onClick={() => onReactivate(userRowForAction)}
                >
                  <UserCheck className="size-3.5 mr-1" />
                  Reactivate
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* User Metadata */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-2">
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground">User ID</span>
            <div className="font-mono text-[11px] truncate mt-1">{user.id}</div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground">
              Active Organizations
            </span>
            <div className="text-lg font-bold mt-0.5">
              {user.org_count ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <span className="text-xs text-muted-foreground">Registered At</span>
            <div className="text-xs font-semibold mt-1">
              {new Date(user.created_at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        {/* Organization Memberships Table */}
        <div className="space-y-2 mt-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Organization Memberships ({membershipsList.length})
          </h4>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Organization</TableHead>
                  <TableHead className="text-xs">Role in Org</TableHead>
                  <TableHead className="text-xs">Membership Status</TableHead>
                  <TableHead className="text-xs">Org Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membershipsList.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      This user does not belong to any organizations.
                    </TableCell>
                  </TableRow>
                ) : (
                  membershipsList.map((m: UserMembership) => (
                    <TableRow key={m.org_id} className="text-xs">
                      <TableCell className="font-semibold text-foreground">
                        {m.org_name}
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
                      <TableCell>
                        {m.org_suspended ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Suspended
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Normal
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

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
