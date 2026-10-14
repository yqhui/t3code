import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectScript,
  type ProjectScriptIcon,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  BugIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  WrenchIcon,
} from "lucide-react";
import React, {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import { keybindingFromKeyboardEvent } from "~/components/settings/KeybindingsSettings.logic";
import { commandForProjectScript, nextProjectScriptId } from "~/projectScripts";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useComposerMenuState } from "./chat/useComposerMenuState";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "运行" },
  { id: "test", label: "测试" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "配置" },
  { id: "build", label: "构建" },
  { id: "debug", label: "调试" },
];

export function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  /** Setup scripts only: hold the agent until the script exits. */
  waitForSetup: boolean;
  runOnSettle: boolean;
  /** Omit to preserve the current shortcut when the form did not edit it. */
  keybinding?: string | null;
  /** Optional URL to open in the in-app preview when this script runs. */
  previewUrl: string | null;
  /** When true, automatically open the preview panel pointed at `previewUrl`. */
  autoOpenPreview: boolean;
}

export type ProjectScriptActionResult = AtomCommandResult<void, unknown>;

export const EMPTY_PROJECT_SCRIPT_INPUT: NewProjectScriptInput = {
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  waitForSetup: false,
  runOnSettle: false,
  keybinding: null,
  previewUrl: null,
  autoOpenPreview: false,
};

/** What the editor dialog should open with. `scriptId: null` means "add". */
export interface ProjectScriptEditorRequest {
  scriptId: string | null;
  initial: NewProjectScriptInput;
  /** Validation error to show immediately (e.g. a failed t3.json import). */
  error?: string;
}

export function editorRequestForScript(
  script: ProjectScript,
  keybindings: ResolvedKeybindingsConfig,
): ProjectScriptEditorRequest {
  return {
    scriptId: script.id,
    initial: {
      name: script.name,
      command: script.command,
      icon: script.icon,
      runOnWorktreeCreate: script.runOnWorktreeCreate,
      waitForSetup: script.runOnWorktreeCreate && script.async === false,
      runOnSettle: script.runOnSettle ?? false,
      keybinding: keybindingValueForCommand(keybindings, commandForProjectScript(script.id)),
      previewUrl: script.previewUrl ?? null,
      autoOpenPreview: script.autoOpenPreview ?? false,
    },
  };
}

/**
 * Add/edit dialog for a project script, shared by the chat-header scripts menu
 * and the project settings page. The parent owns which script (if any) is
 * being edited via `request`; the dialog owns the form state and validation.
 */
export function ProjectScriptEditorDialog({
  environmentId,
  editScope = AuthOrchestrationOperateScope,
  request,
  scripts,
  onSubmit,
  onDelete,
  onClose,
}: {
  environmentId: EnvironmentId;
  editScope?: typeof AuthOrchestrationOperateScope | typeof AuthSettingsWriteScope;
  request: ProjectScriptEditorRequest | null;
  /** Existing scripts, used to derive a unique id for new scripts. */
  scripts: ReadonlyArray<ProjectScript>;
  onSubmit: (
    scriptId: string | null,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDelete: (scriptId: string) => void;
  onClose: () => void;
}) {
  const canEditActions = useEnvironmentScope(environmentId, editScope);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const formId = React.useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useComposerMenuState(!canEditActions);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [runOnSettle, setRunOnSettle] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useComposerMenuState(!canEditActions);
  const [savingRequest, setSavingRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const pendingSubmissionRef = useRef<{ request: ProjectScriptEditorRequest } | null>(null);

  const isOpen = request !== null;
  const isEditing = request?.scriptId != null;
  const isSaving = request !== null && savingRequest === request;

  // A save completion must not affect a replacement request or an unmounted editor.
  useLayoutEffect(
    () => () => {
      if (pendingSubmissionRef.current?.request === request) {
        pendingSubmissionRef.current = null;
      }
    },
    [request],
  );

  // Hydrate the form whenever a new request opens the dialog.
  useEffect(() => {
    if (!request) return;
    setName(request.initial.name);
    setCommand(request.initial.command);
    setIcon(request.initial.icon);
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(request.initial.runOnWorktreeCreate);
    setWaitForSetup(request.initial.waitForSetup);
    setRunOnSettle(request.initial.runOnSettle);
    setKeybinding(request.initial.keybinding ?? "");
    setPreviewUrl(request.initial.previewUrl ?? "");
    setAutoOpenPreview(request.initial.autoOpenPreview);
    setValidationError(request.error ?? null);
    setSavingRequest(null);
  }, [request, setIconPickerOpen]);

  const close = () => {
    pendingSubmissionRef.current = null;
    setSavingRequest(null);
    setIconPickerOpen(false);
    onClose();
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!readEnvironmentScope(environmentId, editScope)) return;
    if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return;
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromKeyboardEvent(event, navigator.platform);
    if (!next) return;
    setKeybinding(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || pendingSubmissionRef.current !== null) return;
    if (!readEnvironmentScope(environmentId, editScope)) {
      setValidationError("此连接无法更改项目操作。");
      return;
    }
    const changesKeybinding =
      (keybinding.trim() || null) !== (request.initial.keybinding?.trim() || null);
    const canChangeKeybinding = readEnvironmentScope(environmentId, AuthSettingsWriteScope);
    if (changesKeybinding && !canChangeKeybinding) {
      setValidationError("此连接无法更改键盘快捷键。");
      return;
    }
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("名称不能为空。");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("命令不能为空。");
      return;
    }

    setValidationError(null);
    let payload: NewProjectScriptInput;
    try {
      const scriptIdForValidation =
        request.scriptId ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const trimmedPreviewUrl = previewUrl.trim();
      payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        waitForSetup: runOnWorktreeCreate && waitForSetup,
        runOnSettle,
        ...((request.scriptId === null && canChangeKeybinding) || changesKeybinding
          ? { keybinding: keybindingRule?.key ?? null }
          : {}),
        previewUrl: trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview: trimmedPreviewUrl.length > 0 ? autoOpenPreview : false,
      } satisfies NewProjectScriptInput;
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "保存操作失败。");
      return;
    }

    const submission = { request };
    pendingSubmissionRef.current = submission;
    setSavingRequest(request);
    setIconPickerOpen(false);
    try {
      const result = await onSubmit(request.scriptId, payload);
      if (pendingSubmissionRef.current === submission) {
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            setValidationError(error instanceof Error ? error.message : "保存操作失败。");
          }
        } else {
          close();
        }
      }
    } catch (error) {
      if (pendingSubmissionRef.current === submission) {
        setValidationError(error instanceof Error ? error.message : "保存操作失败。");
      }
    }
    if (pendingSubmissionRef.current === submission) {
      pendingSubmissionRef.current = null;
      setSavingRequest(null);
    }
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "编辑操作" : "添加操作"}</DialogTitle>
            <DialogDescription>
              操作是项目内的命令，可以通过顶部栏或键盘快捷键运行。
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} onSubmit={submit}>
              <fieldset className="space-y-4" disabled={isSaving || !canEditActions}>
                <div className="space-y-1.5">
                  <Label htmlFor="script-name">名称</Label>
                  <div className="flex items-center gap-2">
                    <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            className="size-9 shrink-0"
                            aria-label="选择图标"
                          />
                        }
                      >
                        <ScriptIcon icon={icon} className="size-4.5" />
                      </PopoverTrigger>
                      <PopoverPopup align="start">
                        <div className="grid grid-cols-3 gap-2">
                          {SCRIPT_ICONS.map((entry) => {
                            const isSelected = entry.id === icon;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs dark:border-transparent ${
                                  isSelected
                                    ? "border-primary/70 bg-primary/10 ring-inset dark:ring-1 dark:ring-primary/30"
                                    : "border-border/70 hover:bg-accent/60 dark:bg-white/[0.035]"
                                }`}
                                onClick={() => {
                                  setIcon(entry.id);
                                  setIconPickerOpen(false);
                                }}
                              >
                                <ScriptIcon icon={entry.id} className="size-4" />
                                <span>{entry.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverPopup>
                    </Popover>
                    <Input
                      id="script-name"
                      autoFocus
                      placeholder="测试"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-keybinding">键盘快捷键</Label>
                  <Input
                    disabled={!canWriteSettings}
                    id="script-keybinding"
                    placeholder="按下快捷键"
                    value={keybinding}
                    readOnly
                    onKeyDown={captureKeybinding}
                  />
                  <p className="text-xs text-muted-foreground">
                    按下快捷键。使用 <code>Backspace</code> 清除。快捷键在整个
                    环境中生效。使用相同操作的项目共用快捷键。
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-command">命令</Label>
                  <Textarea
                    id="script-command"
                    placeholder="bun test"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-preview-url">预览 URL（可选）</Label>
                  <Input
                    id="script-preview-url"
                    placeholder="http://localhost:5173"
                    value={previewUrl}
                    onChange={(event) => setPreviewUrl(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    运行此操作时在应用内预览中打开此 URL。
                  </p>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
                  <span>创建 Worktree 时自动运行</span>
                  <Switch
                    checked={runOnWorktreeCreate}
                    onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                  />
                </label>
                <label
                  className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                    runOnWorktreeCreate ? "" : "opacity-60"
                  }`}
                >
                  <span>等待其完成后再启动 Agent</span>
                  <Switch
                    checked={waitForSetup}
                    disabled={!runOnWorktreeCreate}
                    onCheckedChange={(checked) => setWaitForSetup(Boolean(checked))}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
                  <span>会话标记为已处理时，在其 Worktree 中运行</span>
                  <Switch
                    checked={runOnSettle}
                    onCheckedChange={(checked) => setRunOnSettle(Boolean(checked))}
                  />
                </label>
                <label
                  className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                    previewUrl.trim().length === 0 ? "opacity-60" : ""
                  }`}
                >
                  <span>运行此操作时自动打开预览</span>
                  <Switch
                    checked={autoOpenPreview}
                    disabled={previewUrl.trim().length === 0}
                    onCheckedChange={(checked) => setAutoOpenPreview(Boolean(checked))}
                  />
                </label>
                {validationError && <p className="text-sm text-destructive">{validationError}</p>}
              </fieldset>
            </form>
          </DialogPanel>
          <DialogFooter variant="bare">
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                disabled={isSaving || !canEditActions}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                删除
              </Button>
            )}
            <Button type="button" variant="outline" onClick={close}>
              取消
            </Button>
            <Button form={formId} type="submit" disabled={isSaving || !canEditActions}>
              {isSaving ? "正在保存…" : isEditing ? "保存更改" : "保存操作"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen && canEditActions} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>删除操作 "{name}"？</AlertDialogTitle>
            <AlertDialogDescription>此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={isSaving || !canEditActions}
              onClick={() => {
                if (!request?.scriptId) return;
                if (!readEnvironmentScope(environmentId, editScope)) {
                  setValidationError("此连接无法更改项目操作。");
                  return;
                }
                setDeleteConfirmOpen(false);
                close();
                onDelete(request.scriptId);
              }}
            >
              删除操作
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
