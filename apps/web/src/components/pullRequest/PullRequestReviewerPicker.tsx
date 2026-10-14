import { useAtomCommand } from "~/state/use-atom-command";
/**
 * Asking someone to review, from the row that says who is already reviewing.
 *
 * The people who may be asked are read only once this menu opens: on a large repository that is
 * a list of everyone with access, which is worth a request when somebody wants it and worth
 * nothing on every pull request they merely open.
 */
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestReviewerCandidate,
} from "@t3tools/contracts";
import { CheckIcon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import { readableFailure } from "./pullRequestDetail.logic";

/** Long lists are common — an organisation repository lists everyone — so what arrived can be
 * narrowed here. It narrows only what arrived: the host is asked once, when the menu opens. */
function matches(candidate: PullRequestReviewerCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.login.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle)
  );
}

export function PullRequestReviewerPicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** False where the host would refuse this account's request, which is worth saying rather than
   * hiding: the control disabled with a reason answers the question its absence would raise. */
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  // Mounted with the menu closed, so nothing is asked of the host until it opens.
  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.reviewerCandidates({ environmentId, input: reference }) : null,
  );
  const requestReviewers = useAtomCommand(pullRequestEnvironment.requestReviewers, {
    reportFailure: false,
  });

  const candidates = useMemo(
    () => (candidatesQuery.data?.candidates ?? []).filter((entry) => matches(entry, query)),
    [candidatesQuery.data, query],
  );

  const toggle = async (candidate: PullRequestReviewerCandidate) => {
    if (pending !== null) return;
    setPending(candidate.id);
    const result = await requestReviewers({
      environmentId,
      input: {
        ...reference,
        reviewers: [{ id: candidate.id, kind: candidate.kind }],
        requested: !candidate.isRequested,
      },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: candidate.isRequested
          ? `无法撤回向 ${candidate.login} 发出的审查请求`
          : `无法向 ${candidate.login} 请求审查`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "主机拒绝了请求。请确认你有此仓库的写入权限，并且对方仍有访问权限。",
        ),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: candidate.isRequested
        ? `已撤回向 ${candidate.login} 发出的审查请求`
        : `已向 ${candidate.login} 请求审查`,
    });
  };

  return (
    <PullRequestCandidatePicker
      icon={<UserPlusIcon className="size-3.5" />}
      label="请求审查"
      allowed={allowed}
      disabledReason="请求他人审查需要此仓库的写入权限"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="搜索有访问权限的人员"
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel="没有其他人有此仓库的访问权限。"
      noMatchLabel="未找到匹配的有访问权限人员。"
      errorLabel="无法读取有访问权限的人员。"
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel="有此仓库访问权限的人员多于此处列出的数量。请在主机上请求其余人员审查。"
      candidateKey={(candidate) => `${candidate.kind}:${candidate.id}`}
      disabled={pending !== null}
      onSelect={(candidate) => void toggle(candidate)}
    >
      {(candidate) => (
        <>
          <PullRequestActorLabel actor={candidate} className="flex-1" />
          {candidate.kind === "team" ? (
            <span className="shrink-0 text-muted-foreground">团队</span>
          ) : null}
          {candidate.isRequested ? (
            <CheckIcon aria-label="已请求审查" className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
