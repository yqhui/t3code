import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export class DesktopApplicationMenuActionError extends Schema.TaggedError<DesktopApplicationMenuActionError>()(
  "DesktopApplicationMenuActionError",
  {
    action: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop menu action "${this.action}" failed.`;
  }
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  {
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog;

const { logInfo: logUpdaterInfo } = makeComponentLogger("desktop-updater");

const { logError: logMenuError } = makeComponentLogger("desktop-menu");

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action, {
    reveal: action !== "paste-as-text",
  });
});

const zoomMainWindow = Effect.fn("desktop.menu.zoomMainWindow")(function* (
  direction: DesktopWindow.MainWindowZoomDirection,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.zoomMain(direction);
});

const runMainContentsCommand = Effect.fn("desktop.menu.runMainContentsCommand")(function* (
  command: DesktopWindow.MainWindowContentsCommand,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.runMainContentsCommand(command);
});

const checkForUpdatesFromMenu = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const result = yield* updates.check("menu");
  const updateState = result.state;

  if (updateState.status === "up-to-date") {
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "已是最新版本",
      message: `T3 Code ${updateState.currentVersion} 已是当前可用的最新版本。`,
      buttons: ["确定"],
    });
  } else if (updateState.status === "error") {
    yield* electronDialog.showMessageBox({
      type: "warning",
      title: "检查更新失败",
      message: "无法检查更新。",
      detail: updateState.message ?? "发生未知错误。请稍后重试。",
      buttons: ["确定"],
    });
  }
}).pipe(Effect.withSpan("desktop.menu.checkForUpdates"));

const handleCheckForUpdatesMenuClick = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const disabledReason = yield* updates.disabledReason;
  if (Option.isSome(disabledReason)) {
    yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
      disabledReason: disabledReason.value,
    });
    yield* electronDialog.showMessageBox({
      type: "info",
      title: "更新不可用",
      message: "自动更新目前不可用。",
      detail: disabledReason.value,
      buttons: ["确定"],
    });
    return;
  }

  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.ensureMain;
  yield* checkForUpdatesFromMenu;
}).pipe(Effect.withSpan("desktop.menu.handleCheckForUpdatesClick"));

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) => {
          const error = new DesktopApplicationMenuActionError({ action, cause });
          return logMenuError(error.message, { error });
        }),
      ),
    );
  };

  const configure = Effect.gen(function* () {
    const checkForUpdatesClick = () => {
      runMenuEffect("check-for-updates", handleCheckForUpdatesMenuClick);
    };
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    // Chromium already pastes as plain text for this chord, so the accelerator
    // needs nothing from the menu: the composer and the terminal each arm
    // themselves from the same keydown. Routing it through the renderer anyway
    // lands a second, injected paste and doubles the text. Only a menu click,
    // which produces no keystroke for them to see, needs that round trip.
    const pasteAsTextClick = (
      _item: Electron.MenuItem,
      _window: Electron.BaseWindow | undefined,
      event: Electron.KeyboardEvent,
    ) => {
      if (event.triggeredByAccelerator === true) return;
      runMenuEffect("paste-as-text", dispatchMenuAction("paste-as-text"));
    };
    const zoomClick = (direction: DesktopWindow.MainWindowZoomDirection) => () => {
      runMenuEffect(`zoom-${direction}`, zoomMainWindow(direction));
    };
    const mainContentsClick = (command: DesktopWindow.MainWindowContentsCommand) => () => {
      runMenuEffect(command, runMainContentsCommand(command));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: environment.displayName,
        submenu: [
          { role: "about", label: `关于 ${environment.displayName}` },
          {
            label: "检查更新…",
            click: checkForUpdatesClick,
          },
          { type: "separator" },
          {
            label: "设置…",
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services", label: "服务" },
          { type: "separator" },
          { role: "hide", label: `隐藏 ${environment.displayName}` },
          { role: "hideOthers", label: "隐藏其他应用" },
          { role: "unhide", label: "显示全部" },
          { type: "separator" },
          { role: "quit", label: `退出 ${environment.displayName}` },
        ],
      });
    }

    template.push(
      {
        label: "文件",
        submenu: [
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: "设置…",
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          {
            role: environment.platform === "darwin" ? "close" : "quit",
            label: environment.platform === "darwin" ? "关闭窗口" : "退出",
          },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo", label: "撤销" },
          { role: "redo", label: "重做" },
          { type: "separator" },
          { role: "cut", label: "剪切" },
          { role: "copy", label: "复制" },
          { role: "paste", label: "粘贴" },
          {
            label: "粘贴为纯文本",
            accelerator: "CmdOrCtrl+Shift+V",
            click: pasteAsTextClick,
          },
          { role: "delete", label: "删除" },
          { type: "separator" },
          { role: "selectAll", label: "全选" },
          ...(environment.platform === "darwin"
            ? [
                { type: "separator" as const },
                {
                  label: "语音",
                  submenu: [
                    { role: "startSpeaking" as const, label: "开始朗读" },
                    { role: "stopSpeaking" as const, label: "停止朗读" },
                  ],
                },
              ]
            : []),
        ],
      },
      {
        label: "视图",
        submenu: [
          /*
            Not the reload, DevTools or zoom roles: those act on the focused
            webContents, so with a browser page focused they reload or zoom
            the guest page and the app UI appears stuck. These always target
            the main window (see DesktopWindow.zoomMain).
          */
          { label: "重新加载", accelerator: "CmdOrCtrl+R", click: mainContentsClick("reload") },
          {
            label: "强制重新加载",
            accelerator: "Shift+CmdOrCtrl+R",
            click: mainContentsClick("forceReload"),
          },
          {
            label: "切换开发者工具",
            accelerator: environment.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
            click: mainContentsClick("toggleDevTools"),
          },
          { type: "separator" },
          { label: "实际大小", accelerator: "CmdOrCtrl+0", click: zoomClick("reset") },
          { label: "放大", accelerator: "CmdOrCtrl+=", click: zoomClick("in") },
          {
            label: "放大",
            accelerator: "CmdOrCtrl+Plus",
            visible: false,
            click: zoomClick("in"),
          },
          { label: "缩小", accelerator: "CmdOrCtrl+-", click: zoomClick("out") },
          { type: "separator" },
          { role: "togglefullscreen", label: "切换全屏" },
        ],
      },
      { role: "windowMenu", label: "窗口" },
      {
        role: "help",
        label: "帮助",
        submenu: [
          {
            label: "检查更新…",
            click: checkForUpdatesClick,
          },
        ],
      },
    );

    yield* electronMenu.setApplicationMenu(template);
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);
