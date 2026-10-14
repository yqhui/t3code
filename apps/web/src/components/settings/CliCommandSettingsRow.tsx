import type { DesktopCliCommandState } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Settings → `t3` command: puts the desktop app's bundled CLI on PATH, or takes
 * it off again. Hidden where the desktop build has no launcher to install.
 */
export function CliCommandSettingsRow() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.cliCommand;
  const [state, setState] = useState<DesktopCliCommandState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const change = useCallback(
    (action: "install" | "uninstall") => {
      if (!bridge || pending) return;
      setPending(true);
      void bridge[action]()
        .then(setState)
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: action === "install" ? "无法安装 t3" : "无法移除 t3",
              description: error instanceof Error ? error.message : "出现了一些问题。",
            }),
          );
        })
        .finally(() => setPending(false));
    },
    [bridge, pending],
  );

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? `新终端中会优先运行位于 ${state.shadowedBy} 的另一个 t3。请将其移除以使用 T3 Code 的版本。`
    : !installed
      ? "在任何终端中以 `t3` 运行 T3 Code 的 CLI。"
      : state.onPath
        ? `已安装到 ${state.installedPath}。打开一个新终端即可使用。`
        : `已安装到 ${state.installedPath}，但尚未加入 PATH。请将其所在文件夹加入 PATH 以运行 \`t3\`。`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? "移除" : "安装"}
        </Button>
      }
    />
  );
}
