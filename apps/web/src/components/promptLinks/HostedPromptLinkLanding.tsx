import {
  type LinkedPrompt,
  parseNewThreadLink,
  parseThreadLinkPrompt,
  promptLinkAppPath,
  promptLinkDeepLink,
} from "@t3tools/shared/promptLinks";
import { useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isHostedStaticApp } from "~/hostedPairing";
import { useEnvironments } from "~/state/environments";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";

const OPENER_STORAGE_KEY = "t3code:prompt-link-opener";
const Opener = Schema.NullOr(Schema.Literals(["app", "browser"]));
const DOWNLOAD_URL = "https://t3.codes/download";

interface LinkSummary {
  readonly prompt: LinkedPrompt | null;
  readonly details: ReadonlyArray<string>;
}

function summarize(
  appPath: string,
): { ok: true; value: LinkSummary } | { ok: false; error: string } {
  const url = new URL(appPath, window.location.origin);
  if (url.pathname !== "/new") {
    const prompt = parseThreadLinkPrompt(url.search);
    return prompt.ok
      ? { ok: true, value: { prompt: prompt.value, details: ["打开你的一个会话。"] } }
      : prompt;
  }
  const link = parseNewThreadLink(url.search);
  if (!link.ok) return link;
  if (link.value.kind === "pull-request") {
    const { owner, name, number } = link.value.pullRequest;
    return {
      ok: true,
      value: { prompt: link.value.prompt, details: [`拉取请求 ${owner}/${name}#${number}`] },
    };
  }
  const { repository, provider, model } = link.value;
  return {
    ok: true,
    value: {
      prompt: link.value.prompt,
      details: [
        repository ? `仓库 ${repository.owner}/${repository.name}` : "无项目",
        ...(provider ? [`模型 ${model ? `${provider} ${model}` : provider}`] : []),
      ],
    },
  };
}

/**
 * On app.t3.codes a prompt link first asks where to open: the installed desktop or mobile app
 * (through `t3code://`), this browser when it is connected to a machine, or the download page.
 * Returns that page, or null when the link should open in this browser as usual.
 */
export function useHostedPromptLinkLanding(enabled: boolean): ReactNode | null {
  const href = useLocation({ select: (location) => location.href });
  const { environments, isReady } = useEnvironments();
  const [opener, setOpener] = useLocalStorage(OPENER_STORAGE_KEY, null, Opener);
  const [continuedHref, setContinuedHref] = useState<string | null>(null);
  const appPath = useMemo(
    () =>
      enabled && isHostedStaticApp()
        ? promptLinkAppPath(new URL(href, window.location.origin).href, window.location.origin)
        : null,
    [enabled, href],
  );
  if (appPath === null || continuedHref === href) return null;
  const canContinue = isReady && environments.length > 0;
  if (opener === "browser") {
    if (canContinue) return null;
    // Blank until the machines load, so a remembered choice does not flash this page.
    if (!isReady) return <></>;
  }
  return (
    <HostedPromptLinkLanding
      appPath={appPath}
      canContinue={canContinue}
      openInAppRemembered={opener === "app"}
      onChoose={(choice, remember) => {
        if (remember) setOpener(choice);
        if (choice === "browser") setContinuedHref(href);
      }}
    />
  );
}

function HostedPromptLinkLanding({
  appPath,
  canContinue,
  openInAppRemembered,
  onChoose,
}: {
  readonly appPath: string;
  readonly canContinue: boolean;
  readonly openInAppRemembered: boolean;
  readonly onChoose: (choice: "app" | "browser", remember: boolean) => void;
}) {
  const summary = useMemo(() => summarize(appPath), [appPath]);
  const [remember, setRemember] = useState(false);
  const deepLink = promptLinkDeepLink(appPath);
  const onPhone = /android|iphone|ipad/i.test(navigator.userAgent);
  const autoOpenedRef = useRef(false);

  // After "remember", later links hand straight to the app. The page stays as the way back
  // when the app is not installed on this device.
  useEffect(() => {
    if (!openInAppRemembered || !summary.ok || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    window.location.href = deepLink;
  }, [deepLink, openInAppRemembered, summary.ok]);

  if (!summary.ok) {
    return (
      <StandalonePage tone="error">
        <StandalonePageHeader
          eyebrow={APP_DISPLAY_NAME}
          title="无法打开链接"
          description={summary.error}
        />
      </StandalonePage>
    );
  }

  const { prompt, details } = summary.value;
  return (
    <StandalonePage tone="brand">
      <StandalonePageHeader
        eyebrow={APP_DISPLAY_NAME}
        title="打开此 Prompt"
        description="它将作为草稿打开。在你点击“发送”之前不会运行任何内容。"
      />
      {prompt !== null && prompt.hiddenCharacters > 0 ? (
        <Alert className="mt-5" variant="error">
          <AlertTitle>此 Prompt 含有隐藏字符，可能存在恶意内容</AlertTitle>
          <AlertDescription>
            T3 Code 已移除 {prompt.hiddenCharacters} 个隐藏字符。发送前请先阅读此 Prompt。
          </AlertDescription>
        </Alert>
      ) : null}
      {prompt !== null ? (
        <pre className="mt-5 max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 text-sm whitespace-pre-wrap">
          {prompt.text}
        </pre>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">{details.join(" · ")}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button render={<a href={deepLink} />} onClick={() => onChoose("app", remember)}>
          {onPhone ? "在应用中打开" : "在桌面应用中打开"}
        </Button>
        {canContinue ? (
          <Button variant="outline" onClick={() => onChoose("browser", remember)}>
            在此处继续
          </Button>
        ) : null}
        <Button variant="ghost" render={<a href={DOWNLOAD_URL} />}>
          获取 T3 Code
        </Button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
        记住我的选择
      </label>
    </StandalonePage>
  );
}
