"use client";

import {
  AuthPreviewOperateScope,
  type PreviewAnnotationPayload,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import type { ComposerImageAttachment } from "~/composerDraftStore";
import { usePreviewAvailable } from "~/browser/previewRuntime";
import { useEnvironmentScope } from "~/state/session";

import { PreviewPanelShell, type PreviewPanelMode } from "./PreviewPanelShell";
import { PreviewView } from "./PreviewView";

interface Props {
  mode: PreviewPanelMode;
  threadRef: ScopedThreadRef;
  tabId?: string | null;
  configuredUrls?: ReadonlyArray<string> | undefined;
  visible: boolean;
  onSendAnnotation?: (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => void;
}

export function PreviewPanel({
  mode,
  threadRef,
  tabId,
  configuredUrls,
  visible,
  onSendAnnotation,
}: Props) {
  const available = usePreviewAvailable(threadRef.environmentId);
  const canOperatePreview = useEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope);
  if (!canOperatePreview || !available) {
    return (
      <PreviewPanelShell mode={mode}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            {canOperatePreview
              ? "预览仅在 T3 Code 桌面应用中可用。"
              : "请为此客户端重新配对并授予预览权限，以控制浏览器预览。"}
          </p>
        </div>
      </PreviewPanelShell>
    );
  }

  return (
    <PreviewPanelShell mode={mode}>
      <PreviewView
        threadRef={threadRef}
        {...(tabId !== undefined ? { tabId } : {})}
        configuredUrls={configuredUrls}
        visible={visible}
        {...(onSendAnnotation ? { onSendAnnotation } : {})}
      />
    </PreviewPanelShell>
  );
}
