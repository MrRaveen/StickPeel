import { useState } from "react";
import { Building2, Check, ChevronsUpDown, PlusCircle } from "lucide-react";
import { useActiveOrg, isMembershipSuspended } from "@/contexts/org-context";
import { useCreateOrg } from "@/api/endpoints/orgs/orgs";
import { cn } from "@/lib/utils";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function OrgSwitcher() {
  const {
    organizations,
    activeOrgId,
    activeMembership,
    activeOrg,
    setActiveOrgId,
    refetchOrgs,
  } = useActiveOrg();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createOrgMutation = useCreateOrg({
    mutation: {
      onSuccess: (data) => {
        refetchOrgs();
        setActiveOrgId(data.id);
        setCreateDialogOpen(false);
        setName("");
        setAddress("");
        setLogoUrl("");
        setCreateError(null);
      },
      onError: (err: unknown) => {
        const errorObj = err as {
          response?: { data?: { message?: string } };
          message?: string;
        };
        setCreateError(
          errorObj?.response?.data?.message ||
            errorObj?.message ||
            "Failed to create organization"
        );
      },
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      return;
    }
    setCreateError(null);
    createOrgMutation.mutate({
      data: {
        name: name.trim(),
        address: address.trim() || null,
        logo_url: logoUrl.trim() || null,
      },
    });
  };

  const currentRole =
    activeMembership?.org_info.role_name || activeOrg?.my_role || "member";
  const isSuspended =
    activeOrg?.is_suspended || activeMembership?.org_info.is_suspended;

  return (
    <>
      <div className="px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-lg border bg-card p-2 text-left text-sm font-medium shadow-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold leading-tight text-foreground">
                  {activeOrg?.name ||
                    activeMembership?.org_info.org_name ||
                    "Select Organization"}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[10px] uppercase tracking-wider font-semibold"
                  >
                    {currentRole}
                  </Badge>
                  {isSuspended && (
                    <Badge
                      variant="destructive"
                      className="h-4 px-1 text-[10px]"
                    >
                      Suspended
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {organizations.map((org) => {
                const isSelected = org.org_info.org_id === activeOrgId;
                const isOrgSuspended = isMembershipSuspended(org);
                return (
                  <DropdownMenuItem
                    key={org.org_info.org_id}
                    disabled={isOrgSuspended}
                    onClick={(e) => {
                      if (isOrgSuspended) {
                        e.preventDefault();
                        return;
                      }
                      setActiveOrgId(org.org_info.org_id);
                    }}
                    className={cn(
                      "flex items-center justify-between",
                      isOrgSuspended
                        ? "opacity-60 cursor-not-allowed select-none bg-muted/20 text-muted-foreground pointer-events-none"
                        : "cursor-pointer"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <span
                        className={cn(
                          "truncate text-sm font-medium",
                          isOrgSuspended &&
                            "text-muted-foreground line-through decoration-muted-foreground/40"
                        )}
                      >
                        {org.org_info.org_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isOrgSuspended ? (
                        <Badge
                          variant="destructive"
                          className="h-4 px-1 text-[9px] uppercase font-bold tracking-wider"
                        >
                          Suspended
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {org.org_info.role_name}
                        </span>
                      )}
                      {isSelected && !isOrgSuspended && (
                        <Check className="size-3.5 text-primary" />
                      )}
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setCreateError(null);
                setCreateDialogOpen(true);
              }}
              className="cursor-pointer text-primary focus:text-primary"
            >
              <PlusCircle className="size-4 mr-2" />
              <span>Create Organization</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Start a new organization workspace. You will be set as the Owner.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {createError && (
              <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
                {createError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                placeholder="e.g. Acme Corp"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={createOrgMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-address">Address (optional)</Label>
              <Input
                id="org-address"
                placeholder="e.g. 100 Innovation Way"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={createOrgMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-logo">Logo URL (optional)</Label>
              <Input
                id="org-logo"
                placeholder="https://example.com/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                disabled={createOrgMutation.isPending}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createOrgMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || createOrgMutation.isPending}
              >
                {createOrgMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
