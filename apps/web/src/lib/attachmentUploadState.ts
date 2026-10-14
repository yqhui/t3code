import type { EnvironmentId } from "@t3tools/contracts";

export type ReadyAttachmentUpload = {
  readonly status: "ready";
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
};

export type AttachmentUploadState =
  | {
      readonly status: "uploading";
      readonly environmentId: EnvironmentId;
      readonly progress: number;
      readonly previous?: ReadyAttachmentUpload;
    }
  | ReadyAttachmentUpload
  | {
      readonly status: "failed";
      readonly environmentId: EnvironmentId;
      readonly reason: string;
      /**
       * A pending upload the queue minted for this failed attempt. Retry and
       * release delete it, so it must never carry a draft's persisted
       * attachment id.
       */
      readonly attachmentId?: string;
      readonly previous?: ReadyAttachmentUpload;
    };

export function attachmentUploadBlockReason(input: {
  readonly imageIds: ReadonlyArray<string>;
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
  readonly environmentId: EnvironmentId;
}): string | null {
  let pending = 0;
  let failed = 0;

  for (const imageId of input.imageIds) {
    const upload = input.uploadsByImageId[imageId];
    if (upload?.status === "failed" && upload.environmentId === input.environmentId) {
      failed += 1;
    } else if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
      pending += 1;
    }
  }

  if (failed > 0) {
    return failed === 1 ? "请重试或移除失败的附件" : "请重试或移除失败的附件";
  }
  if (pending > 0) {
    return pending === 1 ? "附件正在上传中" : "附件正在上传中";
  }
  return null;
}

export function formatAttachmentUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}
