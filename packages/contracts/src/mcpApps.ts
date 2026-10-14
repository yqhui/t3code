import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

/**
 * Requests an MCP App makes of its own MCP server, through the environment.
 * Each names the tool call that produced the app; the environment resolves the
 * app's server from that item, so an app can only reach the server it came from.
 */
const McpAppTarget = {
  threadId: ThreadId,
  itemId: TurnItemId,
};

export const McpAppCallToolInput = Schema.Struct({
  ...McpAppTarget,
  name: TrimmedNonEmptyString,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
});
export type McpAppCallToolInput = typeof McpAppCallToolInput.Type;

/** MCP `CallToolResult`, passed through to the app unchanged. */
export const McpAppCallToolResult = Schema.Struct({
  content: Schema.Array(Schema.Unknown),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
  _meta: Schema.optional(Schema.Unknown),
});
export type McpAppCallToolResult = typeof McpAppCallToolResult.Type;

export const McpAppToolInfoInput = Schema.Struct({
  ...McpAppTarget,
  name: TrimmedNonEmptyString,
});
export type McpAppToolInfoInput = typeof McpAppToolInfoInput.Type;

/**
 * What a client needs to decide whether to ask before a call: whether the tool
 * exists for apps and whether its server declares it read-only.
 */
export const McpAppToolInfo = Schema.Struct({
  callable: Schema.Boolean,
  readOnly: Schema.Boolean,
  title: Schema.optional(Schema.String),
  /** The server's MCP `Tool` definition, which the host passes to the app as `toolInfo`. */
  tool: Schema.optional(Schema.Unknown),
});
export type McpAppToolInfo = typeof McpAppToolInfo.Type;

export const McpAppReadResourceInput = Schema.Struct({
  ...McpAppTarget,
  uri: TrimmedNonEmptyString,
});
export type McpAppReadResourceInput = typeof McpAppReadResourceInput.Type;

/** MCP `ReadResourceResult`, passed through to the app unchanged. */
export const McpAppReadResourceResult = Schema.Struct({
  contents: Schema.Array(Schema.Unknown),
});
export type McpAppReadResourceResult = typeof McpAppReadResourceResult.Type;

/**
 * What an app wants the agent to know on its next turn (`ui/update-model-context`).
 * Each update replaces the app's previous one; no content clears it.
 */
export const McpAppUpdateModelContextInput = Schema.Struct({
  ...McpAppTarget,
  /**
   * The thread whose next turn gets the context: the one on screen, which is
   * the app's own thread or a fork that shows it.
   */
  conversationThreadId: ThreadId,
  content: Schema.optional(Schema.Array(Schema.Unknown)),
  structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type McpAppUpdateModelContextInput = typeof McpAppUpdateModelContextInput.Type;

export const McpAppRequestErrorReason = Schema.Literals([
  "not-an-app",
  "provider-unsupported",
  "session-stopped",
  "tool-not-callable",
  "unsupported-content",
  "request-failed",
]);
export type McpAppRequestErrorReason = typeof McpAppRequestErrorReason.Type;

export class McpAppRequestError extends Schema.TaggedError<McpAppRequestError>()(
  "McpAppRequestError",
  {
    threadId: ThreadId,
    reason: McpAppRequestErrorReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-an-app":
        return "此工具调用没有 MCP 应用。";
      case "provider-unsupported":
        return "此会话的提供商不支持运行 MCP 应用请求。";
      case "session-stopped":
        // A forked thread shows its source's apps, so this names the thread
        // that made the app rather than the one on screen.
        return "该应用所属的会话未在运行。请在创建它的会话中发送消息以再次使用该应用。";
      case "tool-not-callable":
        return "此应用无法调用该工具。";
      case "unsupported-content":
        return "仅支持文本和结构化内容。";
      case "request-failed":
        return "该应用的 MCP 服务器请求失败。";
    }
  }
}
