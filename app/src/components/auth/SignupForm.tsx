import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, Mail, User, UserPlus } from "lucide-react";
import { createAccount, login } from "@/api/endpoints/auth/auth";
import { useGetPublicInvitation } from "@/api/endpoints/invitations/invitations";
import { ApiError } from "@/lib/api-client";
import { Logo } from "@/components/Logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const signupSchema = z
  .object({
    first_name: z
      .string()
      .trim()
      .min(1, "First name is required")
      .max(255, "First name is too long"),
    last_name: z
      .string()
      .trim()
      .min(1, "Last name is required")
      .max(255, "Last name is too long"),
    email: z
      .string()
      .trim()
      .min(1, "Email is required")
      .email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupFormData = z.infer<typeof signupSchema>;

function getSafeNext(next?: string): string | null {
  if (!next) {
    return null;
  }
  const trimmed = next.trim();
  // Accept only relative paths starting with /accept-invite
  if (
    trimmed.startsWith("/accept-invite") &&
    !trimmed.startsWith("//") &&
    !trimmed.includes("://")
  ) {
    return trimmed;
  }
  return null;
}

function getStoredInviteToken(): string | null {
  try {
    const token = sessionStorage.getItem("pending_invite_token");
    if (token && token.trim().length === 43) {
      return token.trim();
    }
  } catch {}
  return null;
}

export function SignupForm() {
  const search = useSearch({ strict: false }) as { next?: string };
  const safeNext = getSafeNext(search?.next);

  const [signupError, setSignupError] = useState("");
  const [isConflict, setIsConflict] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const inviteToken = useMemo(() => {
    if (safeNext) {
      try {
        const url = new URL(safeNext, "http://localhost");
        const t = url.searchParams.get("token");
        if (t && t.trim().length === 43) {
          return t.trim();
        }
      } catch {}
    }
    return getStoredInviteToken();
  }, [safeNext]);

  // Keep token stored in sessionStorage
  useEffect(() => {
    if (inviteToken) {
      try {
        sessionStorage.setItem("pending_invite_token", inviteToken);
      } catch {}
    }
  }, [inviteToken]);

  // Fetch public invitation if token exists to show masked email hint
  const { data: publicInvite } = useGetPublicInvitation(inviteToken ?? "", {
    query: {
      enabled: Boolean(inviteToken && inviteToken.length === 43),
      retry: false,
    },
  });

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    mode: "onTouched",
  });

  // Force email to invitation's specified email address
  useEffect(() => {
    if (publicInvite?.email) {
      form.setValue("email", publicInvite.email);
    }
  }, [publicInvite?.email, form]);

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      // 1. Create customer account (forces is_admin=False)
      await createAccount({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        password: data.password,
      });

      // 2. Automatically log in to start authenticated customer session
      const loginResponse = await login({
        email: data.email,
        password: data.password,
      });

      return loginResponse;
    },
    onSuccess: async () => {
      // Refresh current user and navigate
      await queryClient.invalidateQueries({ queryKey: ["/app/users/self"] });
      if (safeNext) {
        let tokenParam: string | undefined;
        try {
          const url = new URL(safeNext, "http://localhost");
          tokenParam = url.searchParams.get("token") || undefined;
        } catch {}
        navigate({
          to: "/accept-invite",
          search: tokenParam ? { token: tokenParam } : undefined,
        });
        return;
      }
      const stored = getStoredInviteToken();
      if (stored) {
        navigate({
          to: "/accept-invite",
          search: { token: stored },
        });
        return;
      }
      navigate({ to: "/dashboard" });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setIsConflict(true);
          setSignupError("An account with this email address already exists.");
        } else {
          setIsConflict(false);
          setSignupError(
            error.message || "Failed to create account. Please try again."
          );
        }
      } else {
        setIsConflict(false);
        setSignupError("An unexpected error occurred. Please try again.");
      }
    },
  });

  const onSubmit = (data: SignupFormData) => {
    setSignupError("");
    setIsConflict(false);
    const finalData = {
      ...data,
      email: publicInvite?.email || data.email,
    };
    signupMutation.mutate(finalData);
  };

  const targetNext =
    safeNext ||
    (inviteToken ? `/accept-invite?token=${inviteToken}` : undefined);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <a
            href="http://localhost:3000"
            title="Go to StickPeel Landing Page"
            className="transition-opacity hover:opacity-80 mb-4 inline-block"
          >
            <Logo className="h-10" />
          </a>
          <h1 className="text-2xl font-bold tracking-tight">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get started with StickPeel for your team's weekly commitments
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-xs">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Alex"
                            className="pl-9"
                            autoComplete="given-name"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Chen"
                            className="pl-9"
                            autoComplete="family-name"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {publicInvite?.email ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center text-xs text-muted-foreground">
                  Invited as{" "}
                  <span className="font-semibold text-foreground">
                    {publicInvite.email}
                  </span>
                  <span className="block mt-0.5 text-[11px] text-muted-foreground/80">
                    Account creation is locked to the email address specified by
                    your organization.
                  </span>
                </div>
              ) : publicInvite?.masked_email ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center text-xs text-muted-foreground">
                  Invited as{" "}
                  <span className="font-semibold text-foreground">
                    {publicInvite.masked_email}
                  </span>
                </div>
              ) : null}

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Email</FormLabel>
                      {publicInvite?.email && (
                        <span className="text-[11px] font-medium text-primary inline-flex items-center gap-1">
                          <Lock className="size-3" />
                          Locked by invitation
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="alex@example.com"
                          className={cn(
                            "pl-9",
                            publicInvite?.email &&
                              "bg-muted/70 cursor-not-allowed font-medium text-foreground opacity-90 select-none"
                          )}
                          readOnly={Boolean(publicInvite?.email)}
                          autoComplete="email"
                          {...field}
                          value={publicInvite?.email || field.value}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="At least 8 characters"
                          className="pr-10 pl-9"
                          autoComplete="new-password"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Repeat your password"
                          className="pr-10 pl-9"
                          autoComplete="new-password"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowConfirmPassword(!showConfirmPassword)
                          }
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {signupError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive space-y-2">
                  <p>{signupError}</p>
                  {isConflict && (
                    <div className="pt-1">
                      <Link
                        to="/login"
                        search={targetNext ? { next: targetNext } : undefined}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "h-8 text-xs cursor-pointer"
                        )}
                      >
                        Log in instead
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="h-11 w-full cursor-pointer text-sm font-medium"
                disabled={signupMutation.isPending || !form.formState.isValid}
              >
                <UserPlus className="size-4" />
                {signupMutation.isPending
                  ? "Creating account..."
                  : "Create account"}
              </Button>
            </form>
          </Form>

          <div className="mt-5 border-t pt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              search={targetNext ? { next: targetNext } : undefined}
              className="font-medium text-primary hover:underline cursor-pointer"
            >
              Sign in
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By registering, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}
