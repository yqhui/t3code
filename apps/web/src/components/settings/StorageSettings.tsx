import type {
  StorageCleanupReport,
  StorageCleanupSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatBytes } from "../../lib/formatBytes";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsGroup } from "./SettingsGroup";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function WorktreesDirectoryRow() {
  const { connectedEnvironments, targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreesDirectory"]);
  const edited = useRef(false);
  if (
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.worktreesDirectory !== true,
    )
  )
    return null;
  const scopeKey = targets.map((target) => target.environmentId).join(",");

  return (
    <SettingsRow
      {...searchableSetting("storage-worktrees-location")}
      description={
        "创建新 Worktree 的文件夹，可位于任意驱动器，例如 D:\\worktrees 或 ~/worktrees。已有 Worktree 的位置不变。留空时使用 T3 主目录。"
      }
      serverScoped
      settingKeys={["worktreesDirectory"]}
      resetAction={
        mixed || settings.worktreesDirectory !== "" ? (
          <SettingResetButton
            label="Worktree 位置"
            onClick={() => updateSettings({ worktreesDirectory: "" })}
          />
        ) : null
      }
      control={
        <Input
          key={`${scopeKey}:${mixed}:${settings.worktreesDirectory}`}
          aria-label="Worktree 位置"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={mixed ? "混合" : "默认"}
          defaultValue={mixed ? "" : settings.worktreesDirectory}
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.worktreesDirectory))
              updateSettings({ worktreesDirectory: value });
            edited.current = false;
          }}
        />
      }
    />
  );
}

function RetentionControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={1}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(1, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`减小${label}`} />
            <NumberFieldInput
              aria-label={`${label}（天）`}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              天
            </span>
            <NumberFieldIncrement aria-label={`增大${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">关闭</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

const KEEP_WHEN_LABELS = {
  "any-local-files": "任何本地文件",
  "uncommitted-changes": "未提交的更改",
  "tracked-changes": "已修改的跟踪文件",
} as const;

function CleanupResults({
  report,
  environmentLabel,
}: {
  report: StorageCleanupReport;
  environmentLabel: string | undefined;
}) {
  return (
    <>
      {report.entries.map((entry, index) => {
        const name =
          entry.kind === "worktree"
            ? (entry.path?.split(/[\\/]/).findLast(Boolean) ?? "Worktree")
            : entry.kind === "logs"
              ? "轮转日志"
              : "浏览器产物";
        return (
          <SettingsRow
            key={`${entry.path ?? entry.kind}:${entry.threadId ?? index}`}
            title={environmentLabel ? `${environmentLabel}: ${name}` : name}
            description={
              <span
                className={`wrap-anywhere ${entry.outcome === "failed" ? "text-destructive" : ""}`}
              >
                {entry.threadTitle && entry.threadTitle !== name ? `${entry.threadTitle}. ` : ""}
                {entry.reason}
              </span>
            }
            control={
              entry.outcome === "removed" && (
                <span className="text-xs text-muted-foreground">
                  {[
                    entry.kind !== "worktree" && entry.files !== null
                      ? `${entry.files.toLocaleString()} 个文件`
                      : null,
                    entry.bytes !== null ? formatBytes(entry.bytes) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )
            }
          />
        );
      })}
      {report.omittedCount > 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {environmentLabel ? `${environmentLabel}: ` : ""}
          还有 {report.omittedCount.toLocaleString()} 项结果。
        </p>
      )}
      {report.entries.length === 0 && report.omittedCount === 0 && (
        <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
          {environmentLabel ? `${environmentLabel}: ` : ""}没有需要清理的内容。
        </p>
      )}
    </>
  );
}

function CleanupSection() {
  useRelativeTimeTick(60_000);
  const { connectedEnvironments } = useSettingsScope();
  const [pending, setPending] = useState(false);
  const run = useAtomCommand(serverEnvironment.runStorageCleanup);
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
  );
  const state = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) =>
          connectedEnvironments.flatMap((environment) => {
            if (environment.serverConfig?.environment.capabilities.storageCleanupRun !== true)
              return [];
            const query = get(
              serverEnvironment.storageCleanupReport({
                environmentId: environment.environmentId,
                input: {},
              }),
            );
            return [
              {
                environmentId: environment.environmentId,
                allowed: get(
                  serverEnvironment.runStorageCleanup.permissionAtom(environment.environmentId),
                ),
                report: query._tag === "Success" ? query.value : null,
                loading: query.waiting,
                failed: query._tag === "Failure",
              },
            ];
          }),
        ),
      [connectedEnvironments],
    ),
  );
  const hasRules = supported.some((environment) => {
    const settings = environment.serverConfig?.settings;
    if (!settings) return false;
    const enabled = (rules: WorktreeCleanupRules) =>
      rules.worktreeAfterDays !== null ||
      rules.worktreeOnMerge ||
      rules.worktreeOnDelete ||
      rules.worktreeUnchanged;
    return (
      settings.storageCleanup.browserArtifactsAfterDays !== null ||
      settings.storageCleanup.logsAfterDays !== null ||
      enabled(resolveWorktreeCleanup(settings, null)) ||
      Object.values(settings.projectSettingsOverrides).some(
        (override) =>
          override.worktreeCleanup?.mode === "custom" && enabled(override.worktreeCleanup.rules),
      )
    );
  });
  if (supported.length === 0) return null;
  const summaries = supported.map((environment) => {
    const query = state.find((entry) => entry.environmentId === environment.environmentId);
    const report = query?.report ?? null;
    return {
      environment,
      report,
      description: report
        ? `上次运行于 ${formatRelativeTimeLabel(report.finishedAt)}。已释放 ${formatBytes(report.bytesFreed)}。${report.counts.failed > 0 ? ` 有 ${report.counts.failed} 项无法移除。` : ""}`
        : query?.failed
          ? "无法加载上次运行记录。"
          : query?.loading
            ? "正在加载上次运行记录…"
            : "尚未运行清理。",
    };
  });
  const deleteNow = async () => {
    if (pending) return;
    setPending(true);
    try {
      await Promise.all(
        supported
          .filter((environment) =>
            state.some(
              (entry) => entry.environmentId === environment.environmentId && entry.allowed,
            ),
          )
          .map(async (environment) => {
            const result = await run({ environmentId: environment.environmentId, input: {} });
            if (result._tag === "Success") {
              const failures = result.value.entries.filter((entry) => entry.outcome === "failed");
              if (failures.length > 0)
                toastManager.add({
                  type: "error",
                  title: `${environment.label} 上的清理失败`,
                  description: failures[0]!.reason,
                });
            } else if (!isAtomCommandInterrupted(result)) {
              toastManager.add({
                type: "error",
                title: `无法在 ${environment.label} 上运行清理`,
                description: String(squashAtomCommandFailure(result)),
              });
            }
          }),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <SettingsSection id="storage-cleanup" title="清理" variant="plain">
      <SettingsGroup>
        <SettingsRow
          {...searchableSetting("storage-delete-now")}
          description={
            <span>
              {!hasRules
                ? "请启用一条清理规则以使用此功能。"
                : summaries.map(({ environment, description }) => (
                    <span key={environment.environmentId} className="block">
                      {supported.length > 1 ? `${environment.label}: ` : ""}
                      {description}
                    </span>
                  ))}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !hasRules || !state.some((entry) => entry.allowed)}
              onClick={() => void deleteNow()}
            >
              {pending ? "正在删除…" : "立即删除"}
            </Button>
          }
        />
      </SettingsGroup>
      {summaries.some(({ report }) => report !== null) && (
        <FoldedSettingsSection
          id="storage-cleanup-last-run"
          title="上次运行"
          headerPlacement="inside"
          summary={summaries
            .flatMap(({ environment, report }) =>
              report
                ? [
                    `${connectedEnvironments.length > 1 ? `${environment.label}: ` : ""}已移除 ${report.counts.removed} 项，保留 ${report.counts.kept} 项${report.counts.failed > 0 ? `，失败 ${report.counts.failed} 项` : ""}`,
                  ]
                : [],
            )
            .join(" · ")}
        >
          {summaries.map(
            ({ environment, report }) =>
              report && (
                <CleanupResults
                  key={environment.environmentId}
                  report={report}
                  environmentLabel={
                    connectedEnvironments.length > 1 ? environment.label : undefined
                  }
                />
              ),
          )}
        </FoldedSettingsSection>
      )}
    </SettingsSection>
  );
}

export function StorageSettingsPanel() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? "选定机器的设置不同"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice target="all">
        请更新选定机器以配置项目的 Worktree 清理。
      </SettingsScopeNotice>
    );
  }

  if (
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId)}
      >
        请更新选定环境以使用存储清理，或选择支持此功能的机器。
      </SettingsScopeNotice>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection id="storage-worktrees" title="Worktree">
        {!isProjectScope && <WorktreesDirectoryRow />}
        {isProjectScope && (
          <SettingsRow
            title="自动清理 Worktree"
            description={
              mode === "off"
                ? "保留此项目的 Worktree，直到手动删除。"
                : mode === "custom"
                  ? "为此项目使用这些规则。"
                  : "使用各机器的 Worktree 清理设置。"
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label="自动清理 Worktree">
                  <SelectValue>
                    {mixedModes
                      ? "混合"
                      : mode === "inherit"
                        ? "继承"
                        : mode === "off"
                          ? "关闭"
                          : "自定义"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">继承</SelectItem>
                  <SelectItem value="off">关闭</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title="删除已删除会话的 Worktree"
              status={ruleStatus("worktreeOnDelete")}
              description="删除活跃或已归档会话时，移除不再使用的 Worktree。有本地更改的 Worktree 会保留。"
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="删除已删除会话的 Worktree"
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title="删除闲置 Worktree"
              status={ruleStatus("worktreeAfterDays")}
              description="会话闲置达到此天数后移除其 Worktree。分支和会话历史会保留。"
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label="删除闲置 Worktree"
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <SettingsRow
              title="删除已合并的 Worktree"
              status={ruleStatus("worktreeOnMerge")}
              description="移除拉取请求已合并且 Commit 已包含在默认分支中的 Worktree。"
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="删除已合并的 Worktree"
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title="删除未更改的 Worktree"
              status={ruleStatus("worktreeUnchanged")}
              description="移除相较于默认分支没有新增 Commit 的 Worktree。"
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="删除未更改的 Worktree"
                  checked={settings.worktreeUnchanged}
                  onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                />
              }
            />
            {connectedEnvironments.every(
              (environment) =>
                environment.serverConfig?.environment.capabilities.storageCleanupRun === true,
            ) && (
              <SettingsRow
                {...searchableSetting("storage-worktree-keep-when")}
                status={ruleStatus("worktreeKeepWhen")}
                description={
                  settings.worktreeKeepWhen === "any-local-files"
                    ? "包含被忽略的文件，但不包含 node_modules。"
                    : settings.worktreeKeepWhen === "tracked-changes"
                      ? "删除未跟踪和被忽略的文件，包括 .env。"
                      : "保留更改和未跟踪文件。删除被忽略的文件，包括 .env。"
                }
                serverScoped={!isProjectScope}
                control={
                  <Select
                    value={ruleStatus("worktreeKeepWhen") ? null : settings.worktreeKeepWhen}
                    onValueChange={(next) => {
                      if (
                        next === "any-local-files" ||
                        next === "uncommitted-changes" ||
                        next === "tracked-changes"
                      )
                        updateWorktree({ worktreeKeepWhen: next });
                    }}
                  >
                    <SelectTrigger size="sm" aria-label="保留有本地更改的 Worktree">
                      <SelectValue>
                        {ruleStatus("worktreeKeepWhen")
                          ? "混合"
                          : KEEP_WHEN_LABELS[settings.worktreeKeepWhen]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="any-local-files">任何本地文件</SelectItem>
                      <SelectItem value="uncommitted-changes">未提交的更改</SelectItem>
                      <SelectItem value="tracked-changes">已修改的跟踪文件</SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
            )}
          </>
        )}
      </SettingsSection>

      {!isProjectScope && (
        <SettingsSection id="storage-artifacts" title="产物和日志">
          <SettingsRow
            title="删除旧浏览器产物"
            status={ruleStatus("browserArtifactsAfterDays")}
            description="保存的浏览器截图达到此天数后删除。较早的截图链接将无法打开。"
            serverScoped
            control={
              <RetentionControl
                label="删除旧浏览器产物"
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title="删除旧轮转日志"
            status={ruleStatus("logsAfterDays")}
            description="不再活跃的轮转日志文件达到此天数后删除。当前日志会保留。"
            serverScoped
            control={
              <RetentionControl
                label="删除旧轮转日志"
                value={settings.logsAfterDays}
                onChange={(logsAfterDays) => update({ logsAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
      {!isProjectScope && <CleanupSection />}
    </SettingsPageContainer>
  );
}
