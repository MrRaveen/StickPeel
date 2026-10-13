import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Layers,
  Calendar,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import {
  useGetAiUsage,
  useGetOrgDailyAiUsage,
} from "@/api/endpoints/ai-usage/ai-usage";
import type { AiUsageRow, DailyAiUsageItem } from "@/api/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_main/ai-usage")({
  component: AiUsagePage,
});

const PAGE_SIZE = 15;

function AiUsagePage() {
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // Daily Trend Modal State
  const [selectedOrg, setSelectedOrg] = useState<AiUsageRow | null>(null);

  const { data, isLoading, isError, refetch } = useGetAiUsage({
    page,
    page_size: PAGE_SIZE,
    from: fromDate ? new Date(fromDate).toISOString() : undefined,
    to: toDate ? new Date(toDate).toISOString() : undefined,
  });

  const totals = data?.totals;
  const items = data?.items ?? [];
  const totalOrgs = data?.total ?? 0;
  const totalPages = Math.ceil(totalOrgs / PAGE_SIZE) || 1;

  const totalCalls = totals?.total_calls ?? 0;
  const failureCount =
    (totals?.failed ?? 0) +
    (totals?.rate_limited ?? 0) +
    (totals?.timeout ?? 0) +
    (totals?.invalid_output ?? 0);

  const failureRate =
    totalCalls > 0 ? ((failureCount / totalCalls) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">

            AI Usage & Telemetry
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor platform-wide Gemini AI feature usage, model failures,
            timeouts, and per-organization rates. No plan text or prompts are
            collected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5 h-8"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Calendar className="size-4 text-muted-foreground shrink-0" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">From:</span>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 text-xs w-36"
                />
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className="text-xs text-muted-foreground">To:</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setPage(1);
                  }}
                  className="h-8 text-xs w-36"
                />
              </div>
            </div>

            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8 text-muted-foreground"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
              >
                Clear Date Filter
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Totals Metric Cards */}
      <div className="grid gap-3.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3.5 bg-muted/20">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="size-3.5 text-primary" /> Total Calls
          </div>
          <div className="text-2xl font-bold mt-1">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              (totals?.total_calls ?? 0)
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Failure rate: {failureRate}%
          </div>
        </Card>

        <Card className="p-3.5 bg-emerald-500/5 border-emerald-500/20">
          <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" /> Successful
          </div>
          <div className="text-2xl font-bold mt-1 text-emerald-700 dark:text-emerald-400">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              (totals?.success ?? 0)
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            200 OK responses
          </div>
        </Card>

        <Card className="p-3.5 bg-rose-500/5 border-rose-500/20">
          <div className="text-xs text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> Failed
          </div>
          <div className="text-2xl font-bold mt-1 text-rose-700 dark:text-rose-400">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              (totals?.failed ?? 0)
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Model / API 503 errors
          </div>
        </Card>

        <Card className="p-3.5 bg-amber-500/5 border-amber-500/20">
          <div className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <Clock className="size-3.5" /> Rate Limited
          </div>
          <div className="text-2xl font-bold mt-1 text-amber-700 dark:text-amber-400">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              (totals?.rate_limited ?? 0)
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            429 HTTP responses
          </div>
        </Card>

        <Card className="p-3.5 bg-blue-500/5 border-blue-500/20">
          <div className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
            <Clock className="size-3.5" /> Timeouts
          </div>
          <div className="text-2xl font-bold mt-1 text-blue-700 dark:text-blue-400">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              (totals?.timeout ?? 0)
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            &gt; 120s latency
          </div>
        </Card>

        <Card className="p-3.5 bg-purple-500/5 border-purple-500/20">
          <div className="text-xs text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
            <Layers className="size-3.5" /> Invalid Output
          </div>
          <div className="text-2xl font-bold mt-1 text-purple-700 dark:text-purple-400">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              (totals?.invalid_output ?? 0)
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Schema mismatch
          </div>
        </Card>
      </div>

      {/* Organization Usage Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Per-Organization AI Usage Breakdown</span>
            <Badge variant="outline" className="text-xs font-normal">
              {totalOrgs} Organizations Recorded
            </Badge>
          </CardTitle>
          <CardDescription>
            Detailed counts per tenant. Click an organization to view daily
            trend data.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[260px]">Organization</TableHead>
                <TableHead className="text-center">Total Invocations</TableHead>
                <TableHead className="text-center text-emerald-600">
                  Success
                </TableHead>
                <TableHead className="text-center text-rose-600">
                  Failed
                </TableHead>
                <TableHead className="text-center text-amber-600">
                  Rate Limited
                </TableHead>
                <TableHead className="text-center text-blue-600">
                  Timeout
                </TableHead>
                <TableHead className="text-center text-purple-600">
                  Invalid Output
                </TableHead>
                <TableHead>Last Invocated</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9} className="py-4">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-8 text-center text-destructive"
                  >
                    Failed to load AI usage statistics.
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No AI usage records found for this period.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.org_id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 text-xs font-semibold shrink-0">
                          {row.org_name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setSelectedOrg(row)}
                            className="font-semibold text-sm hover:underline text-left truncate block text-foreground"
                          >
                            {row.org_name}
                          </button>
                          <span className="text-[11px] text-muted-foreground font-mono truncate block">
                            {row.org_id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-center font-bold text-sm">
                      {row.total_calls ?? 0}
                    </TableCell>

                    <TableCell className="text-center font-medium text-emerald-600 dark:text-emerald-400">
                      {row.success ?? 0}
                    </TableCell>

                    <TableCell className="text-center font-medium text-rose-600 dark:text-rose-400">
                      {(row.failed ?? 0) > 0 ? (
                        <Badge
                          variant="destructive"
                          className="text-[10px] py-0 px-1.5"
                        >
                          {row.failed}
                        </Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>

                    <TableCell className="text-center font-medium text-amber-600 dark:text-amber-400">
                      {(row.rate_limited ?? 0) > 0 ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 border-amber-500 text-amber-600"
                        >
                          {row.rate_limited}
                        </Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>

                    <TableCell className="text-center font-medium text-blue-600 dark:text-blue-400">
                      {(row.timeout ?? 0) > 0 ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 border-blue-500 text-blue-600"
                        >
                          {row.timeout}
                        </Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>

                    <TableCell className="text-center font-medium text-purple-600 dark:text-purple-400">
                      {row.invalid_output ?? 0}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {row.last_call_at
                        ? new Date(row.last_call_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                        : "—"}
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setSelectedOrg(row)}
                      >
                        <BarChart3 className="size-3.5" />
                        Daily Trend
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        {totalOrgs > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <div>
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, totalOrgs)} to{" "}
              {Math.min(page * PAGE_SIZE, totalOrgs)} of {totalOrgs}{" "}
              organizations
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Previous
              </Button>
              <span className="px-2 font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Org Daily Trend Modal */}
      {selectedOrg && (
        <OrgDailyTrendModal
          org={selectedOrg}
          open={!!selectedOrg}
          onOpenChange={(open) => !open && setSelectedOrg(null)}
          fromDate={fromDate}
          toDate={toDate}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Org Daily Trend Modal
// ---------------------------------------------------------------------------

function OrgDailyTrendModal({
  org,
  open,
  onOpenChange,
  fromDate,
  toDate,
}: {
  org: AiUsageRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromDate?: string;
  toDate?: string;
}) {
  const {
    data: dailyItems,
    isLoading,
    isError,
  } = useGetOrgDailyAiUsage(org.org_id, {
    from: fromDate ? new Date(fromDate).toISOString() : undefined,
    to: toDate ? new Date(toDate).toISOString() : undefined,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Sparkles className="size-5 text-purple-600" />
              AI Activity Breakdown: {org.org_name}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Daily historical invocation breakdown for organization ID{" "}
            {org.org_id}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError ? (
          <div className="py-6 text-center text-sm text-destructive">
            Failed to load daily trend data.
          </div>
        ) : !dailyItems || dailyItems.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No daily records found for this organization.
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-center text-xs">Total</TableHead>
                    <TableHead className="text-center text-xs text-emerald-600">
                      Success
                    </TableHead>
                    <TableHead className="text-center text-xs text-rose-600">
                      Failed
                    </TableHead>
                    <TableHead className="text-center text-xs text-amber-600">
                      Rate Limited
                    </TableHead>
                    <TableHead className="text-center text-xs text-blue-600">
                      Timeout
                    </TableHead>
                    <TableHead className="text-center text-xs text-purple-600">
                      Invalid
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyItems.map((day: DailyAiUsageItem) => (
                    <TableRow key={day.date} className="text-xs">
                      <TableCell className="font-medium font-mono">
                        {day.date}
                      </TableCell>
                      <TableCell className="text-center font-bold">
                        {day.total_calls ?? 0}
                      </TableCell>
                      <TableCell className="text-center text-emerald-600">
                        {day.success ?? 0}
                      </TableCell>
                      <TableCell className="text-center text-rose-600">
                        {(day.failed ?? 0) > 0 ? (
                          <Badge
                            variant="destructive"
                            className="text-[10px] py-0 px-1.5"
                          >
                            {day.failed}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </TableCell>
                      <TableCell className="text-center text-amber-600">
                        {(day.rate_limited ?? 0) > 0 ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 border-amber-500 text-amber-600"
                          >
                            {day.rate_limited}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </TableCell>
                      <TableCell className="text-center text-blue-600">
                        {day.timeout ?? 0}
                      </TableCell>
                      <TableCell className="text-center text-purple-600">
                        {day.invalid_output ?? 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
