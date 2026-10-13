import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useListAuditLogs } from "@/api/endpoints/audit-logs/audit-logs";
import type { AuditRow } from "@/api/model";
import { useCurrentUser } from "@/contexts/user-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export const Route = createFileRoute("/_main/audit-logs")({
  component: AuditLogsPage,
});

const PAGE_SIZE = 20;

function AuditLogsPage() {
  const currentStaff = useCurrentUser();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [targetTypeFilter, setTargetTypeFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const hasAuditPermission =
    currentStaff?.permissions?.includes("platform.audit.view") ?? false;

  const actionParam = actionFilter === "all" ? undefined : actionFilter;
  const targetTypeParam =
    targetTypeFilter === "all" ? undefined : targetTypeFilter;

  const { data, isLoading, isError, refetch } = useListAuditLogs(
    {
      page,
      page_size: PAGE_SIZE,
      action: actionParam,
      target_type: targetTypeParam,
      from: fromDate ? new Date(fromDate).toISOString() : undefined,
      to: toDate ? new Date(toDate).toISOString() : undefined,
    },
    {
      query: {
        enabled: hasAuditPermission,
        retry: false,
      },
    }
  );

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  if (!hasAuditPermission) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-6 text-destructive" />
          <h1 className="text-2xl font-bold tracking-tight">
            Access Restricted
          </h1>
        </div>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6">
            <p className="text-sm text-foreground">
              Your account does not possess the <code>platform.audit.view</code>{" "}
              permission required to inspect the platform audit trail.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  function getActionBadgeVariant(
    action: string
  ): "destructive" | "outline" | "secondary" | "default" {
    if (
      action.includes("suspend") ||
      action.includes("deactivate") ||
      action.includes("remove")
    ) {
      return "destructive";
    }
    if (
      action.includes("reinstate") ||
      action.includes("reactivate") ||
      action.includes("create")
    ) {
      return "outline";
    }
    return "secondary";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">

            Platform Audit Logs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Immutable log of all administrative actions, user deactivations,
            organization suspensions, and staff role assignments.
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
          <Badge variant="outline" className="text-xs px-2.5 py-1">
            Total: {total.toLocaleString()} Events
          </Badge>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {/* Action Filter */}
            <div>
              <NativeSelect
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="all">All Actions</NativeSelectOption>
                <NativeSelectOption value="org.suspend">
                  org.suspend
                </NativeSelectOption>
                <NativeSelectOption value="org.reinstate">
                  org.reinstate
                </NativeSelectOption>
                <NativeSelectOption value="user.deactivate">
                  user.deactivate
                </NativeSelectOption>
                <NativeSelectOption value="user.reactivate">
                  user.reactivate
                </NativeSelectOption>
                <NativeSelectOption value="staff.create">
                  staff.create
                </NativeSelectOption>
                <NativeSelectOption value="staff.update">
                  staff.update
                </NativeSelectOption>
                <NativeSelectOption value="staff.remove">
                  staff.remove
                </NativeSelectOption>
              </NativeSelect>
            </div>

            {/* Target Type Filter */}
            <div>
              <NativeSelect
                value={targetTypeFilter}
                onChange={(e) => {
                  setTargetTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full"
              >
                <NativeSelectOption value="all">All Targets</NativeSelectOption>
                <NativeSelectOption value="organization">
                  Organization
                </NativeSelectOption>
                <NativeSelectOption value="user">User</NativeSelectOption>
              </NativeSelect>
            </div>

            {/* Date Range: From */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">
                From:
              </span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs"
              />
            </div>

            {/* Date Range: To */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">
                To:
              </span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead className="w-[200px]">Staff Member</TableHead>
                <TableHead className="w-[160px]">Action</TableHead>
                <TableHead className="w-[140px]">Target Type</TableHead>
                <TableHead className="w-[180px]">Target ID</TableHead>
                <TableHead>Reason / Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="py-4">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-destructive"
                  >
                    Failed to load audit logs.
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No audit logs found for the selected criteria.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log: AuditRow) => (
                  <TableRow key={log.id} className="hover:bg-muted/40 text-xs">
                    <TableCell className="font-mono text-muted-foreground">
                      {new Date(log.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </TableCell>

                    <TableCell className="font-medium text-foreground">
                      {log.staff_email}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={getActionBadgeVariant(log.action)}
                        className="font-mono text-[11px] px-1.5 py-0"
                      >
                        {log.action}
                      </Badge>
                    </TableCell>

                    <TableCell className="capitalize text-muted-foreground">
                      {log.target_type}
                    </TableCell>

                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {log.target_id.slice(0, 13)}...
                    </TableCell>

                    <TableCell className="text-foreground max-w-xs truncate">
                      {log.detail || (
                        <span className="text-muted-foreground italic">
                          None
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <div>
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)} to{" "}
              {Math.min(page * PAGE_SIZE, total)} of {total} audit records
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
    </div>
  );
}
