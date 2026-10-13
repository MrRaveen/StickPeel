import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Shield,
  Sparkles,
  Users,
  CheckCircle2,
  Copy,
  Check,
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
    id: "customer",
    name: "Customer Workspace",
    eyebrow: "For Engineering Teams & Leads",
    tagline: "Weekly Planning, AI Reviews & Approvals",
    description:
      "Draft checkable commitments, turn messy notes into structured plans with Gemini Flash-Lite, request lead approvals, and track Friday shipping outcomes.",
    href: "http://localhost:3001",
    badge: "Customer Portal",
    badgeVariant: "secondary" as const,
    icon: CalendarCheck,
    gradient: "from-sky-500/15 via-cyan-500/10 to-transparent",
    accentBorder: "border-sky-500/30 hover:border-sky-500/70 hover:shadow-sky-500/15",
    iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25",
    buttonClass: "bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/20",
    features: [
      {
        title: "Outcome-Driven Tasks",
        desc: "Strict 'Main + Sub-goals + Go-to-market' task breakdown.",
      },
      {
        title: "AI Drafter & Reviewer",
        desc: "Pydantic AI flags vague tasks and generates typed drafts.",
      },
      {
        title: "Team Lead Approval Loop",
        desc: "Structured feedback and one-click return with lead comments.",
      },
      {
        title: "Tenant Isolation",
        desc: "Organizations and teams strictly partitioned by org ID.",
      },
    ],
  },
  {
    id: "internal",
    name: "Staff Console",
    eyebrow: "For Platform Operators & Staff",
    tagline: "Tenant Oversight, Security & AI Telemetry",
    description:
      "Administrative command center for platform staff. Monitor tenant activity, suspend organizations, manage platform users, and track AI usage metrics.",
    href: "http://localhost:3002",
    badge: "Staff Restricted",
    badgeVariant: "outline" as const,
    icon: Shield,
    gradient: "from-amber-500/15 via-orange-500/10 to-transparent",
    accentBorder: "border-amber-500/30 hover:border-amber-500/70 hover:shadow-amber-500/15",
    iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
    buttonClass: "bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 shadow-md",
    features: [
      {
        title: "Tenant Lifecycle Control",
        desc: "Suspend or reinstate tenants; instant access revocation.",
      },
      {
        title: "User & Role Oversight",
        desc: "Platform directory, account deactivation, and staff RBAC.",
      },
      {
        title: "AI Token & Error Metrics",
        desc: "Live observability on rate-limits, latency, and token totals.",
      },
      {
        title: "Immutable Audit Logs",
        desc: "Detailed audit trail of all staff interventions.",
      },
    ],
  },
];

const DEMO_LOGINS = [
  {
    role: "Org Owner",
    email: "owner@acme.com",
    pass: "DemoPass123!",
    app: "Customer App",
    desc: "Acme Corp owner with full settings & member permissions",
  },
  {
    role: "Team Lead",
    email: "lead@acme.com",
    pass: "DemoPass123!",
    app: "Customer App",
    desc: "Core Platform lead with plan review & approval rights",
  },
  {
    role: "Team Member",
    email: "dev@acme.com",
    pass: "DemoPass123!",
    app: "Customer App",
    desc: "Software engineer with active commitments & AI drafting",
  },
  {
    role: "Platform Staff",
    email: "staff@stickpeel.internal",
    pass: "StaffPass123!",
    app: "Staff Console",
    desc: "Platform super admin with full console privileges",
  },
];

const WORKFLOW_STEPS = [
  {
    step: "01",
    day: "Monday Morning",
    title: "Draft & Validate",
    description:
      "Dump your raw notes or brain dump. StickPeel's AI structures them into checkable outcomes with a mandatory 'Why It Matters' statement.",
  },
  {
    step: "02",
    day: "Midweek Execution",
    title: "Lead Approval",
    description:
      "Team leads review commitments. Ambiguous goals get returned with actionable comments, ensuring only high-impact work enters the sprint.",
  },
  {
    step: "03",
    day: "Friday Afternoon",
    title: "Ship & Peel",
    description:
      "Mark your main deliverable as shipped. Complete your tasks, celebrate the milestone, and start fresh Monday with zero carryover.",
  },
];

function Home() {
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmail(text);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-background text-foreground antialiased selection:bg-sky-500/20 font-[family-name:var(--font-geist-sans)]">
      {/* Dynamic Ambient Background Gradients */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] [mask-image:radial-gradient(ellipse_70%_100%_at_50%_0%,black,transparent)]"
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:40px_40px] opacity-40" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[450px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-sky-500/15 via-cyan-500/10 to-transparent blur-3xl dark:from-sky-500/10 dark:via-cyan-500/5"
      />

      {/* Floating Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a
            href="/"
            className="flex items-center gap-3 transition-opacity hover:opacity-90"
          >
            <Logo className="h-8" />
          </a>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-600 dark:text-sky-400">
              <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
              Multi-Tenant Cloud
            </span>
            <a
              href="http://localhost:3001"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
              })}
            >
              Sign In
            </a>
            <a
              href="http://localhost:3001"
              className={`${buttonVariants({
                size: "sm",
              })} bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-xs`}
            >
              Get Started
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-6 pt-12 pb-20">
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-6 text-center max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 shadow-xs">
            <Sparkles className="size-3.5 text-sky-500" />
            <span>Disciplined Engineering Weekly Planning</span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-balance leading-[1.12]">
            Ship one significant outcome every Friday.{" "}
            <span className="bg-gradient-to-r from-sky-600 via-cyan-600 to-sky-500 dark:from-sky-400 dark:via-cyan-400 dark:to-blue-400 bg-clip-text text-transparent">
              Carry nothing into Monday.
            </span>
          </h1>

          <p className="max-w-2xl text-base sm:text-lg text-muted-foreground text-balance leading-relaxed">
            Eliminate work-in-progress sprawl. StickPeel pairs engineers and team leads with structured commitment cycles, AI-powered plan reviews, and strict multi-tenant isolation.
          </p>
        </div>

        {/* 2 Focused App Portals (Customer App & Staff Console) */}
        <div className="mt-14 grid w-full gap-8 md:grid-cols-2">
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <Card
                key={app.id}
                className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border bg-card/85 backdrop-blur-md shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${app.accentBorder}`}
              >
                {/* Decorative card glow */}
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gradient-to-br ${app.gradient} blur-3xl`}
                />

                <CardHeader className="space-y-4 p-8 pb-4">
                  <div className="flex items-center justify-between">
                    <div
                      className={`flex size-14 items-center justify-center rounded-2xl border ${app.iconBg} shadow-xs`}
                    >
                      <Icon className="size-7" />
                    </div>
                    <Badge
                      variant={app.badgeVariant}
                      className="rounded-full px-3 py-1 font-semibold text-xs tracking-wide"
                    >
                      {app.badge}
                    </Badge>
                  </div>

                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {app.eyebrow}
                    </span>
                    <CardTitle className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 text-foreground">
                      {app.name}
                    </CardTitle>
                    <p className="text-sm font-semibold text-sky-600 dark:text-sky-400 mt-1">
                      {app.tagline}
                    </p>
                  </div>

                  <CardDescription className="text-sm text-muted-foreground leading-relaxed">
                    {app.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="px-8 py-4">
                  <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/30 p-4">
                    {app.features.map((feat) => (
                      <div key={feat.title} className="flex items-start gap-2.5">
                        <CheckCircle2 className="size-4 shrink-0 text-sky-600 dark:text-sky-400 mt-0.5" />
                        <div className="text-xs leading-snug">
                          <strong className="text-foreground">{feat.title}: </strong>
                          <span className="text-muted-foreground">{feat.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>

                <CardFooter className="p-8 pt-4">
                  <a
                    href={app.href}
                    className={`group w-full ${buttonVariants({
                      size: "lg",
                    })} ${app.buttonClass} h-12 rounded-xl justify-between px-6 font-bold tracking-tight text-sm transition-all`}
                  >
                    <span>Launch {app.name}</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1.5" />
                  </a>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* 3-Step Lifecycle Overview */}
        <section className="mt-20 w-full">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              How High-Output Teams Use StickPeel
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              A checkable, weekly rhythm that keeps every engineer accountable.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {WORKFLOW_STEPS.map((step) => (
              <div
                key={step.step}
                className="relative flex flex-col justify-between rounded-2xl border border-border/70 bg-card/60 p-6 shadow-xs backdrop-blur-sm"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-2xl font-black text-sky-600/40 dark:text-sky-400/40">
                      {step.step}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {step.day}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-foreground">
                    {step.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Professional Footer */}
      <footer className="border-t border-border/60 bg-muted/30 py-8 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <Logomark className="size-5" />
            <span className="font-bold text-foreground tracking-tight">StickPeel</span>
            <span className="text-border">|</span>
            <span>Weekly Planning SaaS</span>
          </div>
          <div className="flex items-center gap-6 text-[11px]">
            <span>FastAPI Backend · Async SQLAlchemy</span>
            <span>TanStack Start · TanStack Query</span>
            <span>Pydantic AI (Gemini Flash-Lite)</span>
          </div>
          <p>© 2026 StickPeel. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
