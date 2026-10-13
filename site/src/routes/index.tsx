import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarCheck,
  Shield,
  Server,
  Sparkles,
  Users,
  CheckCircle2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Logo, Logomark } from "@/components/logo";

export const Route = createFileRoute("/")({ component: Home });

const APPS = [
  {
    name: "Customer App",
    tagline: "Weekly Planning & Team Commitments",
    description:
      "For engineers and team leads. Draft weekly plans, utilize AI review and assistance, submit for review, and track shipped deliverables.",
    href: "http://localhost:3001",
    badge: "Port :3001",
    badgeVariant: "secondary" as const,
    icon: CalendarCheck,
    accentBorder: "hover:border-sky-500/50 hover:shadow-sky-500/10",
    buttonVariant: "default" as const,
    features: [
      "AI-assisted plan drafting & review",
      "Lead approval & feedback workflows",
      "Multi-tenant organization isolation",
    ],
  },
  {
    name: "Internal Staff Console",
    tagline: "Platform Administration & Oversight",
    description:
      "Restricted portal for platform staff. Monitor tenant activity, manage organizations and users, and inspect AI usage metadata.",
    href: "http://localhost:3002",
    badge: "Port :3002 · Staff Only",
    badgeVariant: "outline" as const,
    icon: Shield,
    accentBorder: "hover:border-amber-500/50 hover:shadow-amber-500/10",
    buttonVariant: "secondary" as const,
    features: [
      "Organization lifecycle & suspend actions",
      "Platform user & staff management",
      "AI token usage & audit log inspection",
    ],
  },
  {
    name: "FastAPI Backend & Docs",
    tagline: "Interactive API Documentation",
    description:
      "Explore OpenAPI schemas, execute test calls against customer (/app) and internal (/internal) surfaces, and view health status.",
    href: "http://localhost:8000/docs",
    badge: "Port :8000 · OpenAPI",
    badgeVariant: "outline" as const,
    icon: Server,
    accentBorder: "hover:border-emerald-500/50 hover:shadow-emerald-500/10",
    buttonVariant: "outline" as const,
    features: [
      "Interactive Swagger UI documentation",
      "Async SQLAlchemy & Postgres backend",
      "Strict multi-tenant security enforcement",
    ],
  },
];

function Home() {
  return (
    <div className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-background text-foreground antialiased selection:bg-sky-500/20">
      {/* Decorative gradient glow & grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] [mask-image:radial-gradient(ellipse_60%_100%_at_50%_0%,black,transparent)]"
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-50" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-96 w-[700px] -translate-x-1/2 rounded-full bg-sky-500/15 blur-3xl dark:bg-sky-500/10"
      />

      {/* Main Container */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-6 pt-16 pb-20">
        {/* Header / Brand Lockup */}
        <div className="flex flex-col items-center gap-5 text-center">
          <Logo className="h-12 scale-110" />

          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3.5 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400">
            <Sparkles className="size-3.5" />
            <span>Multi-Tenant Weekly Planning Platform</span>
          </div>

          <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-balance">
            Ship one significant outcome every Friday.{" "}
            <span className="text-sky-600 dark:text-sky-400">Carry nothing</span>{" "}
            into Monday.
          </h1>

          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg text-balance">
            Welcome to the StickPeel unified hub. Select an application below to
            launch the customer workspace, access administrative operations, or
            inspect the backend API.
          </p>
        </div>

        {/* 3 Apps Cards Grid */}
        <div className="mt-14 grid w-full gap-6 md:grid-cols-3">
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <Card
                key={app.name}
                className={`relative flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${app.accentBorder} bg-card/90 backdrop-blur-sm border-border/80`}
              >
                <CardHeader className="space-y-3 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                      <Icon className="size-5" />
                    </div>
                    <Badge variant={app.badgeVariant} className="font-mono text-[11px]">
                      {app.badge}
                    </Badge>
                  </div>
                  <div>
                    <CardTitle className="text-xl font-bold tracking-tight">
                      {app.name}
                    </CardTitle>
                    <p className="text-xs font-medium text-sky-600 dark:text-sky-400 mt-0.5">
                      {app.tagline}
                    </p>
                  </div>
                  <CardDescription className="text-sm leading-relaxed text-muted-foreground">
                    {app.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-2 py-2">
                  <div className="space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    {app.features.map((feat) => (
                      <div key={feat} className="flex items-center gap-2">
                        <CheckCircle2 className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>

                <CardFooter className="pt-4 pb-5">
                  <a
                    href={app.href}
                    className={`w-full ${buttonVariants({
                      variant: app.buttonVariant,
                      size: "lg",
                    })} justify-between shadow-xs font-semibold`}
                  >
                    <span>Launch {app.name}</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </a>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Quick Links & Credentials notice */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-border/60 bg-muted/40 px-6 py-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-sky-600 dark:text-sky-400" />
            <span>
              <strong>Demo Logins:</strong> Seeded accounts available in{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                SUBMISSION.md
              </code>
            </span>
          </div>
          <span className="hidden sm:inline text-border">•</span>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-amber-500" />
            <span>
              <strong>Staff Console:</strong> Use staff credentials to sign in
            </span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-muted/20 py-6 text-center text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Logomark className="size-4" />
            <span className="font-semibold text-foreground">StickPeel</span>
            <span>— Weekly Planning SaaS</span>
          </div>
          <p>© 2026 StickPeel. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

