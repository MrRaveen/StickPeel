import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AuthGuard } from "@/components/AuthGuard";
import {
  OrgProvider,
  useActiveOrg,
  isMembershipSuspended,
} from "@/contexts/org-context";
import { Sidebar } from "@/components/dashboard/sidebar";
import { ShieldAlert, ArrowRight, Building2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import FullScreenLoader from "@/components/FullScreenLoader";

// Pathless layout route: every route file under `src/routes/_main/` renders
// inside this chrome and behind the auth guard, without `_main` appearing in
// the URL. Public pages (e.g. /login) live outside it.
export const Route = createFileRoute("/_main")({ component: MainLayout });

function MainLayout() {
  return (
    <AuthGuard>
      <OrgProvider>
        <div className="flex h-screen overflow-hidden bg-muted/40">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
              <MainContent />
            </div>
          </main>
        </div>
      </OrgProvider>
    </AuthGuard>
  );
}

function MainContent() {
  const {
    isOrgSuspended,
    activeOrg,
    activeMembership,
    organizations,
    setActiveOrgId,
    isLoadingOrgs,
  } = useActiveOrg();

  if (isLoadingOrgs) {
    return (
      <div className="flex h-96 items-center justify-center">
        <FullScreenLoader />
      </div>
    );
  }

  // If user belongs to no organizations yet
  if (organizations.length === 0) {
    return (
      <Card className="mx-auto max-w-lg border-dashed text-center p-8 mt-12 shadow-sm">
        <CardHeader className="flex flex-col items-center pb-2">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
            <Building2 className="size-7" />
          </div>
          <CardTitle className="text-xl">No Organizations Found</CardTitle>
          <CardDescription>
            You are not currently a member of any organization. Create a new
            organization to start planning.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // If the active organization is suspended, completely block access to all routes
  if (isOrgSuspended) {
    const orgName =
      activeOrg?.name ||
      activeMembership?.org_info.org_name ||
      "This organization";

    const nonSuspendedOrgs = organizations.filter(
      (m) => !isMembershipSuspended(m)
    );
    const firstActiveOrg = nonSuspendedOrgs[0];

    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <Card className="w-full max-w-lg border-destructive/20 bg-background shadow-lg">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-8 ring-destructive/5">
              <ShieldAlert className="size-7" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                Organization Suspended
              </CardTitle>
              <Badge
                variant="destructive"
                className="uppercase font-bold tracking-wider text-[10px]"
              >
                Access Blocked
              </Badge>
            </div>
            <CardDescription className="text-sm mt-2">
              The organization{" "}
              <span className="font-semibold text-foreground">"{orgName}"</span>{" "}
              has been suspended by platform administration.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 text-center text-sm text-muted-foreground pt-0">
            <p className="rounded-lg bg-muted/60 p-4 text-xs leading-relaxed border">
              All weekly plans, team assignments, approvals, and organization
              settings are disabled. You cannot proceed with operations for this
              organization until it is reinstated.
            </p>

            {firstActiveOrg && (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  You have access to active organizations:
                </p>
                <Button
                  className="w-full gap-2 font-medium"
                  onClick={() => setActiveOrgId(firstActiveOrg.org_info.org_id)}
                >
                  <Building2 className="size-4" />
                  <span>Switch to {firstActiveOrg.org_info.org_name}</span>
                  <ArrowRight className="size-4 ml-auto" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}
