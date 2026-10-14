import type { ScheduledTaskWebhookEndpoint } from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";

/**
 * Where a sender can call a webhook task, as a client shows it. With T3
 * Connect the server returns a public URL; without it the path is resolved on
 * the address this client reaches the environment at.
 */
export interface WebhookAddress {
  /** The URL to give a sender, or the bare path when no address is known. */
  readonly address: string;
  /** Whether `address` is a full URL a sender can call. */
  readonly copyable: boolean;
  /** One line on who can reach `address`; null for a T3 Connect URL. */
  readonly note: string | null;
}

export function webhookAddress(
  endpoint: ScheduledTaskWebhookEndpoint,
  httpBaseUrl: string | null,
): WebhookAddress {
  if (endpoint.url !== null) {
    return { address: endpoint.url, copyable: true, note: null };
  }
  if (httpBaseUrl === null) {
    return {
      address: endpoint.path,
      copyable: false,
      note: "将此环境关联到 T3 Connect 以获取公共 URL。",
    };
  }
  const url = new URL(endpoint.path, httpBaseUrl);
  return {
    address: url.href,
    copyable: true,
    note: isLocalLoopbackHost(url.hostname)
      ? "只有此电脑可以调用该地址。关联 T3 Connect 以获取公共 URL。"
      : "在能够访问此环境地址的任何位置都可使用，例如通过 Tailscale 或自建代理。关联 T3 Connect 以获取公共 URL。",
  };
}
