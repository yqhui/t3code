import {
  ProviderSetupError,
  type ProviderAuthState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as AcpErrors from "effect-acp/errors";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  parseAntigravityAuthorizationUrl,
  type AntigravityAuthorizationUrl,
} from "./antigravityAuthSupport.ts";
import {
  forwardAntigravityCallback,
  validateAntigravityCallbackUrl,
} from "./antigravityCallback.ts";
import type { ProviderAuthController } from "./ProviderAuthService.ts";

const AUTH_TIMEOUT_MS = 300_000;
const FORWARDING_FAILED_MESSAGE = "登录响应送达失败，请重新发起登录。";
const isSetupError = Schema.is(ProviderSetupError);
const isAcpRequestError = Schema.is(AcpErrors.AcpRequestError);

interface AuthSnapshot {
  readonly ownerSessionId: string | null;
  readonly state: ProviderAuthState;
}

interface AuthFlow {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly expiresAtMillis: number;
  state: ProviderAuthState;
  pending: AntigravityAuthorizationUrl | undefined;
  callbackSent: boolean;
  fiber: Fiber.Fiber<void> | undefined;
  forwarding: Fiber.Fiber<void, ProviderSetupError> | undefined;
}

interface OwnedProcess {
  readonly stop: Effect.Effect<void>;
  startup: Fiber.Fiber<unknown, unknown> | undefined;
}

export interface AntigravityAuth {
  readonly controller: ProviderAuthController;
  /** Tracks startup and the process scope so sign-out cannot leave cached credentials in memory. */
  readonly withProcess: <A, E, R>(
    stop: Effect.Effect<void>,
    task: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProviderSetupError, R | Scope.Scope>;
}

export type AntigravityAuthRuntime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  "initialize" | "start" | "request"
>;

export interface AntigravityAuthOptions<
  Runtime extends AntigravityAuthRuntime = AcpSessionRuntime.AcpSessionRuntime["Service"],
> {
  readonly instanceId: ProviderInstanceId;
  readonly makeRuntime: (input: {
    readonly onAuthorizationUrl?: (url: string) => Effect.Effect<void, AcpErrors.AcpError>;
  }) => Effect.Effect<Runtime, AcpErrors.AcpError | ProviderSetupError, Scope.Scope>;
  readonly onAuthenticated: (
    result: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    runtime: Runtime,
  ) => Effect.Effect<void>;
  readonly onSignedOut: Effect.Effect<void>;
  readonly forwardCallback?: (callback: URL) => Effect.Effect<void, ProviderSetupError>;
  /** False for API key methods, which authenticate without a Google sign-in page. */
  readonly usesBrowser?: boolean;
}

function visibleSnapshot(snapshot: AuthSnapshot, ownerSessionId: string): ProviderAuthState {
  if (snapshot.ownerSessionId === null || snapshot.ownerSessionId === ownerSessionId) {
    return snapshot.state;
  }
  const busy = ["starting", "waiting", "verifying"].includes(snapshot.state.phase);
  return {
    ...snapshot.state,
    flowId: null,
    authorizationUrl: null,
    interaction: null,
    expiresAt: null,
    ...(busy ? { message: "另一个客户端正在进行登录。" } : {}),
  };
}

function safeAuthFailure(cause: Cause.Cause<unknown>, usesBrowser: boolean): string {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) {
    if (isSetupError(error.value)) {
      return error.value.detail;
    }
    if (isAcpRequestError(error.value)) {
      if (error.value.errorMessage.includes("SUBSCRIPTION_REQUIRED")) {
        return "Google 要求此账号具备符合条件的 Antigravity 订阅。";
      }
      if (/access_denied|denied access|cancelled/i.test(error.value.errorMessage)) {
        return "Google 登录未获批准，请重新发起登录。";
      }
      if (error.value.method === "session/new" && error.value.code === -32603) {
        return "Antigravity 已完成认证，但无法初始化会话或加载模型。";
      }
      if (!usesBrowser && error.value.code === -32602) {
        return "Antigravity 拒绝了所配置的凭据，请检查提供商设置。";
      }
    }
  }
  return usesBrowser
    ? "Google 登录失败，请重新发起登录。"
    : "Antigravity 无法使用所配置的凭据进行认证。";
}

/** Owns one instance's explicit sign-in and all process admission around sign-out. */
export const makeAntigravityAuth = Effect.fn("makeAntigravityAuth")(function* <
  Runtime extends AntigravityAuthRuntime,
>(
  options: AntigravityAuthOptions<Runtime>,
): Effect.fn.Return<AntigravityAuth, never, Crypto.Crypto | Scope.Scope> {
  const crypto = yield* Crypto.Crypto;
  const instanceScope = yield* Scope.Scope;
  const usesBrowser = options.usesBrowser ?? true;
  const lock = yield* Semaphore.make(1);
  const closed = yield* Deferred.make<void>();
  const emptyState: ProviderAuthState = {
    instanceId: options.instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
  };
  const snapshot = yield* SubscriptionRef.make<AuthSnapshot>({
    ownerSessionId: null,
    state: emptyState,
  });
  const processes = new Set<OwnedProcess>();
  let activeFlow: AuthFlow | undefined;
  let operation: "idle" | "auth" | "logout" | "cancel" | "closed" = "idle";

  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation: name, detail });
  const currentState = (ownerSessionId: string) =>
    SubscriptionRef.get(snapshot).pipe(
      Effect.map((value) => visibleSnapshot(value, ownerSessionId)),
    );
  const publishFlow = (flow: AuthFlow, state: ProviderAuthState) => {
    flow.state = state;
    return SubscriptionRef.set(snapshot, { ownerSessionId: flow.ownerSessionId, state });
  };
  const stopOwnedProcesses = Effect.suspend(() =>
    Effect.forEach(
      Array.from(processes),
      (owned) =>
        Effect.gen(function* () {
          if (owned.startup) {
            yield* Fiber.interrupt(owned.startup);
          }
          yield* owned.stop;
        }),
      { discard: true, concurrency: "unbounded" },
    ),
  );

  const withProcess: AntigravityAuth["withProcess"] = (stop, task) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const owned: OwnedProcess = { stop, startup: undefined };
        const fiber = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (operation !== "idle") {
              return yield* setupError(
                "startProcess",
                "Antigravity 正在登录或登出中，请等待完成后再试。",
              );
            }
            processes.add(owned);
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                processes.delete(owned);
              }),
            );
            const child = yield* restore(task).pipe(Effect.forkIn(scope));
            owned.startup = child;
            return child;
          }),
        );
        // Propagate interruption after the exit wait so concurrent stop waiters stay attached.
        return yield* restore(Fiber.await(fiber)).pipe(
          Effect.flatMap((result) => result),
          Effect.ensuring(Fiber.interrupt(fiber)),
          Effect.ensuring(
            Effect.sync(() => {
              owned.startup = undefined;
            }),
          ),
        );
      }),
    );

  const finishFlow = (flow: AuthFlow, result: Exit.Exit<void, unknown>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (activeFlow !== flow) return;
        activeFlow = undefined;
        operation = "idle";
        flow.pending = undefined;
        yield* publishFlow(flow, {
          ...flow.state,
          phase: Exit.isSuccess(result) ? "succeeded" : "failed",
          authorizationUrl: null,
          expiresAt: null,
          message: Exit.isSuccess(result)
            ? usesBrowser
              ? "已通过 Google 登录。"
              : "已连接到 Antigravity。"
            : safeAuthFailure(result.cause, usesBrowser),
        });
      }),
    );

  const receiveAuthorizationUrl = (flow: AuthFlow, url: string) =>
    parseAntigravityAuthorizationUrl(url).pipe(
      Effect.flatMap((authorization) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow || operation !== "auth") return;
            if (flow.pending) {
              if (flow.pending.authorizationUrl === authorization.authorizationUrl) return;
              return yield* new AcpErrors.AcpTransportError({
                detail: "Antigravity 发起了多个 Google 登录请求。",
                cause: undefined,
              });
            }
            flow.pending = authorization;
            yield* publishFlow(flow, {
              ...flow.state,
              phase: "waiting",
              authorizationUrl: authorization.authorizationUrl,
              message: "请打开 Google 登录链接。如果你在远程，请将重定向 URL 粘贴到这里。",
            });
          }),
        ),
      ),
    );

  const runSignIn = (flow: AuthFlow, stopSessions: Effect.Effect<void, ProviderSetupError>) =>
    Effect.gen(function* () {
      yield* stopSessions.pipe(Effect.ensuring(stopOwnedProcesses));
      const runtime = yield* options.makeRuntime({
        onAuthorizationUrl: (url) => receiveAuthorizationUrl(flow, url),
      });
      const started = yield* runtime.start();
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          if (activeFlow !== flow) return;
          flow.pending = undefined;
          yield* publishFlow(flow, {
            ...flow.state,
            phase: "verifying",
            authorizationUrl: null,
            message: "正在检查 Antigravity 访问权限与模型。",
          });
        }),
      );
      yield* options.onAuthenticated(started, runtime);
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: AUTH_TIMEOUT_MS,
        orElse: () => Effect.fail(setupError("start", "Google 登录已过期，请重新发起登录。")),
      }),
      Effect.exit,
      Effect.flatMap((result) => finishFlow(flow, result)),
    );

  const stopFlow = (flow: AuthFlow, phase: "cancelled" | "failed", message: string) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const detached = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow) return false;
            activeFlow = undefined;
            operation = "cancel";
            flow.pending = undefined;
            yield* publishFlow(flow, {
              ...flow.state,
              phase,
              authorizationUrl: null,
              expiresAt: null,
              message,
            });
            return true;
          }),
        );
        if (!detached) return;
        if (flow.forwarding) yield* Fiber.interrupt(flow.forwarding);
        if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
        yield* lock.withPermits(1)(
          Effect.sync(() => {
            if (operation === "cancel") operation = "idle";
          }),
        );
      }),
    );

  const requireFlow = (ownerSessionId: string, flowId: string, name: string) =>
    Effect.gen(function* () {
      const flow = activeFlow;
      if (!flow || flow.id !== flowId || flow.ownerSessionId !== ownerSessionId) {
        return yield* setupError(name, "此登录在当前客户端已不再有效。");
      }
      const now = yield* Clock.currentTimeMillis;
      if (now >= flow.expiresAtMillis) {
        return yield* setupError(name, "Google 登录已过期，请重新发起登录。");
      }
      return flow;
    });

  const controller: ProviderAuthController = {
    start: (ownerSessionId, stopSessions = Effect.void) =>
      lock.withPermits(1)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (activeFlow?.ownerSessionId === ownerSessionId && operation === "auth") {
              return activeFlow.state;
            }
            if (operation !== "idle") {
              return yield* setupError("start", "Antigravity 初始设置已在进行中。");
            }
            const flowId = yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(() => setupError("start", "无法发起 Google 登录，请重试。")),
            );
            const expiresAtMillis = (yield* Clock.currentTimeMillis) + AUTH_TIMEOUT_MS;
            const state: ProviderAuthState = {
              ...emptyState,
              phase: "starting",
              flowId,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
              message: usesBrowser ? "正在发起 Google 登录。" : "正在检查凭据。",
            };
            const flow: AuthFlow = {
              id: flowId,
              ownerSessionId,
              expiresAtMillis,
              state,
              pending: undefined,
              callbackSent: false,
              fiber: undefined,
              forwarding: undefined,
            };
            activeFlow = flow;
            operation = "auth";
            yield* publishFlow(flow, state);
            flow.fiber = yield* runSignIn(flow, stopSessions).pipe(
              Effect.interruptible,
              Effect.forkIn(instanceScope),
            );
            return state;
          }),
        ),
      ),
    complete: Effect.fn("AntigravityAuth.complete")(function* (ownerSessionId, input) {
      const pending = yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const flow = yield* requireFlow(ownerSessionId, input.flowId, "complete");
          if (!flow.pending || flow.callbackSent) {
            return yield* setupError(
              "complete",
              flow.callbackSent
                ? "登录响应已发送，请等待 Google 完成。"
                : "请先等待 Google 登录链接出现，再发送重定向 URL。",
            );
          }
          const callback = yield* validateAntigravityCallbackUrl(
            options.instanceId,
            flow.pending,
            input.callbackUrl,
          );
          flow.callbackSent = true;
          yield* publishFlow(flow, {
            ...flow.state,
            phase: "verifying",
            authorizationUrl: null,
            message: "正在等待 Google 完成登录。",
          });
          // The instance owns delivery and its failure handling. The RPC that
          // sent the callback may disconnect before Google answers, and the
          // flow must still settle instead of sitting at "verifying" until
          // the deadline.
          const forwarding = yield* (
            options.forwardCallback?.(callback) ??
            forwardAntigravityCallback(options.instanceId, callback)
          ).pipe(
            // stopFlow interrupts this fiber, so it runs from a sibling fiber.
            Effect.tapError(() =>
              stopFlow(flow, "failed", FORWARDING_FAILED_MESSAGE).pipe(
                Effect.forkIn(instanceScope),
              ),
            ),
            Effect.interruptible,
            Effect.forkIn(instanceScope),
          );
          flow.forwarding = forwarding;
          return { flow, forwarding };
        }),
      );
      const forwarded = yield* Fiber.await(pending.forwarding);
      if (Exit.isFailure(forwarded)) {
        return yield* setupError("complete", FORWARDING_FAILED_MESSAGE);
      }
      return pending.flow.state;
    }),
    cancel: Effect.fn("AntigravityAuth.cancel")(function* (ownerSessionId, flowId) {
      const flow = yield* lock.withPermits(1)(requireFlow(ownerSessionId, flowId, "cancel"));
      yield* stopFlow(flow, "cancelled", "Google 登录已取消。");
      return flow.state;
    }),
    logout: Effect.fn("AntigravityAuth.logout")(function* (stopSessions) {
      const task = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const flow = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              if (operation !== "idle" && operation !== "auth") {
                return yield* setupError("logout", "Antigravity 初始设置正在停止中。");
              }
              operation = "logout";
              const currentFlow = activeFlow;
              activeFlow = undefined;
              if (currentFlow) {
                currentFlow.pending = undefined;
                yield* publishFlow(currentFlow, {
                  ...currentFlow.state,
                  phase: "cancelled",
                  authorizationUrl: null,
                  expiresAt: null,
                  message: "Google 登录因登出而取消。",
                });
              }
              return currentFlow;
            }),
          );
          const stopRemaining = Effect.gen(function* () {
            if (flow?.forwarding) yield* Fiber.interrupt(flow.forwarding);
            if (flow?.fiber) yield* Fiber.interrupt(flow.fiber);
            yield* stopOwnedProcesses;
          });
          const result = yield* restore(
            Effect.gen(function* () {
              yield* stopSessions.pipe(Effect.ensuring(stopRemaining));
              const runtime = yield* options.makeRuntime({});
              const initialized = yield* runtime.initialize();
              if (!initialized.agentCapabilities?.auth?.logout) {
                return yield* setupError(
                  "logout",
                  "此版本的 Antigravity 不支持登出。请更新该提供商。",
                );
              }
              yield* runtime.request("logout", {});
              yield* options.onSignedOut;
            }).pipe(
              Effect.scoped,
              Effect.timeoutOrElse({
                duration: "90 seconds",
                orElse: () => Effect.fail(setupError("logout", "Antigravity 登出超时。")),
              }),
            ),
          ).pipe(Effect.exit);
          yield* lock.withPermits(1)(
            Effect.gen(function* () {
              operation = "idle";
              yield* SubscriptionRef.set(snapshot, {
                ownerSessionId: null,
                state: {
                  ...emptyState,
                  phase: Exit.isSuccess(result) ? "idle" : "failed",
                  message: Exit.isSuccess(result)
                    ? "已登出 Google。"
                    : "Antigravity 登出失败，请重试。",
                },
              });
            }),
          );
          if (Exit.isFailure(result)) {
            const failure = Cause.findErrorOption(result.cause);
            return yield* Option.isSome(failure) && isSetupError(failure.value)
              ? failure.value
              : setupError("logout", "Antigravity 登出失败，请重试。");
          }
          return yield* currentState("");
        }),
      );
      const worker = yield* task.pipe(Effect.forkIn(instanceScope));
      return yield* Fiber.await(worker).pipe(Effect.flatMap((result) => result));
    }),
    subscribe: (ownerSessionId) =>
      SubscriptionRef.changes(snapshot).pipe(
        Stream.map((value) => {
          const state = visibleSnapshot(value, ownerSessionId);
          return {
            ...state,
            credentialOwner: "provider" as const,
            interaction:
              state.phase === "waiting" && state.authorizationUrl && state.flowId
                ? {
                    type: "browser" as const,
                    id: state.flowId,
                    url: state.authorizationUrl,
                    requiresConsent: false,
                    acceptsCallback: true,
                  }
                : null,
          };
        }),
        Stream.interruptWhen(Deferred.await(closed)),
      ),
    isLogoutPrompt: (text, hasAttachments) => !hasAttachments && text.trim() === "/logout",
  };

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      operation = "closed";
      const flow = activeFlow;
      activeFlow = undefined;
      if (flow) {
        flow.pending = undefined;
        if (flow.forwarding) yield* Fiber.interrupt(flow.forwarding);
        if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
      }
      yield* stopOwnedProcesses;
      yield* Deferred.succeed(closed, undefined);
    }),
  );

  return { controller, withProcess };
});
