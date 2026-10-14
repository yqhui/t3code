import type { LinkedPrompt } from "@t3tools/shared/promptLinks";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";

import { toastManager } from "../ui/toast";

/** A warning that stays until dismissed when the link's prompt hid characters from the reader. */
export function warnAboutHiddenCharacters(prompt: LinkedPrompt): void {
  if (prompt.hiddenCharacters === 0) return;
  toastManager.add({
    type: "warning",
    title: "此 Prompt 含有隐藏字符，可能存在恶意内容",
    description: `T3 Code 已移除 ${prompt.hiddenCharacters} 个隐藏字符。发送前请先阅读此 Prompt。`,
    timeout: 0,
  });
}

/**
 * Puts a linked prompt in a composer for the user to read and send. Text the user already typed
 * there is never replaced without asking: a toast offers to swap it for the linked prompt.
 * `notes` carry anything the link asked for and did not get, such as a model.
 */
export function placeLinkedPrompt(
  target: ComposerThreadTarget,
  prompt: LinkedPrompt,
  notes: ReadonlyArray<string> = [],
): void {
  warnAboutHiddenCharacters(prompt);
  const place = () => {
    useComposerDraftStore.getState().setPrompt(target, prompt.text);
    // It was not written here, so it must be read before it is sent.
    toastManager.add({
      type: "info",
      title: "已从链接添加 Prompt",
      description: ["发送前请先阅读。", ...notes].join(" "),
    });
  };
  const existing = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (existing.trim().length === 0 || existing === prompt.text) {
    place();
    return;
  }
  const id = toastManager.add({
    type: "info",
    title: "链接的 Prompt 已就绪",
    description: "此会话已有草稿。要将其替换为链接的 Prompt 吗？",
    timeout: 0,
    actionProps: {
      children: "替换草稿",
      onClick: () => {
        toastManager.close(id);
        place();
      },
    },
  });
}
