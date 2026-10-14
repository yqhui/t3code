import { Alert, AlertDescription } from "../ui/alert";
import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useRef, useState, useCallback } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { readHostedPairingRequest } from "../../hostedPairing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { useAtomCommand } from "../../state/use-atom-command";

export function PairingPendingSurface() {
  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title="正在与此环境配对"
        description="正在验证配对链接并准备你的会话。"
      />
    </StandalonePage>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => void;
}) {
  const autoPairTokenRef = useRef<string | null>(peekPairingTokenFromUrl());
  const [credential, setCredential] = useState(() => autoPairTokenRef.current ?? "");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = useCallback(
    async (nextCredential: string) => {
      setIsSubmitting(true);
      setErrorMessage("");

      const submitError = await submitServerAuthCredential(nextCredential).then(
        () => null,
        (error) => errorMessageFromUnknown(error),
      );

      setIsSubmitting(false);

      if (submitError) {
        setErrorMessage(submitError);
        return;
      }

      startTransition(() => {
        onAuthenticated();
      });
    },
    [onAuthenticated],
  );

  const handleSubmit = useCallback(
    async (event?: React.SubmitEvent<HTMLFormElement>) => {
      event?.preventDefault();
      await submitCredential(credential);
    },
    [submitCredential, credential],
  );

  useEffect(() => {
    const token = autoPairTokenRef.current;
    if (!token || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    void submitCredential(token);
  }, [submitCredential]);

  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title="与此环境配对"
        description={describeAuthGate(auth.bootstrapMethods)}
      />

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="pairing-token">
            配对令牌
          </label>
          <Input
            id="pairing-token"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={isSubmitting}
            nativeInput
            onChange={(event) => setCredential(event.currentTarget.value)}
            placeholder="粘贴一次性令牌或配对密钥"
            spellCheck={false}
            value={credential}
          />
        </div>

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} size="sm" type="submit">
            {isSubmitting ? "正在配对…" : "继续"}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            重新加载应用
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {describeSupportedMethods(auth.bootstrapMethods)}
      </div>
    </StandalonePage>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const hostedPairingRequestRef = useRef(readHostedPairingRequest());
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(() =>
    hostedPairingRequestRef.current ? "pairing" : "error",
  );
  const [message, setMessage] = useState(() =>
    hostedPairingRequestRef.current ? "正在连接此后端。" : "此配对链接缺少后端主机或令牌。",
  );
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = useCallback(async () => {
    const request = hostedPairingRequestRef.current;

    if (!request) {
      setStatus("error");
      setMessage("此配对链接缺少后端主机或令牌。");
      setCanRetry(false);
      return;
    }

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage("此一次性配对令牌已被使用，请重新获取配对链接。");
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage("正在连接此后端。");
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage(`${request.label || "该环境"} 已保存到此浏览器。`);
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage(
      `${errorMessageFromUnknown(squashAtomCommandFailure(result))} 如果后端已接受此一次性令牌，请先重新获取配对链接再重试。`,
    );
  }, [connectPairingEnvironment]);

  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    void submitHostedPairingRequest();
  }, [submitHostedPairingRequest]);

  const request = hostedPairingRequestRef.current;

  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title={
          status === "paired" ? "后端已配对" : status === "error" ? "配对失败" : "正在配对后端"
        }
        description={message}
      />

      {request ? (
        <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          主机：<span className="font-mono text-foreground/80">{request.host}</span>
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="error" className="mt-5">
          <AlertDescription>
            请确认此后端可从此浏览器访问、支持面向托管客户端的 CORS，并且在从 HTTPS 打开此页面时通过
            HTTPS 提供服务。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "pairing" ? (
          <Button disabled size="sm">
            正在配对…
          </Button>
        ) : canRetry ? (
          <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
            重试
          </Button>
        ) : null}
        {status === "paired" ? (
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
            打开应用
          </Button>
        ) : null}
      </div>
    </StandalonePage>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "认证失败。";
}

function describeAuthGate(bootstrapMethods: ReadonlyArray<string>): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "此环境要求先提供受信任的配对凭据，应用才能连接。";
  }

  return "输入配对令牌，与该环境建立会话。";
}

function describeSupportedMethods(bootstrapMethods: ReadonlyArray<string>): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return "此环境同时接受桌面端管理的配对和一次性配对令牌。";
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "此环境由桌面端管理。请从桌面应用打开它，或在明确签发了引导凭据时粘贴该凭据。";
  }

  return "此环境接受一次性配对令牌。配对链接可直接打开此页面，你也可以将令牌粘贴到这里。";
}
