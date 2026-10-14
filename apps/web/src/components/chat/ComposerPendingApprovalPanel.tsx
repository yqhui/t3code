import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "应用访问批准"
      : approval.requestKind === "command"
        ? "命令批准"
        : approval.requestKind === "file-read"
          ? "文件读取批准"
          : approval.requestKind === "permission"
            ? "应用权限批准"
            : "文件更改批准";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "应用访问请求"
      : approval.requestKind === "command"
        ? "命令"
        : approval.requestKind === "file-read"
          ? "要读取的文件"
          : approval.requestKind === "permission"
            ? "权限请求"
            : "文件更改";

  return (
    <span
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 flex-col items-start gap-1", className)}
      role="group"
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-2xs text-muted-foreground">
        <span className="shrink-0 font-medium text-warning">{fallbackLabel}</span>
        {approval.appName ? <span className="min-w-0 truncate">{approval.appName}</span> : null}
        {pendingCount > 1 ? (
          <span className="ml-auto shrink-0 tabular-nums">1/{pendingCount}</span>
        ) : null}
      </span>
      <Detail
        aria-label={detailAriaLabel}
        className={cn(
          "block max-h-20 w-full min-w-0 overflow-auto text-xs text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5",
          approval.requestKind === "mcp-elicitation"
            ? "whitespace-pre-wrap font-sans wrap-break-word"
            : "whitespace-pre font-mono",
        )}
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.responseCapability === "not_resumable"
          ? "提供商进程已消失——请中断或重新启动运行以响应。"
          : approval.detail || fallbackLabel}
      </Detail>
    </span>
  );
});
