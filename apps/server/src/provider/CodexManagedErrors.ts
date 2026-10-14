const legacyFailures = {
  subscription_sharing_v2_user_not_eligible: {
    message: "此账户或工作区无法使用 ChatGPT 共享。请使用其他提供商，或检查共享策略。",
    revoke: false,
  },
  subscription_sharing_usage_limit_exceeded: {
    message: "已达到 ChatGPT 用量限额。请在 ChatGPT 用量设置中查看可用额度。",
    revoke: false,
  },
  subscription_sharing_usage_unavailable: {
    message: "ChatGPT 用量暂时不可用，请稍后重试。",
    revoke: false,
  },
  subscription_sharing_unsupported_capability: {
    message: "Codex 使用了 ChatGPT 共享不支持的功能。请使用其他提供商处理此请求。",
    revoke: false,
  },
  subscription_sharing_v2_client_not_enabled: {
    message: "此 ChatGPT 连接未启用本应用。请使用现有 CLI 或其他提供商。",
    revoke: false,
  },
  subscription_sharing_v2_route_not_supported: {
    message: "ChatGPT 不支持此请求路由。",
    revoke: false,
  },
  subscription_sharing_v2_invalid_user: {
    message: "ChatGPT 无法验证此连接。请检查所选账户和共享权限。",
    revoke: false,
  },
  subscription_sharing_v2_user_unavailable: {
    message: "ChatGPT 暂时不可用，请稍后重试。",
    revoke: false,
  },
} as const;
const failures = {
  ...legacyFailures,
  subscription_sharing_user_not_eligible: legacyFailures.subscription_sharing_v2_user_not_eligible,
  subscription_sharing_route_not_supported:
    legacyFailures.subscription_sharing_v2_route_not_supported,
  subscription_sharing_invalid_user: legacyFailures.subscription_sharing_v2_invalid_user,
  subscription_sharing_user_unavailable: legacyFailures.subscription_sharing_v2_user_unavailable,
  chatpass_v2_scope_not_authorized: {
    message: "此 ChatGPT 授权不允许该请求。请检查连接的共享权限。",
    revoke: false,
  },
  chatpass_v2_invalid_authorization_context: {
    message: "ChatGPT 无法授权此连接。请检查客户端和共享权限。",
    revoke: false,
  },
};
export function classifyCodexManagedError(value: unknown) {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (typeof text !== "string") return undefined;
  for (const [code, failure] of Object.entries(failures)) {
    if (!text.includes(code)) continue;
    if (code === "subscription_sharing_unsupported_capability") {
      if (text.includes("tool 'namespace'"))
        return {
          ...failure,
          code,
          message: "Codex 发送了 ChatGPT 共享不支持的工具命名空间。请使用其他提供商处理此请求。",
        };
      if (text.includes("additional_tools"))
        return {
          ...failure,
          code,
          message: "Codex 发送了 ChatGPT 共享不支持的输入项。请使用其他提供商处理此请求。",
        };
    }
    return { ...failure, code };
  }
  return undefined;
}
