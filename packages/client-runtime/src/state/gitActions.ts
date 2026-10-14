import type {
  GitRunStackedActionInput,
  GitStackedAction,
  VcsStatusResult,
} from "@t3tools/contracts";

export type GitActionIconName = "commit" | "push" | "pr";

export type GitDialogAction = "commit" | "push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export type GitActionRequestInput = Pick<
  GitRunStackedActionInput,
  "action" | "commitMessage" | "featureBranch" | "filePaths"
>;

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true,
): GitActionMenuItem[] {
  if (!gitStatus) return [];

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasOpenPr &&
    (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0 &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canOpenPr = !isBusy && hasOpenPr;

  return [
    {
      id: "commit",
      label: "提交",
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
    {
      id: "push",
      label: "推送",
      disabled: !canPush,
      icon: "push",
      kind: "open_dialog",
      dialogAction: "push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: "查看 PR",
          disabled: !canOpenPr,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: "创建 PR",
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
  isDefaultBranch = false,
  hasOriginRemote = true,
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
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;

  if (!hasBranch) {
    return {
      label: "提交",
      disabled: true,
      kind: "show_hint",
      hint: "请先创建并检出分支，再推送或创建 PR。",
    };
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return { label: "提交", disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultBranch) {
      return { label: "提交并推送", disabled: false, kind: "run_action", action: "commit_push" };
    }
    return {
      label: "提交、推送并创建 PR",
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasOriginRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: "查看 PR", disabled: false, kind: "open_pr" };
      }
      return {
        label: "推送",
        disabled: true,
        kind: "show_hint",
        hint: "请先添加 “origin” 远程仓库，再推送或创建 PR。",
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return { label: "查看 PR", disabled: false, kind: "open_pr" };
      }
      return {
        label: "推送",
        disabled: true,
        kind: "show_hint",
        hint: "没有可推送的本地 Commit。",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: "推送",
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: "推送并创建 PR",
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isDiverged) {
    return {
      label: "同步分支",
      disabled: true,
      kind: "show_hint",
      hint: "分支已与上游分叉，请先变基或合并。",
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
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: "推送",
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: "推送并创建 PR",
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return { label: "查看 PR", disabled: false, kind: "open_pr" };
  }

  return {
    label: "提交",
    disabled: true,
    kind: "show_hint",
    hint: "分支已是最新，无需操作。",
  };
}

export function getGitActionDisabledReason(input: {
  item: GitActionMenuItem;
  gitStatus: VcsStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
}): string | null {
  const { item, gitStatus, isBusy, hasOriginRemote } = input;
  if (!item.disabled) return null;
  if (isBusy) return "Git 操作正在进行中。";
  if (!gitStatus) return "Git 状态不可用。";

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;

  if (item.id === "commit") {
    if (!hasChanges) {
      return "Worktree 是干净的，请先做出更改再提交。";
    }
    return "提交当前不可用。";
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return "处于分离 HEAD 状态，请先检出分支再推送。";
    }
    if (hasChanges) {
      return "请先提交或暂存本地更改，再推送。";
    }
    if (isBehind) {
      return "分支落后于上游，请先拉取或变基再推送。";
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return "推送前请先添加 “origin” 远程仓库。";
    }
    if (!isAhead) {
      return "没有可推送的本地 Commit。";
    }
    return "推送当前不可用。";
  }

  if (hasOpenPr) {
    return "查看 PR 当前不可用。";
  }
  if (!hasBranch) {
    return "处于分离 HEAD 状态，请先检出分支再创建 PR。";
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return "创建 PR 前请先添加 “origin” 远程仓库。";
  }
  if ((gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) <= 0) {
    return "没有可纳入 PR 的本地 Commit。";
  }
  if (isBehind) {
    return "分支落后于上游，请先拉取或变基再创建 PR。";
  }
  return "创建 PR 当前不可用。";
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean,
): boolean {
  if (!isDefaultBranch) return false;
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
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const suffix = `到 “${branchLabel}” 上。你可以继续在此分支上操作，也可以创建一个功能分支并在那里执行相同操作。`;

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: "提交并推送到默认分支？",
        description: `此操作将提交并推送更改${suffix}`,
        continueLabel: `提交并推送到 ${branchLabel}`,
      };
    }
    return {
      title: "推送到默认分支？",
      description: `此操作将推送本地 Commit${suffix}`,
      continueLabel: `推送到 ${branchLabel}`,
    };
  }

  if (input.includesCommit) {
    return {
      title: "从默认分支提交、推送并创建 PR？",
      description: `此操作将提交、推送并创建 PR${suffix}`,
      continueLabel: "提交、推送并创建 PR",
    };
  }
  return {
    title: "从默认分支推送并创建 PR？",
    description: `此操作将推送本地 Commit 并创建 PR${suffix}`,
    continueLabel: "推送并创建 PR",
  };
}
