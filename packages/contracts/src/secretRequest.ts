import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

/**
 * The user's answer to an agent's request for a secret. A saved value is kept
 * by the server under a one-use SecretRef; the thread learns only the status.
 */
export const SecretRequestAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({ type: Schema.Literal("save"), secret: TrimmedNonEmptyString }),
    Schema.Struct({ type: Schema.Literal("decline") }),
  ]),
});
export type SecretRequestAnswerInput = typeof SecretRequestAnswerInput.Type;

const SECRET_REQUEST_FAILURE_MESSAGES = {
  load_failed: "无法加载密钥请求。",
  not_found: "该密钥请求已不存在。",
  already_answered: "该密钥请求已被回答。",
  agent_stopped: "发起请求的 Agent 已停止，该密钥无法使用。",
  store_failed: "无法存储密钥。",
  record_failed: "密钥已保存，但无法更新请求。",
  invalid_ref: "该 secretRef 无效。",
  read_failed: "无法读取密钥。",
  ref_unavailable: "该 secretRef 已被使用或不存在。请通过 request_secret 再次向用户请求。",
  ref_expired: "该 secretRef 已过期。请通过 request_secret 再次向用户请求。",
  consume_failed: "无法使用该 secretRef，请重试。",
} as const;

export const SecretRequestFailureReason = Schema.Literals(
  Object.keys(SECRET_REQUEST_FAILURE_MESSAGES) as Array<
    keyof typeof SECRET_REQUEST_FAILURE_MESSAGES
  >,
);
export type SecretRequestFailureReason = typeof SecretRequestFailureReason.Type;

/** Answering a request or using its ref failed; the message is shown to users and agents. */
export class SecretRequestError extends Schema.TaggedError<SecretRequestError>()(
  "SecretRequestError",
  {
    reason: SecretRequestFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return SECRET_REQUEST_FAILURE_MESSAGES[this.reason];
  }
}
