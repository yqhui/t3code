import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadShells } from "~/state/threads";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import type { RestartingMachine } from "./updateEverything.logic";

/** A thread an agent is working on now. A restart stops these; queued threads wait. */
const isRunning = (status: string) =>
  status === "preparing" || status === "starting" || status === "running";

/** Running threads across the environments in a newline-joined key. */
const runningThreadCountAtom = Atom.family((environmentIds: string) =>
  Atom.make((get) =>
    environmentIds
      .split("\n")
      .filter((id) => id !== "")
      .reduce(
        (count, id) =>
          count +
          get(environmentThreadShells.environmentThreadsAtom(EnvironmentId.make(id))).filter(
            (thread) => isRunning(thread.status),
          ).length,
        0,
      ),
  ).pipe(Atom.withLabel(`update-everything-running-threads:${environmentIds}`)),
);

interface UpdateEverythingDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly summary: string;
  readonly lines: ReadonlyArray<string>;
  readonly restarts: ReadonlyArray<RestartingMachine>;
  readonly onConfirm: () => void;
}

/**
 * Confirms an "update everything" run. It counts the running threads that the
 * restarts stop, and how many can resume afterwards because "Continue threads
 * after restarts" is on for their server. Recovery still skips some, such as a
 * thread waiting on the user, so the text says "can resume", not "will".
 */
export function UpdateEverythingDialog({
  open,
  onOpenChange,
  ...content
}: UpdateEverythingDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        {/* The popup unmounts when closed, so the thread count is read only while open. */}
        <UpdateEverythingDialogContent {...content} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function UpdateEverythingDialogContent({
  summary,
  lines,
  restarts,
  onConfirm,
}: Omit<UpdateEverythingDialogProps, "open" | "onOpenChange">) {
  const stopped = useAtomValue(
    runningThreadCountAtom(
      restarts
        .filter((machine) => !machine.continuesThreads)
        .map((machine) => machine.environmentId)
        .join("\n"),
    ),
  );
  const continuing = useAtomValue(
    runningThreadCountAtom(
      restarts
        .filter((machine) => machine.continuesThreads)
        .map((machine) => machine.environmentId)
        .join("\n"),
    ),
  );
  const running = stopped + continuing;
  const threads = `${running} 个正在运行的会话`;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{summary}？</AlertDialogTitle>
        <AlertDialogDescription className="whitespace-pre-line">
          {lines.join("\n")}
        </AlertDialogDescription>
        {running > 0 ? (
          <p className="pt-2 text-sm">
            {stopped === 0
              ? `${threads}将被中断，并可在重启后恢复。`
              : continuing === 0
                ? `${threads}将被中断。`
                : `${threads}将被中断。其中 ${continuing} 个可在重启后恢复。`}
          </p>
        ) : null}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
        <Button onClick={onConfirm}>更新</Button>
      </AlertDialogFooter>
    </>
  );
}
