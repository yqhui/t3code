import { useAtomValue } from "@effect/atom-react";
import { sessionHasLegacyPermissions, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { useEnvironments } from "../state/environments";
import { environmentSession } from "../state/session";
import { toastManager } from "./ui/toast";

// Keep an active toast across remounts, including Strict Mode effect replay.
const shown = new Set<EnvironmentId>();

function EnvironmentPermissionNotice({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const session = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  const navigate = useNavigate();
  useEffect(() => {
    if (
      session._tag !== "Success" ||
      session.waiting ||
      !sessionHasLegacyPermissions(session.value)
    )
      return;
    if (shown.has(environmentId)) return;
    const key = `t3code:permission-update:v1:${environmentId}`;
    try {
      if (getLocalStorageItem(key, Schema.Boolean)) return;
    } catch {
      // An unavailable store must not prevent the notice.
    }
    shown.add(environmentId);
    const persistDismissal = () => {
      try {
        setLocalStorageItem(key, true, Schema.Boolean);
      } catch {
        // The in-memory marker still prevents repeats during this launch.
      }
    };
    const dismiss = () => {
      persistDismissal();
      toastManager.close(id);
    };
    const id = toastManager.add({
      title: `${label} 的权限已更改`,
      description: "此连接仍使用旧权限，部分操作可能不再可用。请使用具备所需权限的新链接重新配对。",
      timeout: 0,
      onClose: persistDismissal,
      actionProps: {
        children: "打开连接设置",
        onClick: () => {
          dismiss();
          void navigate({ to: "/settings/connections" });
        },
      },
      data: {
        actionLayout: "stacked-end",
        secondaryActionProps: { children: "Dismiss", onClick: dismiss },
        secondaryActionVariant: "ghost",
      },
    });
  }, [environmentId, label, navigate, session]);
  return null;
}

export function PermissionUpdateNotice() {
  const { environments } = useEnvironments();
  return environments.map(({ environmentId, label }) => (
    <EnvironmentPermissionNotice key={environmentId} environmentId={environmentId} label={label} />
  ));
}
