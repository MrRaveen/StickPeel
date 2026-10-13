import {
  Link,
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, LogIn, Mail } from "lucide-react";
import { login } from "@/api/endpoints/auth/auth";
import { ApiError } from "@/lib/api-client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

function getSafeNext(next?: string): string | null {
  if (!next) {
    return null;
  }
  const trimmed = next.trim();
  // Accept only relative paths starting with /accept-invite, blocking open redirects
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

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const search = useSearch({ strict: false }) as { next?: string };
  const nextParam =
    search?.next ||
    (typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("next") ?? undefined)
      : undefined);
  const safeNext = getSafeNext(nextParam);
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // As a backup, keep token in sessionStorage (inside try/catch)
  useEffect(() => {
    if (safeNext) {
      try {
        const url = new URL(safeNext, "http://localhost");
        const token = url.searchParams.get("token");
        if (token && token.trim().length === 43) {
          sessionStorage.setItem("pending_invite_token", token.trim());
        }
      } catch {}
    }
  }, [safeNext]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  const loginMutation = useMutation({
    mutationFn: (data: LoginFormData) => login(data),
    onSuccess: () => {
      setLoginError("");
      queryClient.clear();
      const validNext = safeNext;
      if (validNext) {
        let tokenParam: string | undefined;
        try {
          const url = new URL(validNext, "http://localhost");
          tokenParam = url.searchParams.get("token") || undefined;
        } catch {}
        navigate({
          to: "/accept-invite",
          search: tokenParam ? { token: tokenParam } : {},
        });
        return;
      }
      const storedToken = getStoredInviteToken();
      if (storedToken) {
        navigate({
          to: "/accept-invite",
          search: { token: storedToken },
        });
        return;
      }
      navigate({ to: "/" });
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) {
        setLoginError(
          "Network error. Please check your connection and try again."
        );
        return;
      }

      if (error.status === 401) {
        setLoginError("Incorrect email or password.");
      } else if (error.status === 422) {
        setLoginError("Please check your credentials and try again.");
      } else {
        setLoginError("Login failed. Please try again.");
      }
    },
  });

  const onSubmit = (data: LoginFormData) => {
    setLoginError("");
    loginMutation.mutate(data);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-6 text-center">
          <a
            href="http://localhost:3000"
            title="Go to StickPeel Landing Page"
            className="transition-opacity hover:opacity-80"
          >
            <Logo className="h-9" />
          </a>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in to your StickPeel workspace.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-background p-6 shadow-sm">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          className="h-11 pl-9"
                          autoComplete="email"
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
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Password"
                          className="h-11 pl-9 pr-9"
                          autoComplete="current-password"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          disabled={!field.value?.length}
                          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
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

              {loginError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
                  {loginError}
                </div>
              )}

              <Button
                type="submit"
                className="h-11 w-full cursor-pointer text-sm font-medium"
                disabled={loginMutation.isPending || !form.formState.isValid}
              >
                <LogIn className="size-4" />
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>

          <div className="mt-5 border-t pt-4 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            {(() => {
              const targetNext =
                safeNext ||
                (getStoredInviteToken()
                  ? `/accept-invite?token=${getStoredInviteToken()}`
                  : undefined);
              return (
                <Link
                  to="/signup"
                  search={targetNext ? { next: targetNext } : undefined}
                  className="font-medium text-primary hover:underline cursor-pointer"
                >
                  Create an account
                </Link>
              );
            })()}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Trouble signing in? Contact your team lead or administrator.
        </p>
      </div>
    </div>
  );
}
