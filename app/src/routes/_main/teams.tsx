import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Users,
  Plus,
  Crown,
  Trash2,
  Edit,
  UserPlus,
  UserX,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrg } from "@/contexts/org-context";
import {
  useGetMyTeams,
  useViewOrgTeams,
  useCreateTeam,
  useGetTeamDetail,
  useUpdateTeam,
  useDeleteTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  useUpdateTeamMemberStatus,
  useAssignTeamLead,
  useListOrgMembers,
} from "@/api/endpoints/orgs/orgs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_main/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const { activeOrgId, hasPermission } = useActiveOrg();
  const queryClient = useQueryClient();

  const canManageTeams = hasPermission("team.manage");
  const canAssignLead = hasPermission("team.lead.assign");

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);

  // Form states
  const [teamName, setTeamName] = useState("");
  const [leadMemberId, setLeadMemberId] = useState("");
  const [newMemberId, setNewMemberId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Queries
  const { data: myTeams = [], refetch: refetchMyTeams } = useGetMyTeams(
    activeOrgId ?? "",
    { query: { enabled: Boolean(activeOrgId) } }
  );

  const { data: allTeams = [], refetch: refetchAllTeams } = useViewOrgTeams(
    activeOrgId ?? "",
    { query: { enabled: Boolean(activeOrgId && canManageTeams) } }
  );

  // Display list: if canManageTeams, show all org teams, otherwise show myTeams
  const displayTeams = canManageTeams
    ? allTeams.map((t) => ({
        id: t.team_id,
        name: t.team_name,
        lead: t.lead,
        member_count: t.member_count,
        my_role: myTeams.find((mt) => mt.team.id === t.team_id)?.my_team_role,
        can_enter: true,
      }))
    : myTeams.map((mt) => ({
        id: mt.team.id,
        name: mt.team.name,
        lead: mt.team.lead,
        member_count: mt.team.member_count,
        my_role: mt.my_team_role,
        can_enter: mt.can_enter,
      }));

  const currentSelectedTeamId =
    selectedTeamId ??
    (displayTeams.length > 0 ? (displayTeams[0]?.id ?? null) : null);

  const { data: teamDetail, refetch: refetchTeamDetail } = useGetTeamDetail(
    activeOrgId ?? "",
    currentSelectedTeamId ?? "",
    { query: { enabled: Boolean(activeOrgId && currentSelectedTeamId) } }
  );

  const { data: orgMembersData, refetch: refetchOrgMembers } =
    useListOrgMembers(
      activeOrgId ?? "",
      { page: 1, page_size: 100 },
      {
        query: {
          enabled: Boolean(
            activeOrgId && (createDialogOpen || addMemberDialogOpen)
          ),
          staleTime: 0,
        },
      }
    );
  const orgMembers = orgMembersData?.items ?? [];

  // Mutations
  const createTeamMutation = useCreateTeam({
    mutation: {
      onSuccess: (newTeam) => {
        refetchMyTeams();
        if (canManageTeams) {
          refetchAllTeams();
        }
        if (activeOrgId) {
          queryClient.invalidateQueries({
            queryKey: [`/orgs/${activeOrgId}/members`],
          });
        }
        setSelectedTeamId(newTeam.id);
        setCreateDialogOpen(false);
        setTeamName("");
        setLeadMemberId("");
        setErrorMessage(null);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setErrorMessage(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to create team"
        );
      },
    },
  });

  const updateTeamMutation = useUpdateTeam({
    mutation: {
      onSuccess: () => {
        refetchMyTeams();
        if (canManageTeams) {
          refetchAllTeams();
        }
        refetchTeamDetail();
        setRenameDialogOpen(false);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setErrorMessage(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to update team"
        );
      },
    },
  });

  const deleteTeamMutation = useDeleteTeam({
    mutation: {
      onSuccess: () => {
        setSelectedTeamId(null);
        refetchMyTeams();
        if (canManageTeams) {
          refetchAllTeams();
        }
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        alert(errorObj?.response?.data?.message || "Failed to delete team");
      },
    },
  });

  const addMemberMutation = useAddTeamMember({
    mutation: {
      onSuccess: () => {
        refetchTeamDetail();
        refetchMyTeams();
        if (canManageTeams) {
          refetchAllTeams();
        }
        refetchOrgMembers();
        setAddMemberDialogOpen(false);
        setNewMemberId("");
        setErrorMessage(null);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setErrorMessage(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to add member"
        );
      },
    },
  });

  const removeMemberMutation = useRemoveTeamMember({
    mutation: {
      onSuccess: () => {
        refetchTeamDetail();
        refetchMyTeams();
        if (canManageTeams) {
          refetchAllTeams();
        }
        refetchOrgMembers();
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

  const updateStatusMutation = useUpdateTeamMemberStatus({
    mutation: {
      onSuccess: () => {
        refetchTeamDetail();
      },
    },
  });

  const assignLeadMutation = useAssignTeamLead({
    mutation: {
      onSuccess: () => {
        refetchTeamDetail();
        refetchMyTeams();
        if (canManageTeams) {
          refetchAllTeams();
        }
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setErrorMessage(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to assign lead"
        );
      },
    },
  });

  if (!activeOrgId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
        <Users className="size-10 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No Organization Selected</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Select an organization to view and manage teams.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground">
            Teams organize members and review weekly plans.
          </p>
        </div>

        {canManageTeams && (
          <Button
            onClick={() => {
              setErrorMessage(null);
              setTeamName("");
              setLeadMemberId("");
              setCreateDialogOpen(true);
              refetchOrgMembers();
            }}
            className="shrink-0 gap-2 shadow-xs"
          >
            <Plus className="size-4" />
            <span>Create Team</span>
          </Button>
        )}
      </div>

      {/* Grid of Teams & Detail Panel */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Teams List */}
        <div className="space-y-3 lg:col-span-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            All Teams ({displayTeams.length})
          </h2>

          {displayTeams.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No teams found in this organization.
              </CardContent>
            </Card>
          ) : (
            displayTeams.map((t) => {
              const isSelected = t.id === currentSelectedTeamId;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTeamId(t.id)}
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20"
                      : "bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Users className="size-4 text-primary" />
                        <span className="font-semibold text-sm">{t.name}</span>
                      </div>

                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {t.lead
                          ? `Lead: ${t.lead.first_name || ""} ${t.lead.last_name || ""}`.trim()
                          : "No team lead"}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {t.member_count}{" "}
                        {t.member_count === 1 ? "member" : "members"}
                      </Badge>
                      {t.my_role === "team_lead" ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          <Crown className="size-3 text-amber-500" /> Lead
                        </span>
                      ) : t.my_role ? (
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {t.my_role.replace("_", " ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Team Detail Panel */}
        <div className="lg:col-span-7">
          {teamDetail ? (
            <Card className="shadow-xs">
              <CardHeader className="border-b bg-muted/20 pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <CardTitle className="text-xl">
                        {teamDetail.name}
                      </CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {teamDetail.member_count} members
                      </Badge>
                    </div>
                    <CardDescription className="mt-1">
                      {teamDetail.lead
                        ? `Lead: ${teamDetail.lead.first_name || ""} ${teamDetail.lead.last_name || ""}`
                        : "No lead assigned"}
                    </CardDescription>
                  </div>

                  {/* Actions for Team Management */}
                  {canManageTeams && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTeamName(teamDetail.name);
                          setErrorMessage(null);
                          setRenameDialogOpen(true);
                        }}
                      >
                        <Edit className="size-3.5 mr-1" />
                        Rename
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete team "${teamDetail.name}"?`)) {
                            deleteTeamMutation.mutate({
                              orgId: activeOrgId,
                              teamId: teamDetail.id,
                            });
                          }
                        }}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                {/* Team Members List */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Members
                    </h3>

                    {canManageTeams && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNewMemberId("");
                          setErrorMessage(null);
                          setAddMemberDialogOpen(true);
                          refetchOrgMembers();
                        }}
                        className="h-8 gap-1 text-xs"
                      >
                        <UserPlus className="size-3.5" /> Add Member
                      </Button>
                    )}
                  </div>

                  <div className="divide-y rounded-lg border bg-card">
                    {(teamDetail.members ?? []).length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted-foreground">
                        No active members in this team.
                      </p>
                    ) : (
                      (teamDetail.members ?? []).map((m) => {
                        const isLead = m.team_role === "team_lead";
                        const isSuspended = m.membership_status === "suspended";
                        return (
                          <div
                            key={m.membership_id}
                            className="flex items-center justify-between p-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                                {m.first_name?.charAt(0) || "U"}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">
                                    {m.first_name || ""} {m.last_name || ""}
                                  </span>
                                  {isLead && (
                                    <Badge
                                      variant="default"
                                      className="gap-1 h-4 px-1.5 text-[10px] bg-amber-600 text-white"
                                    >
                                      <Crown className="size-2.5" /> Lead
                                    </Badge>
                                  )}
                                  {isSuspended && (
                                    <Badge
                                      variant="destructive"
                                      className="h-4 px-1 text-[10px]"
                                    >
                                      Suspended
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {m.email}
                                </p>
                              </div>
                            </div>

                            {/* Member row actions */}
                            {canManageTeams && (
                              <div className="flex items-center gap-1">
                                {canAssignLead && !isLead && !isSuspended && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      assignLeadMutation.mutate({
                                        orgId: activeOrgId,
                                        teamId: teamDetail.id,
                                        data: { member_id: m.membership_id },
                                      });
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    Make Lead
                                  </Button>
                                )}

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    updateStatusMutation.mutate({
                                      orgId: activeOrgId,
                                      teamId: teamDetail.id,
                                      memberId: m.membership_id,
                                      data: {
                                        status: isSuspended
                                          ? "active"
                                          : "suspended",
                                      },
                                    });
                                  }}
                                  className="h-7 text-xs text-muted-foreground"
                                >
                                  {isSuspended ? "Reactivate" : "Suspend"}
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    if (confirm(`Remove member from team?`)) {
                                      removeMemberMutation.mutate({
                                        orgId: activeOrgId,
                                        teamId: teamDetail.id,
                                        memberId: m.membership_id,
                                      });
                                    }
                                  }}
                                  className="size-7 text-muted-foreground hover:text-destructive"
                                >
                                  <UserX className="size-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              Select a team to view members and details.
            </div>
          )}
        </div>
      </div>

      {/* Create Team Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>
              Create a team in your organization to organize weekly planning.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!teamName.trim()) {
                return;
              }
              createTeamMutation.mutate({
                orgId: activeOrgId,
                data: {
                  name: teamName.trim(),
                  lead_member_id: leadMemberId || null,
                },
              });
            }}
            className="space-y-4"
          >
            {errorMessage && (
              <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
                {errorMessage}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="create-team-name">Team Name</Label>
              <Input
                id="create-team-name"
                placeholder='e.g. "Platform Engineering"'
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-team-lead">
                Initial Team Lead (optional)
              </Label>
              <select
                id="create-team-lead"
                value={leadMemberId}
                onChange={(e) => setLeadMemberId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No initial lead</option>
                {orgMembers
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.membership_id} value={m.membership_id}>
                      {m.first_name || ""} {m.last_name || ""} ({m.email})
                    </option>
                  ))}
              </select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createTeamMutation.isPending}>
                {createTeamMutation.isPending ? "Creating..." : "Create Team"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Team Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Team</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedTeamId || !teamName.trim()) {
                return;
              }
              updateTeamMutation.mutate({
                orgId: activeOrgId,
                teamId: selectedTeamId,
                data: { name: teamName.trim() },
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="rename-team-name">Team Name</Label>
              <Input
                id="rename-team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateTeamMutation.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member to Team</DialogTitle>
            <DialogDescription>
              Select an active member of this organization to add to the team.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedTeamId || !newMemberId) {
                return;
              }
              addMemberMutation.mutate({
                orgId: activeOrgId,
                teamId: selectedTeamId,
                data: { member_id: newMemberId },
              });
            }}
            className="space-y-4"
          >
            {errorMessage && (
              <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
                {errorMessage}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="add-member-select">Select Member</Label>
              <select
                id="add-member-select"
                value={newMemberId}
                onChange={(e) => setNewMemberId(e.target.value)}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select a member...</option>
                {orgMembers
                  .filter(
                    (om) =>
                      om.status === "active" &&
                      !(teamDetail?.members ?? []).some(
                        (tm) => tm.membership_id === om.membership_id
                      )
                  )
                  .map((m) => (
                    <option key={m.membership_id} value={m.membership_id}>
                      {m.first_name || ""} {m.last_name || ""} ({m.email})
                    </option>
                  ))}
              </select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddMemberDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addMemberMutation.isPending}>
                {addMemberMutation.isPending ? "Adding..." : "Add to Team"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
