import { useEffect, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  LogOut,
  LogIn,
  UserPlus,
  Loader2,
  Shield,
  Clock,
} from "lucide-react";
import {
  useGetPublicInvitation,
  useAcceptInvitation,
} from "@/api/endpoints/invitations/invitations";
import { useGetCurrentUser } from "@/api/endpoints/users/users";
import { useListMemberOrgs } from "@/api/endpoints/orgs/orgs";
import { logout } from "@/api/endpoints/auth/auth";
import { ApiError } from "@/lib/api-client";
import { Logo } from "@/components/Logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/accept-invite")({
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const search = useSearch({ strict: false }) as { token?: string };
  const queryClient = useQueryClient();
  const saveActiveOrg = (orgId?: string) => {
    if (orgId && typeof window !== "undefined") {
      try {
        localStorage.setItem("stickpeel_active_org_id", orgId);
      } catch {}
    }
  };

  // Resolve token once on mount: from search param, URL query string, or sessionStorage fallback
  const [token] = useState<string>(() => {
    let t = search?.token?.trim();
    if (!t || t.length !== 43) {
      if (typeof window !== "undefined") {
        try {
          const urlParam = new URLSearchParams(window.location.search)
            .get("token")
            ?.trim();
          if (urlParam && urlParam.length === 43) {
            t = urlParam;
          } else {
            const stored = sessionStorage
              .getItem("pending_invite_token")
              ?.trim();
            if (stored && stored.length === 43) {
              t = stored;
            }
          }
        } catch {}
      }
    }
    return t || "";
  });

  // Keep token stored in sessionStorage and strip it from the URL
  useEffect(() => {
    if (token && token.length === 43) {
      try {
        sessionStorage.setItem("pending_invite_token", token);
      } catch {}
      // Strip token from browser address bar to prevent leaking
      if (typeof window !== "undefined" && window.history) {
        window.history.replaceState({}, "", "/accept-invite");
      }
    }
  }, [token]);

  // Set Referrer-Policy to no-referrer on this page
  useEffect(() => {
    let meta = document.querySelector('meta[name="referrer"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "referrer");
      meta.setAttribute("content", "no-referrer");
      document.head.appendChild(meta);
    } else {
      meta.setAttribute("content", "no-referrer");
    }
  }, []);

  // Fetch public invitation
  const {
    data: invite,
    isLoading: isLoadingInvite,
    error: inviteError,
  } = useGetPublicInvitation(token, {
    query: {
      enabled: Boolean(token && token.length === 43),
      retry: false,
    },
  });

  // Fetch current user (if logged in)
  const { data: currentUser, isLoading: isLoadingUser } = useGetCurrentUser({
    query: {
      retry: false,
    },
  });

  // Fetch current memberships (to recognize already joined members)
  const { data: memberOrgs = [] } = useListMemberOrgs({
    query: {
      enabled: Boolean(currentUser),
      retry: false,
    },
  });

  // Logout mutation for "Use a different account"
  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logout();
      queryClient.clear();
      window.location.href = token
        ? `/accept-invite?token=${token}`
        : "/accept-invite";
    },
  });

  const [acceptError, setAcceptError] = useState<{
    code?: string;
    message: string;
    orgId?: string;
  } | null>(null);

  // Accept mutation
  const acceptMutation = useAcceptInvitation({
    mutation: {
      onSuccess: async (data) => {
        saveActiveOrg(data.organization.id);
        try {
          sessionStorage.removeItem("pending_invite_token");
        } catch {}
        // Navigate cleanly and immediately to dashboard
        window.location.href = "/dashboard";
      },
      onError: (err: unknown) => {
        let code: string | undefined;
        let message = "Failed to accept invitation.";
        let orgId: string | undefined;

        if (
          err instanceof ApiError &&
          err.data &&
          typeof err.data === "object"
        ) {
          const apiData = err.data as {
            code?: string;
            message?: string;
            extra?: { organization_id?: string };
          };
          code = apiData.code;
          message = apiData.message || message;
          orgId = apiData.extra?.organization_id;
        } else if (err instanceof Error) {
          message = err.message;
        }

        setAcceptError({
          code,
          message,
          orgId,
        });
      },
    },
  });

  const handleAccept = () => {
    if (!token || token.length !== 43) {
      return;
    }
    setAcceptError(null);
    acceptMutation.mutate({ token });
  };

  const handleUseDifferentAccount = () => {
    logoutMutation.mutate();
  };

  // State 1: No valid token found
  if (!token || token.length !== 43) {
    if (currentUser && memberOrgs.length > 0) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
          <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="size-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight">
                Signed In to StickPeel
              </h1>
              <p className="text-sm text-muted-foreground">
                You are currently signed in as{" "}
                <span className="font-semibold text-foreground">
                  {currentUser.email}
                </span>
                .
              </p>
            </div>
            <div className="pt-2">
              <Button
                className="w-full cursor-pointer"
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
              >
                Go to Dashboard
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">
              Invalid Invitation Link
            </h1>
            <p className="text-sm text-muted-foreground">
              No valid invitation token was detected. Please check the link sent
              by your team administrator.
            </p>
          </div>
          <div className="pt-2">
            <Link
              to="/login"
              className={cn(
                buttonVariants({ variant: "default" }),
                "w-full cursor-pointer"
              )}
            >
              Go to Sign In
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // State 2: Loading invitation details
  if (isLoadingInvite || isLoadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-4 shadow-sm">
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Verifying your invitation...
          </p>
        </Card>
      </div>
    );
  }

  // State 3: Invitation is invalid, expired, or already accepted
  if (inviteError || !invite) {
    if (currentUser && memberOrgs.length > 0) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
          <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="size-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight">
                Already Joined Workspace
              </h1>
              <p className="text-sm text-muted-foreground">
                This invitation is already processed or you are already a
                member. You are currently signed in as{" "}
                <span className="font-semibold text-foreground">
                  {currentUser.email}
                </span>
                .
              </p>
            </div>
            <div className="pt-2">
              <Button
                className="w-full cursor-pointer"
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
              >
                Go to Dashboard
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">
              Invitation Invalid or Expired
            </h1>
            <p className="text-sm text-muted-foreground">
              This invitation is invalid or has expired. Ask the person who
              invited you for a new link.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Link
              to="/login"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "w-full cursor-pointer"
              )}
            >
              Sign In
            </Link>
            <Link
              to="/"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full cursor-pointer"
              )}
            >
              Back to Home
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // State 5: Already member error
  if (acceptError && acceptError.code === "already_member") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="size-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">
              Already a Member
            </h1>
            <p className="text-sm text-muted-foreground">
              You are already a member of {invite.organization_name}.
            </p>
          </div>
          <div className="pt-2">
            <Button
              className="w-full cursor-pointer"
              onClick={() => {
                if (acceptError.orgId) {
                  saveActiveOrg(acceptError.orgId);
                }
                window.location.href = "/dashboard";
              }}
            >
              Open Workspace
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // State 6: Valid invitation ready for login / signup or accept
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <a
            href="http://localhost:3000"
            title="Go to StickPeel Landing Page"
            className="transition-opacity hover:opacity-80"
          >
            <Logo className="h-9" />
          </a>
        </div>

        <Card className="p-6 sm:p-8 space-y-6 shadow-sm">
          {/* Org Header */}
          <div className="flex flex-col items-center text-center gap-3">
            {invite.organization_logo_url ? (
              <img
                src={invite.organization_logo_url}
                alt={invite.organization_name}
                className="size-16 rounded-xl object-cover border"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="size-7" />
              </div>
            )}
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                Join {invite.organization_name}
              </h1>
              <p className="text-sm text-muted-foreground">
                You have been invited to join as an{" "}
                <span className="font-semibold text-foreground capitalize">
                  {invite.role_name}
                </span>
                .
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1 font-normal">
                <Shield className="size-3 text-primary" />
                Role: {invite.role_name}
              </Badge>
              <Badge variant="secondary" className="gap-1 font-normal">
                <Clock className="size-3" />
                Invited as {invite.masked_email}
              </Badge>
            </div>
          </div>

          {acceptError && (
            <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{acceptError.message}</span>
            </div>
          )}

          {/* Action Branch */}
          {currentUser ? (
            // User is logged in
            <div className="space-y-4 pt-2 border-t">
              <div className="rounded-lg bg-muted/50 p-3 text-center space-y-1">
                <p className="text-xs text-muted-foreground">Logged in as</p>
                <p className="text-sm font-medium">{currentUser.email}</p>
              </div>

              <Button
                className="w-full gap-2 shadow-xs cursor-pointer"
                size="lg"
                onClick={handleAccept}
                disabled={acceptMutation.isPending}
              >
                {acceptMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  <>
                    Accept Invitation
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleUseDifferentAccount}
                  disabled={logoutMutation.isPending}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="size-3" />
                  {logoutMutation.isPending
                    ? "Signing out..."
                    : "Use a different account"}
                </button>
              </div>
            </div>
          ) : (
            // User is not logged in
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs text-center text-muted-foreground">
                Sign in with an existing account or create a new one to accept
                this invitation.
              </p>

              <Link
                to="/login"
                search={{ next: `/accept-invite?token=${token}` }}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "w-full gap-2 shadow-xs cursor-pointer"
                )}
              >
                <LogIn className="size-4" />
                Log In
              </Link>

              <Link
                to="/signup"
                search={{ next: `/accept-invite?token=${token}` }}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "w-full gap-2 cursor-pointer"
                )}
              >
                <UserPlus className="size-4" />
                Sign Up
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
