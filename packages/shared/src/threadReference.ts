import type { ThreadPullRequestLink } from "@t3tools/contracts";

import { resolveThreadCurrentPullRequestLink } from "./threadPullRequests.ts";

export interface ThreadReferenceCopyTarget {
  readonly kind: "pull-request" | "thread";
  readonly value: string;
  readonly clipboardTarget: string;
  readonly successTitle: string;
  readonly failureTitle: string;
}

export function resolveThreadReferenceCopyTarget(input: {
  readonly threadId: string;
  /** Undefined means no PR panel; null means its URL is not available yet. */
  readonly openPanelPullRequestUrl?: string | null | undefined;
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequestUrl?: string | null;
}): ThreadReferenceCopyTarget | null {
  if (input.openPanelPullRequestUrl === null) return null;
  const pullRequestUrl =
    input.openPanelPullRequestUrl ??
    resolveThreadCurrentPullRequestLink(input.pullRequests ?? [])?.url ??
    input.linkedPullRequestUrl;
  return pullRequestUrl
    ? {
        kind: "pull-request",
        value: pullRequestUrl,
        clipboardTarget: "PR 链接",
        successTitle: "已复制 PR 链接",
        failureTitle: "复制 PR 链接失败",
      }
    : {
        kind: "thread",
        value: input.threadId,
        clipboardTarget: "会话 ID",
        successTitle: "已复制会话 ID",
        failureTitle: "复制会话 ID 失败",
      };
}
