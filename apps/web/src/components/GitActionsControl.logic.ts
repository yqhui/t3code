import type {
  GitRunStackedActionResult,
  GitStackedAction,
  VcsStatusResult,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { ChangeRequestTerminology } from "@t3tools/client-runtime/source-control-clients";

export type GitActionIconName = "commit" | "push" | "pr";

export type GitDialogAction = "commit" | "push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_publish" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export interface GitActionProgressPresentation {
  readonly status: string;
  readonly output: string | null;
  readonly startedAtMs: number | null;
}

export interface GitActionResultToastTiming {
  readonly timeout: 0;
  readonly dismissAfterVisibleMs: number | null;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export const GIT_ACTION_SUCCESS_VISIBLE_MS = 10_000;

export function resolveGitActionResultToastTiming(
  type: "error" | "success",
): GitActionResultToastTiming {
  return {
    timeout: 0,
    dismissAfterVisibleMs: type === "success" ? GIT_ACTION_SUCCESS_VISIBLE_MS : null,
  };
}

function resolveChangeRequestTerminology(
  gitStatus: VcsStatusResult | null,
): ChangeRequestTerminology {
  return sourceControlClients.get(gitStatus?.sourceControlProvider?.kind).changeRequest;
}

export function resolveGitActionProgressPresentation(input: {
  readonly isRunning: boolean;
  readonly operation: string | null;
  readonly currentLabel: string | null;
  readonly lastOutputLine: string | null;
  readonly phaseStartedAtMs: number | null;
  readonly hookStartedAtMs: number | null;
}): GitActionProgressPresentation | null {
  if (
    !input.isRunning ||
    (input.operation !== "run_change_request" && input.operation !== "pull")
  ) {
    return null;
  }

  const currentLabel = input.currentLabel?.trim();
  const output = input.lastOutputLine?.trim();
  const isPull = input.operation === "pull";
  return {
    status:
      currentLabel && currentLabel !== "Running source control action"
        ? currentLabel
        : isPull
          ? "正在拉取最新更改…"
          : "正在启动源代码管理操作…",
    output: !isPull && output ? output : null,
    startedAtMs: isPull
      ? input.phaseStartedAtMs
      : (input.hookStartedAtMs ?? input.phaseStartedAtMs),
  };
}

export function formatGitActionElapsed(startedAtMs: number | null, nowMs: number): string | null {
  if (startedAtMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function buildGitActionProgressStages(input: {
  action: GitStackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  pushTarget?: string;
  featureBranch?: boolean;
  shouldPushBeforePr?: boolean;
  terminology?: ChangeRequestTerminology;
}): string[] {
  const terminology = input.terminology ?? sourceControlClients.get(undefined).changeRequest;
  const branchStages = input.featureBranch ? ["正在准备功能分支引用…"] : [];
  const pushStage = input.pushTarget ? `正在推送到 ${input.pushTarget}…` : "正在推送…";
  const prStages = [
    `正在准备 ${terminology.shortLabel}…`,
    `正在生成 ${terminology.shortLabel} 内容…`,
    `正在创建${terminology.singular}…`,
  ];

  if (input.action === "push") {
    return [pushStage];
  }
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, ...prStages] : prStages;
  }

  const shouldIncludeCommitStages = input.action === "commit" || input.hasWorkingTreeChanges;
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? ["正在提交…"]
      : ["正在生成提交消息…", "正在提交…"];
  if (input.action === "commit") {
    return [...branchStages, ...commitStages];
  }
  if (input.action === "commit_push") {
    return [...branchStages, ...commitStages, pushStage];
  }
  return [...branchStages, ...commitStages, pushStage, ...prStages];
}

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasPrimaryRemote = true,
): GitActionMenuItem[] {
  if (!gitStatus) return [];
  const terminology = resolveChangeRequestTerminology(gitStatus);

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const canPushWithoutUpstream = hasPrimaryRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasOpenPr &&
    hasDefaultBranchDelta &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);

  const commitItem: GitActionMenuItem = {
    id: "commit",
    label: "提交",
    disabled: !canCommit,
    icon: "commit",
    kind: "open_dialog",
    dialogAction: "commit",
  };

  if (!hasPrimaryRemote) {
    return [commitItem];
  }

  const pushItem: GitActionMenuItem = {
    id: "push",
    label: "推送",
    disabled: !canPush,
    icon: "push",
    kind: "open_dialog",
    dialogAction: "push",
  };

  // An open change request is surfaced by the standalone attribution row, so
  // the menu offers no change-request entry at all while one is open.
  if (hasOpenPr) {
    return [commitItem, pushItem];
  }

  return [
    commitItem,
    pushItem,
    {
      id: "pr",
      label: `创建 ${terminology.shortLabel}`,
      disabled: !canCreatePr,
      icon: "pr",
      kind: "open_dialog",
      dialogAction: "create_pr",
    },
  ];
}

export function resolveQuickAction(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  isDefaultRef = false,
  hasPrimaryRemote = true,
): GitQuickAction {
  if (isBusy) {
    return { label: "提交", disabled: true, kind: "show_hint", hint: "Git 操作正在进行中。" };
  }

  if (!gitStatus) {
    return {
      label: "提交",
      disabled: true,
      kind: "show_hint",
      hint: "Git 状态不可用。",
    };
  }

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  const terminology = resolveChangeRequestTerminology(gitStatus);

  if (!hasBranch) {
    return {
      label: "提交",
      disabled: true,
      kind: "show_hint",
      hint: `请先创建并检出引用，再推送或打开${terminology.singular}。`,
    };
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
      return { label: "提交", disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultRef) {
      return { label: "提交并推送", disabled: false, kind: "run_action", action: "commit_push" };
    }
    return {
      label: `提交、推送并创建 ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasPrimaryRemote) {
      return {
        label: "发布仓库",
        disabled: false,
        kind: "open_publish",
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return {
          label: "提交",
          disabled: true,
          kind: "show_hint",
          hint: "分支已是最新状态，无需操作。",
        };
      }
      return {
        label: "推送",
        disabled: true,
        kind: "show_hint",
        hint: "没有可推送的本地 Commit。",
      };
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: "推送",
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: `推送并创建 ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isDiverged) {
    return {
      label: "同步引用",
      disabled: true,
      kind: "show_hint",
      hint: "分支已与上游分叉。请先变基或合并。",
    };
  }

  if (isBehind) {
    return {
      label: "拉取",
      disabled: false,
      kind: "run_pull",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultRef) {
      return {
        label: "推送",
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: `推送并创建 ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  // An open change request is surfaced by the standalone attribution row in the
  // details panel, so the action button rests in its disabled up-to-date state.
  if (hasOpenPr && gitStatus.hasUpstream) {
    return {
      label: "提交",
      disabled: true,
      kind: "show_hint",
      hint: "分支已是最新状态，无需操作。",
    };
  }

  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: `创建 ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  return {
    label: "提交",
    disabled: true,
    kind: "show_hint",
    hint: "分支已是最新状态，无需操作。",
  };
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultRef: boolean,
): boolean {
  if (!isDefaultRef) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  terminology?: ChangeRequestTerminology;
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const suffix = `到 "${branchLabel}"。可以在此引用上继续，或创建功能分支引用后执行相同操作。`;
  const terminology = input.terminology ?? sourceControlClients.get(undefined).changeRequest;

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: "提交并推送到默认引用？",
        description: `此操作将提交并推送更改${suffix}`,
        continueLabel: `提交并推送到 ${branchLabel}`,
      };
    }
    return {
      title: "推送到默认引用？",
      description: `此操作将推送本地 Commit${suffix}`,
      continueLabel: `推送到 ${branchLabel}`,
    };
  }

  if (input.includesCommit) {
    return {
      title: `从默认引用提交、推送并创建 ${terminology.shortLabel}？`,
      description: `此操作将提交、推送并创建${terminology.singular}${suffix}`,
      continueLabel: `提交、推送并创建 ${terminology.shortLabel}`,
    };
  }
  return {
    title: `从默认引用推送并创建 ${terminology.shortLabel}？`,
    description: `此操作将推送本地 Commit 并创建${terminology.singular}${suffix}`,
    continueLabel: `推送并创建 ${terminology.shortLabel}`,
  };
}

export function resolveThreadBranchUpdate(
  result: GitRunStackedActionResult,
): { branch: string } | null {
  if (result.branch.status !== "created" || !result.branch.name) {
    return null;
  }

  return {
    branch: result.branch.name,
  };
}

export function resolveThreadBranchMetadataPatch(
  branch: string | null,
  expectedBranch: string | null,
): {
  branch: string | null;
  expectedBranch: string | null;
} {
  return { branch, expectedBranch };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) {
    return null;
  }

  if (input.gitStatus.refName === null && input.threadBranch !== null) {
    return null;
  }

  if (input.threadBranch === input.gitStatus.refName) {
    return null;
  }

  if (
    input.threadBranch !== null &&
    input.gitStatus.refName !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.refName)
  ) {
    return null;
  }

  return {
    branch: input.gitStatus.refName,
  };
}

// Re-export from shared for backwards compatibility in this module's exports
export { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
