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
  const actionLabel = {
    Settled: "已标记为已处理",
    Archived: "已归档",
    Snoozed: "已设为稍后提醒",
    Unpinned: "已取消固定",
    Discarded: "已丢弃",
  }[notice.action];

  return (
    <Alert role="status" variant="sidebar">
      <AlertDescription>
        {notice.count} 个{noun}
        {actionLabel}，
        <InlineButton onClick={undoLatestThreadAction}>
          {shortcut ? `按 ${shortcut} 撤销` : "撤销"}
        </InlineButton>
      </AlertDescription>
    </Alert>
  );
}
