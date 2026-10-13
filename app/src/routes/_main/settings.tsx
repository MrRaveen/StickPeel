import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  LogOut,
  AlertTriangle,
  ArrowRightLeft,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useActiveOrg } from "@/contexts/org-context";
import {
  useUpdateOrg,
  useLeaveOrg,
  useTransferOwnership,
  useDeleteOrg,
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

export const Route = createFileRoute("/_main/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const {
    activeOrgId,
    activeOrg,
    activeMembership,
    hasPermission,
    refetchOrgs,
  } = useActiveOrg();

  const canEditSettings = hasPermission("org.settings");
  const canTransfer = hasPermission("org.transfer");
  const canDelete = hasPermission("org.delete");

  const [syncedOrgId, setSyncedOrgId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  if (activeOrg && activeOrg.id !== syncedOrgId) {
    setSyncedOrgId(activeOrg.id);
    setName(activeOrg.name);
    setAddress(activeOrg.address || "");
    setLogoUrl(activeOrg.logo_url || "");
  }

  // Dialog states
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [newOwnerMemberId, setNewOwnerMemberId] = useState("");
  const [confirmDeleteName, setConfirmDeleteName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Queries
  const { data: membersData, refetch: refetchTransferMembers } =
    useListOrgMembers(
      activeOrgId ?? "",
      { page: 1, page_size: 100 },
      {
        query: {
          enabled: Boolean(activeOrgId && transferDialogOpen),
          staleTime: 0,
        },
      }
    );
  const members = membersData?.items ?? [];

  // Mutations
  const updateOrgMutation = useUpdateOrg({
    mutation: {
      onSuccess: () => {
        refetchOrgs();
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setSettingsError(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to update settings"
        );
      },
    },
  });

  const leaveOrgMutation = useLeaveOrg({
    mutation: {
      onSuccess: () => {
        refetchOrgs();
        setLeaveDialogOpen(false);
        navigate({ to: "/dashboard" });
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setActionError(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to leave"
        );
      },
    },
  });

  const transferOwnershipMutation = useTransferOwnership({
    mutation: {
      onSuccess: () => {
        refetchOrgs();
        setTransferDialogOpen(false);
        setActionError(null);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setActionError(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to transfer ownership"
        );
      },
    },
  });

  const deleteOrgMutation = useDeleteOrg({
    mutation: {
      onSuccess: () => {
        refetchOrgs();
        setDeleteDialogOpen(false);
        navigate({ to: "/dashboard" });
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setActionError(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to delete organization"
        );
      },
    },
  });

  const handleSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !name.trim()) {
      return;
    }
    setSettingsError(null);
    updateOrgMutation.mutate({
      orgId: activeOrgId,
      data: {
        name: name.trim(),
        address: address.trim() || null,
        logo_url: logoUrl.trim() || null,
      },
    });
  };

  if (!activeOrgId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
        <Building2 className="size-10 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No Organization Selected</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Select an organization to manage its settings.
        </p>
      </div>
    );
  }

  const roleName =
    activeOrg?.my_role || activeMembership?.org_info.role_name || "member";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Organization Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Workspace preferences, member delegation, and management controls.
        </p>
      </div>

      {/* General Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>General Information</CardTitle>
          <CardDescription>
            Update your organization name, branding logo, and contact details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSettingsSubmit} className="space-y-4">
            {settingsError && (
              <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
                {settingsError}
              </div>
            )}
            {settingsSaved && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/15 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                <span>Organization settings updated successfully.</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="settings-name">Organization Name</Label>
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={!canEditSettings || updateOrgMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-address">Address</Label>
              <Input
                id="settings-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="HQ street address or location"
                disabled={!canEditSettings || updateOrgMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-logo">Logo URL</Label>
              <Input
                id="settings-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.svg"
                disabled={!canEditSettings || updateOrgMutation.isPending}
              />
            </div>

            {canEditSettings && (
              <Button type="submit" disabled={updateOrgMutation.isPending}>
                {updateOrgMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Membership & Role Card */}
      <Card>
        <CardHeader>
          <CardTitle>Your Membership</CardTitle>
          <CardDescription>
            You are currently enrolled in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Current Role</p>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                variant="outline"
                className="capitalize text-xs font-semibold"
              >
                {roleName}
              </Badge>
              {activeOrg?.is_suspended && (
                <Badge variant="destructive" className="text-xs">
                  Organization Suspended
                </Badge>
              )}
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setActionError(null);
              setLeaveDialogOpen(true);
            }}
            className="gap-2 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="size-4" />
            <span>Leave Organization</span>
          </Button>
        </CardContent>
      </Card>

      {/* Transfer Ownership Card (Owner Only) */}
      {canTransfer && (
        <Card>
          <CardHeader>
            <CardTitle>Transfer Ownership</CardTitle>
            <CardDescription>
              Transfer the owner role to another active member. You will become
              an Admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                setNewOwnerMemberId("");
                setActionError(null);
                setTransferDialogOpen(true);
                refetchTransferMembers();
              }}
              className="gap-2"
            >
              <ArrowRightLeft className="size-4" />
              <span>Transfer Ownership</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone (Owner Only) */}
      {canDelete && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="size-5" /> Danger Zone
            </CardTitle>
            <CardDescription>
              Permanently delete this organization, including all teams,
              members, and plans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDeleteName("");
                setActionError(null);
                setDeleteDialogOpen(true);
              }}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              <span>Delete Organization</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Leave Organization Dialog */}
      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave Organization</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave {activeOrg?.name}? Your access will
              be removed.
            </DialogDescription>
          </DialogHeader>

          {actionError && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
              {actionError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (activeOrgId) {
                  leaveOrgMutation.mutate({ orgId: activeOrgId });
                }
              }}
              disabled={leaveOrgMutation.isPending}
            >
              {leaveOrgMutation.isPending ? "Leaving..." : "Leave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Ownership</DialogTitle>
            <DialogDescription>
              Select an active member who will take over as the owner of{" "}
              {activeOrg?.name}.
            </DialogDescription>
          </DialogHeader>

          {actionError && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
              {actionError}
            </div>
          )}

          <div className="space-y-2 py-2">
            <Label htmlFor="transfer-target">New Owner</Label>
            <select
              id="transfer-target"
              value={newOwnerMemberId}
              onChange={(e) => setNewOwnerMemberId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a member...</option>
              {members
                .filter(
                  (m) =>
                    m.status === "active" &&
                    m.membership_id !==
                      activeMembership?.membership?.membership_id
                )
                .map((m) => (
                  <option key={m.membership_id} value={m.membership_id}>
                    {m.first_name || ""} {m.last_name || ""} ({m.email}) —{" "}
                    {m.role}
                  </option>
                ))}
            </select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !newOwnerMemberId || transferOwnershipMutation.isPending
              }
              onClick={() => {
                if (activeOrgId && newOwnerMemberId) {
                  transferOwnershipMutation.mutate({
                    orgId: activeOrgId,
                    data: { new_owner_member_id: newOwnerMemberId },
                  });
                }
              }}
            >
              {transferOwnershipMutation.isPending
                ? "Transferring..."
                : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Organization Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Delete Organization
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. To confirm, type{" "}
              <strong className="text-foreground">{activeOrg?.name}</strong>{" "}
              below:
            </DialogDescription>
          </DialogHeader>

          {actionError && (
            <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
              {actionError}
            </div>
          )}

          <div className="space-y-2 py-2">
            <Label htmlFor="delete-confirm">Organization Name</Label>
            <Input
              id="delete-confirm"
              placeholder={activeOrg?.name}
              value={confirmDeleteName}
              onChange={(e) => setConfirmDeleteName(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                confirmDeleteName !== activeOrg?.name ||
                deleteOrgMutation.isPending
              }
              onClick={() => {
                if (activeOrgId) {
                  deleteOrgMutation.mutate({
                    orgId: activeOrgId,
                    data: { confirm_name: confirmDeleteName },
                  });
                }
              }}
            >
              {deleteOrgMutation.isPending
                ? "Deleting..."
                : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
