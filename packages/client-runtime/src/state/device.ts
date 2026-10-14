import { type DeviceToolVersions, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createDeviceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { environmentId: string }) => environmentId,
  };
  return {
    /** Server-pushed device hosts, devices, and open sessions for one environment. */
    state: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:device:state",
      tag: WS_METHODS.subscribeDeviceState,
    }),
    configure: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:configure",
      tag: WS_METHODS.deviceConfigure,
      scheduler,
      concurrency,
    }),
    testHost: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:test-host",
      tag: WS_METHODS.deviceTestHost,
    }),
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:list",
      tag: WS_METHODS.deviceList,
      scheduler,
      concurrency,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:open",
      tag: WS_METHODS.deviceOpen,
      scheduler,
      concurrency,
    }),
    close: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:close",
      tag: WS_METHODS.deviceClose,
      scheduler,
      concurrency,
    }),
    shutdown: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:shutdown",
      tag: WS_METHODS.deviceShutdown,
      scheduler,
      concurrency,
    }),
    detail: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:detail",
      tag: WS_METHODS.deviceDetail,
      scheduler,
      concurrency,
    }),
    action: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:device:action",
      tag: WS_METHODS.deviceAction,
      scheduler,
      concurrency,
    }),
  };
}

/** Unknown inventory is distinct from a completed check that found no install. */
export function deviceToolVersionLabels(tools: DeviceToolVersions | undefined) {
  if (!tools) return ["尚未检查设备工具版本。"];
  return (
    [
      ["Device Hub", tools.hub],
      ["Agent 工具", tools.agent],
    ] as const
  ).map(([name, tool]) => {
    const installed = tool.installedVersions.length ? tool.installedVersions.join(", ") : "无";
    return `${name}：已安装 ${installed}；需要 ${tool.requiredVersion}${tool.runningVersion ? `；正在运行 ${tool.runningVersion}` : ""}。`;
  });
}

export function deviceToolUpdatePolicy(tools: DeviceToolVersions | undefined) {
  if (!tools) return "尚未检查版本。请重新连接主机并检查版本。";
  const outdated = [tools.hub, tools.agent].filter(
    (tool) =>
      tool.installedVersions.length > 0 && !tool.installedVersions.includes(tool.requiredVersion),
  );
  return outdated.length > 0
    ? "更新待生效。所需工具将在下次使用时自动安装。主机需要网络连接；不会回退使用旧版本。"
    : "所需工具会在需要时自动安装。检查版本不会安装或启动任何内容。";
}
export const deviceToolUpdateOwnership =
  "此环境的 T3 服务器会为其自身及其 SSH 主机选择设备工具版本。更新该服务器才能获得更新的工具版本；仅更新浏览器或移动应用不会更新远程服务器。";
