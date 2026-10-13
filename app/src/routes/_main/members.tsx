import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Users,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Mail,
  UserPlus,
  Copy,
  Check,
  RotateCcw,
  Ban,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrg } from "@/contexts/org-context";
import {
  useListOrgMembers,
  useUpdateMemberRole,
  useRemoveOrgMember,
  useUpdateMemberStatus,
} from "@/api/endpoints/orgs/orgs";
import {
  useListInvitations,
  useCreateInvitation,
  useRenewInvitation,
  useCancelInvitation,
} from "@/api/endpoints/invitations/invitations";
import type {
  MemberOut,
  InvitationOut,
  InvitationOutStatus,
} from "@/api/model";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_main/members")({
  component: MembersPage,
});

function MembersPage() {
  const { activeOrgId, hasPermission, activeMembership } = useActiveOrg();

  const canManageMembers = hasPermission("member.manage");
  const canManageInvites = hasPermission("invite.manage");
  const isOwner = hasPermission("org.role.assign");

  // Tab State: 'members' | 'invitations'
  const [activeTab, setActiveTab] = useState<"members" | "invitations">(
    "members"
  );

  // --- Members State ---
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [memberPage, setMemberPage] = useState(1);
  const pageSize = 15;

  // Member Role change dialog state
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberOut | null>(null);
  const [selectedNewRole, setSelectedNewRole] = useState<"admin" | "member">(
    "member"
  );
  const [roleError, setRoleError] = useState<string | null>(null);

  // --- Invitations State ---
  const [inviteSearchQuery, setInviteSearchQuery] = useState("");
  const [inviteStatusFilter, setInviteStatusFilter] = useState<string>("all");
  const [invitePage, setInvitePage] = useState(1);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  // Invite creation dialog
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Share Link dialog (after create or renew)
  const [shareLinkData, setShareLinkData] = useState<{
    email: string;
    link: string;
    title: string;
  } | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  const queryClient = useQueryClient();

  // Queries
  const {
    data: membersData,
    isLoading: isLoadingMembers,
    refetch: refetchMembers,
  } = useListOrgMembers(
    activeOrgId ?? "",
    {
      q: memberSearchQuery.trim() || undefined,
      role: roleFilter === "all" ? undefined : roleFilter,
      page: memberPage,
      page_size: pageSize,
    },
    {
      query: { enabled: Boolean(activeOrgId && canManageMembers) },
    }
  );

  const {
    data: invitationsData,
    isLoading: isLoadingInvitations,
    refetch: refetchInvitations,
  } = useListInvitations(
    activeOrgId ?? "",
    {
      q: inviteSearchQuery.trim() || undefined,
      status:
        inviteStatusFilter === "all"
          ? undefined
          : (inviteStatusFilter as InvitationOutStatus),
      page: invitePage,
      page_size: pageSize,
    },
    {
      query: { enabled: Boolean(activeOrgId && canManageInvites) },
    }
  );

  // Member Mutations
  const updateRoleMutation = useUpdateMemberRole({
    mutation: {
      onSuccess: () => {
        refetchMembers();
        if (activeOrgId) {
          queryClient.invalidateQueries({
            queryKey: [`/orgs/${activeOrgId}/members`],
          });
        }
        setRoleDialogOpen(false);
        setRoleError(null);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setRoleError(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to update role"
        );
      },
    },
  });

  const removeMemberMutation = useRemoveOrgMember({
    mutation: {
      onSuccess: () => {
        refetchMembers();
        if (activeOrgId) {
          queryClient.invalidateQueries({
            queryKey: [`/orgs/${activeOrgId}/members`],
          });
        }
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        alert(errorObj?.response?.data?.message || "Failed to remove member");
      },
    },
  });

  const updateStatusMutation = useUpdateMemberStatus({
    mutation: {
      onSuccess: () => {
        refetchMembers();
        if (activeOrgId) {
          queryClient.invalidateQueries({
            queryKey: [`/orgs/${activeOrgId}/members`],
          });
        }
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        alert(errorObj?.response?.data?.message || "Failed to update status");
      },
    },
  });

  // Invitation Mutations
  const createInviteMutation = useCreateInvitation({
    mutation: {
      onSuccess: (data) => {
        refetchInvitations();
        setInviteDialogOpen(false);
        setInviteEmail("");
        setInviteRole("member");
        setInviteError(null);
        if (data.link) {
          setShareLinkData({
            email: data.email,
            link: data.link,
            title: "Invitation Link Created",
          });
        }
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { code?: string; message?: string } };
          message?: string;
        };
        const code = errorObj?.response?.data?.code;
        if (code === "already_member") {
          setInviteError(
            "This email already belongs to a member of this organization."
          );
        } else if (code === "invitation_exists") {
          setInviteError(
            "A pending invitation already exists for this email address."
          );
        } else if (code === "not_allowed") {
          setInviteError("Only organization owners can invite administrators.");
        } else {
          setInviteError(
            errorObj?.response?.data?.message ||
              errorObj?.message ||
              "Failed to create invitation."
          );
        }
      },
    },
  });

  const renewInviteMutation = useRenewInvitation({
    mutation: {
      onSuccess: (data) => {
        refetchInvitations();
        if (data.link) {
          setShareLinkData({
            email: data.email,
            link: data.link,
            title: "Invitation Renewed",
          });
        }
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { code?: string; message?: string } };
          message?: string;
        };
        alert(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to renew invitation."
        );
      },
    },
  });

  const cancelInviteMutation = useCancelInvitation({
    mutation: {
      onSuccess: () => {
        refetchInvitations();
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { code?: string; message?: string } };
          message?: string;
        };
        alert(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to cancel invitation."
        );
      },
    },
  });

  const handleCopyLink = async (invitation: InvitationOut) => {
    if (!invitation.link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(invitation.link);
      setCopiedInviteId(invitation.id);
      setTimeout(() => setCopiedInviteId(null), 2000);
    } catch {}
  };

  const handleCopyShareLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 2000);
    } catch {}
  };

  if (!activeOrgId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
        <Users className="size-10 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No Organization Selected</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Select an organization to manage its members.
        </p>
      </div>
    );
  }

  if (!canManageMembers && !canManageInvites) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto size-10 text-amber-500" />
        <h3 className="mt-4 text-base font-semibold">
          Member Management Restricted
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          You do not have permission to view or manage organization members or
          invitations.
        </p>
      </div>
    );
  }

  const members = membersData?.items ?? [];
  const totalMembers = membersData?.total ?? 0;
  const totalMemberPages = Math.ceil(totalMembers / pageSize) || 1;

  const invitations = invitationsData?.items ?? [];
  const totalInvites = invitationsData?.total ?? 0;
  const totalInvitePages = Math.ceil(totalInvites / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Header with Title and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Members & Invitations
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your team accounts, access roles, and pending invitations.
          </p>
        </div>

        {canManageInvites && (
          <Button
            onClick={() => {
              setInviteEmail("");
              setInviteRole("member");
              setInviteError(null);
              setInviteDialogOpen(true);
            }}
            className="gap-2 self-start sm:self-auto cursor-pointer"
          >
            <UserPlus className="size-4" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b pb-1">
        {canManageMembers && (
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-[5px] cursor-pointer ${
              activeTab === "members"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="size-4" />
            Active Members ({totalMembers})
          </button>
        )}

        {canManageInvites && (
          <button
            type="button"
            onClick={() => setActiveTab("invitations")}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-[5px] cursor-pointer ${
              activeTab === "invitations"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mail className="size-4" />
            Invitations ({totalInvites})
          </button>
        )}
      </div>

      {/* Tab Content: Active Members */}
      {activeTab === "members" && canManageMembers && (
        <div className="space-y-4">
          {/* Members Search & Filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={memberSearchQuery}
                onChange={(e) => {
                  setMemberSearchQuery(e.target.value);
                  setMemberPage(1);
                }}
                className="pl-9 h-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setMemberPage(1);
                }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All Roles</option>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            </div>
          </div>

          {/* Members Table */}
          <Card className="shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Joined</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoadingMembers ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-sm text-muted-foreground"
                      >
                        Loading members...
                      </td>
                    </tr>
                  ) : members.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-sm text-muted-foreground"
                      >
                        No members match your criteria.
                      </td>
                    </tr>
                  ) : (
                    members.map((m) => {
                      const isOwnerRole = m.role === "owner";
                      const isMe =
                        m.membership_id ===
                        activeMembership?.membership?.membership_id;
                      const isSuspended = m.status === "suspended";

                      return (
                        <tr
                          key={m.membership_id}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-xs">
                                {m.first_name?.charAt(0) ||
                                  m.email.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-foreground">
                                  {m.first_name || ""} {m.last_name || ""}
                                  {isMe && (
                                    <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                                      (You)
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {m.email}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <Badge
                              variant={
                                isOwnerRole
                                  ? "default"
                                  : m.role === "admin"
                                    ? "secondary"
                                    : "outline"
                              }
                              className="capitalize text-[10px]"
                            >
                              {m.role}
                            </Badge>
                          </td>

                          <td className="px-4 py-3.5">
                            {isSuspended ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px]"
                              >
                                Suspended
                              </Badge>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                                <span className="size-1.5 rounded-full bg-emerald-600" />
                                Active
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3.5 text-xs text-muted-foreground">
                            {new Date(m.joined_at).toLocaleDateString()}
                          </td>

                          <td className="px-4 py-3.5 text-right">
                            {!isOwnerRole && !isMe ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 cursor-pointer"
                                    />
                                  }
                                >
                                  <MoreHorizontal className="size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuGroup>
                                    <DropdownMenuLabel>
                                      Member Actions
                                    </DropdownMenuLabel>

                                    {isOwner && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setSelectedMember(m);
                                          setSelectedNewRole(
                                            m.role === "admin"
                                              ? "member"
                                              : "admin"
                                          );
                                          setRoleError(null);
                                          setRoleDialogOpen(true);
                                        }}
                                        className="cursor-pointer"
                                      >
                                        <Shield className="size-3.5 mr-2" />
                                        <span>Change Role</span>
                                      </DropdownMenuItem>
                                    )}

                                    <DropdownMenuItem
                                      onClick={() => {
                                        updateStatusMutation.mutate({
                                          orgId: activeOrgId,
                                          memberId: m.membership_id,
                                          data: {
                                            status: isSuspended
                                              ? "active"
                                              : "suspended",
                                          },
                                        });
                                      }}
                                      className="cursor-pointer"
                                    >
                                      {isSuspended ? (
                                        <>
                                          <ShieldCheck className="size-3.5 mr-2 text-emerald-600" />
                                          <span>Reactivate Member</span>
                                        </>
                                      ) : (
                                        <>
                                          <ShieldAlert className="size-3.5 mr-2 text-amber-600" />
                                          <span>Suspend Member</span>
                                        </>
                                      )}
                                    </DropdownMenuItem>
                                  </DropdownMenuGroup>

                                  <DropdownMenuSeparator />

                                  <DropdownMenuItem
                                    onClick={() => {
                                      if (
                                        confirm(
                                          `Remove ${m.first_name || m.email} from the organization?`
                                        )
                                      ) {
                                        removeMemberMutation.mutate({
                                          orgId: activeOrgId,
                                          memberId: m.membership_id,
                                        });
                                      }
                                    }}
                                    className="cursor-pointer text-destructive focus:text-destructive"
                                  >
                                    <UserX className="size-3.5 mr-2" />
                                    <span>Remove from Organization</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {totalMemberPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <div>
                  Showing {members.length} of {totalMembers} members
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMemberPage((p) => Math.max(1, p - 1))}
                    disabled={memberPage === 1}
                    className="h-8 gap-1 text-xs"
                  >
                    <ChevronLeft className="size-3.5" /> Previous
                  </Button>
                  <span className="px-2">
                    Page {memberPage} of {totalMemberPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setMemberPage((p) => Math.min(totalMemberPages, p + 1))
                    }
                    disabled={memberPage === totalMemberPages}
                    className="h-8 gap-1 text-xs"
                  >
                    Next <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Tab Content: Invitations */}
      {activeTab === "invitations" && canManageInvites && (
        <div className="space-y-4">
          {/* Invitations Search & Filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by invitee email..."
                value={inviteSearchQuery}
                onChange={(e) => {
                  setInviteSearchQuery(e.target.value);
                  setInvitePage(1);
                }}
                className="pl-9 h-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={inviteStatusFilter}
                onChange={(e) => {
                  setInviteStatusFilter(e.target.value);
                  setInvitePage(1);
                }}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          {/* Invitations Table */}
          <Card className="shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  <tr>
                    <th className="px-4 py-3">Invitee</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Expiration / Details</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoadingInvitations ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-sm text-muted-foreground"
                      >
                        Loading invitations...
                      </td>
                    </tr>
                  ) : invitations.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-sm text-muted-foreground"
                      >
                        No invitations found. Use the "Invite Member" button to
                        invite teammates.
                      </td>
                    </tr>
                  ) : (
                    invitations.map((inv) => {
                      const isPending = inv.status === "pending";
                      const isExpired = inv.status === "expired";
                      const isAccepted = inv.status === "accepted";
                      const isCancelled = inv.status === "cancelled";

                      // Admin cannot renew or cancel an admin invite unless they are the owner
                      const canModify = isOwner || inv.role_name !== "admin";

                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-xs">
                                <Mail className="size-4" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">
                                  {inv.email}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Created by {inv.created_by?.name || "Admin"}{" "}
                                  on{" "}
                                  {new Date(
                                    inv.created_at
                                  ).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <Badge
                              variant={
                                inv.role_name === "admin"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="capitalize text-[10px]"
                            >
                              {inv.role_name}
                            </Badge>
                          </td>

                          <td className="px-4 py-3.5">
                            {isPending && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 capitalize text-[10px]"
                              >
                                Pending
                              </Badge>
                            )}
                            {isAccepted && (
                              <Badge
                                variant="outline"
                                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 capitalize text-[10px]"
                              >
                                Accepted
                              </Badge>
                            )}
                            {isCancelled && (
                              <Badge
                                variant="outline"
                                className="border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 capitalize text-[10px]"
                              >
                                Cancelled
                              </Badge>
                            )}
                            {isExpired && (
                              <Badge
                                variant="outline"
                                className="border-destructive/30 bg-destructive/10 text-destructive capitalize text-[10px]"
                              >
                                Expired
                              </Badge>
                            )}
                          </td>

                          <td className="px-4 py-3.5 text-xs text-muted-foreground">
                            {isAccepted && inv.accepted_at ? (
                              <span>
                                Accepted{" "}
                                {new Date(inv.accepted_at).toLocaleDateString()}
                              </span>
                            ) : isExpired ? (
                              <span className="text-destructive">
                                Expired{" "}
                                {new Date(inv.expires_at).toLocaleDateString()}
                              </span>
                            ) : isPending ? (
                              <span>
                                Expires{" "}
                                {new Date(inv.expires_at).toLocaleDateString()}
                              </span>
                            ) : (
                              <span>Cancelled</span>
                            )}
                          </td>

                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Copy Link Button (only when usable / pending and not expired) */}
                              {isPending && inv.link && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCopyLink(inv)}
                                  className="h-8 gap-1.5 text-xs cursor-pointer"
                                >
                                  {copiedInviteId === inv.id ? (
                                    <>
                                      <Check className="size-3 text-emerald-600" />
                                      <span className="text-emerald-600">
                                        Copied!
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="size-3" />
                                      <span>Copy link</span>
                                    </>
                                  )}
                                </Button>
                              )}

                              {/* Dropdown Menu for Renew / Cancel */}
                              {(isPending || isExpired) && canModify ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8 cursor-pointer"
                                      />
                                    }
                                  >
                                    <MoreHorizontal className="size-4" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuGroup>
                                      <DropdownMenuLabel>
                                        Invitation Actions
                                      </DropdownMenuLabel>

                                      {/* Renew: works on pending or expired */}
                                      <DropdownMenuItem
                                        onClick={() => {
                                          renewInviteMutation.mutate({
                                            orgId: activeOrgId,
                                            invitationId: inv.id,
                                          });
                                        }}
                                        className="cursor-pointer"
                                        disabled={renewInviteMutation.isPending}
                                      >
                                        <RotateCcw className="size-3.5 mr-2" />
                                        <span>Renew Invitation</span>
                                      </DropdownMenuItem>

                                      {/* Cancel: only pending invitations */}
                                      {isPending && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            if (
                                              confirm(
                                                `Cancel the invitation for ${inv.email}? The link will stop working immediately.`
                                              )
                                            ) {
                                              cancelInviteMutation.mutate({
                                                orgId: activeOrgId,
                                                invitationId: inv.id,
                                              });
                                            }
                                          }}
                                          className="cursor-pointer text-destructive focus:text-destructive"
                                          disabled={
                                            cancelInviteMutation.isPending
                                          }
                                        >
                                          <Ban className="size-3.5 mr-2" />
                                          <span>Cancel Invitation</span>
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                !isPending && (
                                  <span className="text-xs text-muted-foreground">
                                    —
                                  </span>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {totalInvitePages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <div>
                  Showing {invitations.length} of {totalInvites} invitations
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInvitePage((p) => Math.max(1, p - 1))}
                    disabled={invitePage === 1}
                    className="h-8 gap-1 text-xs"
                  >
                    <ChevronLeft className="size-3.5" /> Previous
                  </Button>
                  <span className="px-2">
                    Page {invitePage} of {totalInvitePages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setInvitePage((p) => Math.min(totalInvitePages, p + 1))
                    }
                    disabled={invitePage === totalInvitePages}
                    className="h-8 gap-1 text-xs"
                  >
                    Next <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Change Member Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Member Role</DialogTitle>
            <DialogDescription>
              Assign an organization role for{" "}
              {selectedMember?.first_name || selectedMember?.email}.
            </DialogDescription>
          </DialogHeader>

          {roleError && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
              {roleError}
            </div>
          )}

          <div className="space-y-3 py-2">
            <Label>Select Role</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedNewRole("admin")}
                className={`rounded-lg border p-3 text-left transition-all cursor-pointer ${
                  selectedNewRole === "admin"
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "bg-card hover:bg-muted/50"
                }`}
              >
                <p className="font-semibold text-sm">Admin</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manage members, teams, and invites.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedNewRole("member")}
                className={`rounded-lg border p-3 text-left transition-all cursor-pointer ${
                  selectedNewRole === "member"
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "bg-card hover:bg-muted/50"
                }`}
              >
                <p className="font-semibold text-sm">Member</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Standard member, manage own plans.
                </p>
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleDialogOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedMember) {
                  updateRoleMutation.mutate({
                    orgId: activeOrgId,
                    memberId: selectedMember.membership_id,
                    data: { role_name: selectedNewRole },
                  });
                }
              }}
              disabled={updateRoleMutation.isPending}
              className="cursor-pointer"
            >
              {updateRoleMutation.isPending ? "Updating..." : "Update Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Member Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite New Member</DialogTitle>
            <DialogDescription>
              Create a single-use invitation link valid for 7 days.
            </DialogDescription>
          </DialogHeader>

          {inviteError && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
              {inviteError}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Invitee Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            {/* Role picker: Hide admin option unless caller is an owner */}
            {isOwner ? (
              <div className="space-y-2">
                <Label>Select Role</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setInviteRole("member")}
                    className={`rounded-lg border p-3 text-left transition-all cursor-pointer ${
                      inviteRole === "member"
                        ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                        : "bg-card hover:bg-muted/50"
                    }`}
                  >
                    <p className="font-semibold text-sm">Member</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Create and manage weekly plans.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInviteRole("admin")}
                    className={`rounded-lg border p-3 text-left transition-all cursor-pointer ${
                      inviteRole === "admin"
                        ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                        : "bg-card hover:bg-muted/50"
                    }`}
                  >
                    <p className="font-semibold text-sm">Admin</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Manage members, invites, and settings.
                    </p>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Role:{" "}
                <span className="font-semibold capitalize text-foreground">
                  Member
                </span>
                <p className="mt-0.5 text-[11px]">
                  Administrators can only be invited by the organization owner.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteDialogOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const trimmed = inviteEmail.trim().toLowerCase();
                if (!trimmed) {
                  return;
                }
                setInviteError(null);
                createInviteMutation.mutate({
                  orgId: activeOrgId,
                  data: {
                    email: trimmed,
                    role_name: inviteRole,
                  },
                });
              }}
              disabled={!inviteEmail.trim() || createInviteMutation.isPending}
              className="gap-2 cursor-pointer"
            >
              {createInviteMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating Link...
                </>
              ) : (
                "Generate Invitation Link"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Link Dialog (Shown after Create or Renew) */}
      <Dialog
        open={Boolean(shareLinkData)}
        onOpenChange={(open) => {
          if (!open) {
            setShareLinkData(null);
            setCopiedShareLink(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="size-5" />
              </div>
              <DialogTitle>{shareLinkData?.title}</DialogTitle>
            </div>
            <DialogDescription>
              Share this link with{" "}
              <span className="font-semibold text-foreground">
                {shareLinkData?.email}
              </span>
              . The link is single-use and will expire in 7 days.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="relative">
              <Input
                readOnly
                value={shareLinkData?.link || ""}
                className="pr-24 font-mono text-xs"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (shareLinkData?.link) {
                    handleCopyShareLink(shareLinkData.link);
                  }
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 gap-1 text-xs cursor-pointer"
              >
                {copiedShareLink ? (
                  <>
                    <Check className="size-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              No email was sent automatically. You can send this link via Slack,
              email, or team chat.
            </p>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setShareLinkData(null);
                setCopiedShareLink(false);
              }}
              className="cursor-pointer"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
