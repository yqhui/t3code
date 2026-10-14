import { useAtomValue } from "@effect/atom-react";

import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";
import { InlineButton } from "../ui/button";

export function SidebarThreadUndoNotice() {
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  if (!notice) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");
  const noun = notice.action === "Discarded" ? "草稿" : "会话";

  return (
    <Alert role="status" variant="sidebar">
      <AlertDescription>
        {notice.action} {notice.count} 个{noun}，
        <InlineButton onClick={undoLatestThreadAction}>
          {shortcut ? `按 ${shortcut} 撤销` : "撤销"}
        </InlineButton>
      </AlertDescription>
    </Alert>
  );
}
