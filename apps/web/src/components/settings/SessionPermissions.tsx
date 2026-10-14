import { type EnvironmentId, sessionGrantsScope } from "@t3tools/contracts";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import { useEnvironmentSessionState } from "~/state/session";

export function SessionPermissions({
  environmentId,
  connected,
  routeContext = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly routeContext?: boolean;
}) {
  const session = useEnvironmentSessionState(environmentId);
  return connected && !session.hasError && !session.isPending && session.data?.authenticated ? (
    <div className="space-y-3 py-3 text-xs">
      <p className="text-muted-foreground">
        {routeContext
          ? "这些权限适用于当前活动路由。其他路由可能具有不同的权限。"
          : "这些权限适用于此客户端的当前连接。"}
      </p>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {AUTH_SCOPE_OPTIONS.map(({ scope, title }) => (
          <li key={scope} className="flex items-start justify-between gap-3">
            <span>{title}</span>
            <span className="shrink-0 text-muted-foreground">
              {sessionGrantsScope(session.data!, scope) ? "已授予" : "未授予"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <p className="py-3 text-xs text-muted-foreground">
      未检查权限。连接到此环境以查看此会话的权限。
    </p>
  );
}
