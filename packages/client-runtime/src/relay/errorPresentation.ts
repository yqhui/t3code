import type { DpopFailureReason } from "@t3tools/contracts";
import type { RelayEnvironmentStatusResponse, RelayProtectedError } from "@t3tools/contracts/relay";

export const DPOP_CLOCK_HINT = "提示：请检查两台设备是否都开启了自动日期与时间，然后重试。";

/** Older servers omit the DPoP category, but newer servers can also omit it for
 * a credential failure that happens after proof verification. */
export const DPOP_UNKNOWN_HINT =
  "提示：请重试。如果仍然失败，可能是时钟偏差所致；请检查两台设备是否都开启了自动日期与时间。";

export const DPOP_RETRY_HINT = "提示：请重试。如果问题持续出现，请复制 trace ID。";

function dpopFailureHint(reason: DpopFailureReason | undefined): string {
  if (reason === "time_window") return DPOP_CLOCK_HINT;
  if (reason === undefined) return DPOP_UNKNOWN_HINT;
  return DPOP_RETRY_HINT;
}

export function dpopFailureMessage(message: string, reason: DpopFailureReason | undefined): string {
  return `${message} ${dpopFailureHint(reason)}`;
}

export function relayProtectedErrorMessage(error: RelayProtectedError): string {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return "中继拒绝了云端会话令牌。";
        case "invalid_dpop":
          return dpopFailureMessage("中继拒绝了 DPoP 证明。", error.dpopFailureReason);
        case "not_authorized":
          return "中继拒绝了该已认证的请求。";
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return "中继拒绝了已过期的环境链接证明。";
    case "RelayEnvironmentLinkProofInvalidError":
      return `中继拒绝了环境链接证明（${error.reason}）。`;
    case "RelayEnvironmentConnectNotAuthorizedError":
      // "Not authorized" covers non-auth causes too; surface the reason so a
      // missing link does not read as a credential problem.
      if (error.reason === "environment_link_not_found") {
        return "中继没有此环境的活动链接。环境服务器可能尚未重新建立链接。";
      }
      if (error.reason === "managed_endpoint_allocation_not_ready") {
        return "该环境的 T3 Connect 隧道仍在设置中。";
      }
      return error.reason
        ? `中继拒绝了环境连接请求（${error.reason}）。`
        : "中继拒绝了环境连接请求。";
    case "RelayEnvironmentEndpointUnavailableError":
      return `中继无法访问环境端点（${error.reason}）。`;
    case "RelayEnvironmentEndpointTimedOutError":
      return "中继联系环境端点超时。";
    case "RelayEnvironmentLinkFailedError":
      return `中继无法建立环境链接（${error.reason}）。`;
    case "RelayEnvironmentLinkUnavailableError":
      return `中继无法配置托管端点（${error.reason}）。`;
    case "RelayEnvironmentLinkLimitExceededError":
      return `中继拒绝了链接：此账号的托管隧道已达上限（${error.maxTunnels} 条）。请取消某个环境的链接以释放名额。`;
    case "RelayAgentActivityPublishProofExpiredError":
      return "中继拒绝了已过期的 Agent 活动发布证明。";
    case "RelayAgentActivityPublishProofInvalidError":
      return `中继拒绝了 Agent 活动发布证明（${error.reason}）。`;
    case "RelayInternalError":
      return `中继发生内部错误（${error.reason}）。`;
  }
}

// A host with a current build gets a new tunnel on its own within minutes of
// coming back, which clears this reason. While it is still reported, the host
// is either still off or running a build too old to do that.
export const RELAY_TUNNEL_RELEASED_MESSAGE =
  "该环境已离线一段时间，其 T3 Connect 隧道已被移除。请在那台电脑上启动 T3 Code 并更新到最新版本以重新连接。";

/** User-facing text for an offline status, or null when the relay gave no known reason. */
export function relayOfflineReasonMessage(
  status: Pick<RelayEnvironmentStatusResponse, "offlineReason">,
): string | null {
  switch (status.offlineReason) {
    case "tunnel_released":
      return RELAY_TUNNEL_RELEASED_MESSAGE;
    case undefined:
      return null;
  }
}
