import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  getNewProjectRepository,
  type NewProjectPublishTarget,
} from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { waitForProject } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "发生错误。";
}

/**
 * Starts a project from just a name. The server makes a folder under its
 * `newProjectsRoot` with a README, an icon, and a first commit; this then
 * opens a new thread draft in it. With `publishTo`, it also publishes the
 * repository as private on that host, without holding up the draft.
 *
 * Resolves to whether the project was created.
 */
export function useNewProject() {
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const publishRepository = useAtomCommand(sourceControlEnvironment.publishRepository, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();

  const publishNewRepository = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly workspaceRoot: string;
      readonly target: NewProjectPublishTarget;
    }) => {
      const { label } = input.target.definition;
      const result = await publishRepository({
        environmentId: input.environmentId,
        input: {
          cwd: input.workspaceRoot,
          provider: input.target.definition.kind,
          repository: getNewProjectRepository(input.target, input.workspaceRoot),
          visibility: "private",
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `无法创建 ${label} 仓库`,
              description: `${errorMessage(squashAtomCommandFailure(result))} 可在 Git 菜单中重试发布仓库。`,
            }),
          );
        }
        return;
      }
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `已发布到 ${label}`,
          description: result.value.repository.nameWithOwner,
        }),
      );
    },
    [publishRepository],
  );

  return useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly name: string;
      readonly publishTo: NewProjectPublishTarget | null;
    }): Promise<boolean> => {
      const result = await createNew({
        environmentId: input.environmentId,
        input: { name: input.name },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "无法创建项目",
              description: errorMessage(squashAtomCommandFailure(result)),
            }),
          );
        }
        return false;
      }

      const { projectId, workspaceRoot, commitError } = result.value;
      // The folder sits in T3 Code's data directory, so always say where.
      toastManager.add(
        stackedThreadToast(
          commitError === undefined
            ? { type: "success", title: `已创建 ${input.name}`, description: workspaceRoot }
            : {
                type: "warning",
                title: `已创建 ${input.name}，但没有首次提交`,
                description: `${commitError} 项目位于 ${workspaceRoot}。`,
              },
        ),
      );
      if (input.publishTo) {
        void publishNewRepository({
          environmentId: input.environmentId,
          workspaceRoot,
          target: input.publishTo,
        });
      }

      const projectRef = scopeProjectRef(input.environmentId, projectId);
      // Drafts key off the project's stored path, so wait for the create event
      // to reach the store before opening one.
      const project = await waitForProject(projectRef).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "打开项目失败",
            description: `${errorMessage(error)} 此客户端同步后将显示在侧边栏中。`,
          }),
        );
        return null;
      });
      if (project === null) return true;
      await handleNewThread(projectRef).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "打开项目失败",
            description: errorMessage(error),
          }),
        );
      });
      return true;
    },
    [createNew, handleNewThread, publishNewRepository],
  );
}
