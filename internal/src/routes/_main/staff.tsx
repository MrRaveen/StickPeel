import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  Search,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import {
  useListStaff,
  useCreateStaff,
  useGetStaffMember,
  useUpdateStaffMember,
  useRemoveStaffMember,
  getListStaffQueryKey,
} from "@/api/endpoints/staff/staff";
import { useListRoles } from "@/api/endpoints/roles/roles";
import type {
  StaffRow,
  StaffCreateRequestRoleName,
  StaffUpdateRequestRoleName,
} from "@/api/model";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_main/staff")({
  component: StaffPage,
});

const PAGE_SIZE = 15;

function StaffPage() {
  const queryClient = useQueryClient();
  const currentStaff = useCurrentUser();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  // Create Staff Dialog State
  const [createOpen, setCreateOpen] = useState(false);
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRoleName, setCreateRoleName] = useState("support");

  // Edit Staff Dialog State
  const [editStaff, setEditStaff] = useState<StaffRow | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editRoleName, setEditRoleName] = useState("");

  // Remove Staff Dialog State
  const [removeStaff, setRemoveStaff] = useState<StaffRow | null>(null);

  // Detail View State
  const [detailStaffId, setDetailStaffId] = useState<string | null>(null);

  // Check permission
  const hasStaffManagePermission =
    currentStaff?.permissions?.includes("platform.staff.manage") ?? false;

  // Roles list query for dropdown
  const { data: rolesData } = useListRoles({
    query: {
      enabled: hasStaffManagePermission,
      retry: false,
    },
  });

  const availableRoles = rolesData ?? [];

  // Query staff list
  const isActiveParam =
    activeFilter === "all" ? undefined : activeFilter === "active";
  const roleParam = roleFilter === "all" ? undefined : roleFilter;

  const { data, isLoading, isError } = useListStaff(
    {
      page,
      page_size: PAGE_SIZE,
      q: search.trim() ? search.trim() : undefined,
      role: roleParam,
      is_active: isActiveParam,
    },
    {
      query: {
        enabled: hasStaffManagePermission,
        retry: false,
      },
    }
  );

  const staffList = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  // Create Mutation
  const createMutation = useCreateStaff({
    mutation: {
      onSuccess: () => {
        toast.success("Staff member created successfully.");
        queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
        setCreateOpen(false);
        setCreateFirstName("");
        setCreateLastName("");
        setCreateEmail("");
        setCreatePassword("");
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to create staff member.";
        toast.error(message);
      },
    },
  });

  // Update Mutation
  const updateMutation = useUpdateStaffMember({
    mutation: {
      onSuccess: () => {
        toast.success("Staff member updated.");
        queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
        setEditStaff(null);
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to update staff member.";
        toast.error(message);
      },
    },
  });

  // Remove Mutation
  const removeMutation = useRemoveStaffMember({
    mutation: {
      onSuccess: () => {
        toast.success("Staff privileges removed.");
        queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
        setRemoveStaff(null);
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Failed to remove staff member.";
        toast.error(message);
      },
    },
  });

  if (!hasStaffManagePermission) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Access Restricted
          </h1>
        </div>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6">
            <p className="text-sm text-foreground">
              Your account (<strong>{currentStaff?.email}</strong>) has the
              platform role <strong>{currentStaff?.role}</strong>, which does
              not have the <code>platform.staff.manage</code> permission.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Only platform administrators with staff management rights may view
              and manage internal personnel.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Shield className="size-6 text-primary" />
            Platform Staff Members
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage internal employees, assign platform-scoped roles, and govern
            administrative access.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="gap-1.5 cursor-pointer"
        >
          <Plus className="size-4" />
          Add Staff Member
        </Button>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-4">
            {/* Search */}
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search staff by name or email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 h-9 text-sm"
              />
            </div>

            {/* Role Filter */}
            <div>
              <NativeSelect
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="all">All Roles</NativeSelectOption>
                {availableRoles.map((r) => (
                  <NativeSelectOption key={r.name} value={r.name}>
                    {r.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
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
                  All Statuses
                </NativeSelectOption>
                <NativeSelectOption value="active">
                  Active Only
                </NativeSelectOption>
                <NativeSelectOption value="inactive">
                  Inactive Only
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[300px]">Staff Member</TableHead>
                <TableHead>Platform Role</TableHead>
                <TableHead>Account Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="py-4">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-destructive"
                  >
                    Failed to load staff list.
                  </TableCell>
                </TableRow>
              ) : staffList.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No staff members match the filters.
                  </TableCell>
                </TableRow>
              ) : (
                staffList.map((s) => {
                  const isCurrentSelf = currentStaff?.user_id === s.user_id;
                  const fullName =
                    `${s.first_name || ""} ${s.last_name || ""}`.trim() ||
                    "Staff";

                  return (
                    <TableRow key={s.user_id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                            {fullName.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setDetailStaffId(s.user_id)}
                              className="font-semibold text-sm hover:underline text-left truncate block text-foreground cursor-pointer"
                            >
                              {fullName}
                            </button>
                            <span className="text-xs text-muted-foreground truncate block">
                              {s.email}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-mono text-[11px] px-2 py-0.5 bg-primary/5 text-primary border-primary/20"
                        >
                          {s.role}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {s.is_active ? (
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
                            Inactive
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString([], {
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
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              onClick={() => setDetailStaffId(s.user_id)}
                            >
                              <Shield className="size-4 mr-2" />
                              View Permissions
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditStaff(s);
                                setEditFirstName(s.first_name);
                                setEditLastName(s.last_name);
                                setEditRoleName(s.role);
                              }}
                            >
                              <Pencil className="size-4 mr-2" />
                              Edit Profile / Role
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={isCurrentSelf}
                              onClick={() => setRemoveStaff(s)}
                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            >
                              <Trash2 className="size-4 mr-2" />
                              Remove Staff Privileges
                            </DropdownMenuItem>
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
              {Math.min(page * PAGE_SIZE, total)} of {total} staff members
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

      {/* Create Staff Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-primary" />
              Add Platform Staff Member
            </DialogTitle>
            <DialogDescription>
              Create an administrative user for the StickPeel internal console.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-foreground">
                  First Name
                </label>
                <Input
                  placeholder="Jane"
                  value={createFirstName}
                  onChange={(e) => setCreateFirstName(e.target.value)}
                  className="mt-1 h-9 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">
                  Last Name
                </label>
                <Input
                  placeholder="Doe"
                  value={createLastName}
                  onChange={(e) => setCreateLastName(e.target.value)}
                  className="mt-1 h-9 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">
                Email
              </label>
              <Input
                type="email"
                placeholder="jane.doe@stickpeel.internal"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                className="mt-1 h-9 text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">
                Temporary Password
              </label>
              <Input
                type="password"
                placeholder="Minimum 8 characters"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                className="mt-1 h-9 text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">
                Platform Role
              </label>
              <NativeSelect
                value={createRoleName}
                onChange={(e) => setCreateRoleName(e.target.value)}
                className="mt-1 w-full"
              >
                {availableRoles.map((r) => (
                  <NativeSelectOption key={r.name} value={r.name}>
                    {r.name}
                  </NativeSelectOption>
                ))}
                {availableRoles.length === 0 && (
                  <>
                    <NativeSelectOption value="super_admin">
                      super_admin
                    </NativeSelectOption>
                    <NativeSelectOption value="admin">admin</NativeSelectOption>
                    <NativeSelectOption value="support">
                      support
                    </NativeSelectOption>
                  </>
                )}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createMutation.isPending ||
                !createEmail ||
                !createPassword ||
                !createFirstName ||
                !createLastName
              }
              onClick={() => {
                createMutation.mutate({
                  data: {
                    first_name: createFirstName.trim(),
                    last_name: createLastName.trim(),
                    email: createEmail.trim(),
                    password: createPassword,
                    role_name: createRoleName as StaffCreateRequestRoleName,
                  },
                });
              }}
            >
              {createMutation.isPending ? "Creating..." : "Create Staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog
        open={!!editStaff}
        onOpenChange={(open) => !open && setEditStaff(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5 text-primary" />
              Edit Staff Member
            </DialogTitle>
            <DialogDescription>
              Update name or change platform role for {editStaff?.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-foreground">
                  First Name
                </label>
                <Input
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="mt-1 h-9 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground">
                  Last Name
                </label>
                <Input
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="mt-1 h-9 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">
                Platform Role
              </label>
              <NativeSelect
                value={editRoleName}
                onChange={(e) => setEditRoleName(e.target.value)}
                disabled={editStaff?.user_id === currentStaff?.user_id}
                className="mt-1 w-full"
              >
                {availableRoles.map((r) => (
                  <NativeSelectOption key={r.name} value={r.name}>
                    {r.name}
                  </NativeSelectOption>
                ))}
                {availableRoles.length === 0 && (
                  <>
                    <NativeSelectOption value="super_admin">
                      super_admin
                    </NativeSelectOption>
                    <NativeSelectOption value="admin">admin</NativeSelectOption>
                    <NativeSelectOption value="support">
                      support
                    </NativeSelectOption>
                  </>
                )}
              </NativeSelect>
              {editStaff?.user_id === currentStaff?.user_id && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  You cannot change your own platform role.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStaff(null)}>
              Cancel
            </Button>
            <Button
              disabled={updateMutation.isPending}
              onClick={() => {
                if (editStaff) {
                  updateMutation.mutate({
                    userId: editStaff.user_id,
                    data: {
                      first_name: editFirstName.trim() || undefined,
                      last_name: editLastName.trim() || undefined,
                      role_name:
                        editStaff.user_id === currentStaff?.user_id
                          ? undefined
                          : (editRoleName as StaffUpdateRequestRoleName),
                    },
                  });
                }
              }}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Staff Dialog */}
      <Dialog
        open={!!removeStaff}
        onOpenChange={(open) => !open && setRemoveStaff(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" />
              Remove Staff Privileges
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove staff privileges from{" "}
              <strong>{removeStaff?.email}</strong>? They will immediately lose
              access to the internal console. Their underlying user account will
              remain intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveStaff(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => {
                if (removeStaff) {
                  removeMutation.mutate({ userId: removeStaff.user_id });
                }
              }}
            >
              {removeMutation.isPending ? "Removing..." : "Confirm Removal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Staff Detail Permissions Dialog */}
      {detailStaffId && (
        <StaffPermissionsModal
          userId={detailStaffId}
          open={!!detailStaffId}
          onOpenChange={(open) => !open && setDetailStaffId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff Permissions Detail Modal
// ---------------------------------------------------------------------------

function StaffPermissionsModal({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: staff, isLoading, isError } = useGetStaffMember(userId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            Staff Member Details & Permissions
          </DialogTitle>
          <DialogDescription>
            {staff
              ? `${staff.first_name} ${staff.last_name} (${staff.email})`
              : "Loading..."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : isError || !staff ? (
          <div className="py-4 text-center text-sm text-destructive">
            Failed to load staff details.
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
              <div>
                <span className="text-xs text-muted-foreground">
                  Assigned Role
                </span>
                <div className="font-semibold text-sm">{staff.role}</div>
              </div>
              <Badge variant={staff.is_active ? "outline" : "destructive"}>
                {staff.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Granted Platform Permissions ({(staff.permissions ?? []).length}
                )
              </h4>
              <div className="rounded-lg border p-3 bg-card max-h-56 overflow-y-auto space-y-1.5">
                {(staff.permissions ?? []).length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No permissions assigned.
                  </span>
                ) : (
                  (staff.permissions ?? []).map((p) => (
                    <div
                      key={p}
                      className="flex items-center gap-2 text-xs font-mono py-0.5 text-foreground"
                    >
                      <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />
                      <span>{p}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
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
