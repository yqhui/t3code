import type { AssetResource, ProjectReadFileError, ScopedThreadRef } from "@t3tools/contracts";
import { isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";

/** Resolve workspace links before choosing between the explorer and a file preview. */
export function resolveFilePreviewPath(path: string | null, cwd: string): string | null {
  if (path === null) return null;
  return path === "." || workspaceRelativeFilePath(path, cwd) === "." ? null : path;
}

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

/** Describe existing failure codes without exposing the underlying platform cause. */
export function filePreviewReadErrorMessage(error: ProjectReadFileError): string {
  switch (error.failure) {
    case "path_not_file":
      return "该路径是目录或特殊文件，不是常规文件。";
    case "binary_file":
      return "该文件为二进制文件，无法以文本显示。";
    case "workspace_path_outside_root":
      return "请求的路径在工作区之外。";
    case "resolved_path_outside_root":
      return "该路径解析到工作区之外的位置。";
    case "operation_failed":
      // A realpath failure can mean a missing path, permissions, or another I/O error.
      return error.operation === "realpath-workspace-root"
        ? "无法访问工作区文件夹。"
        : "无法访问或读取该文件。它可能已丢失或不可访问。";
    default:
      return error.message;
  }
}

export function shouldShowFileExplorer(input: {
  readonly relativePath: string | null;
  readonly explorerOpen: boolean;
  readonly attachmentOpen: boolean;
}): boolean {
  if (input.attachmentOpen || (input.relativePath && isAbsolutePath(input.relativePath))) {
    return false;
  }
  return input.explorerOpen || input.relativePath === null;
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}

/**
 * The asset for a file the panel shows. A draft has no thread on the server
 * yet, so it names its workspace root instead of a thread to resolve one from.
 */
export function workspaceAssetResource(input: {
  readonly kind: "workspace-file" | "media-file";
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly workspaceRoot: string;
  readonly absolutePath: string;
}): AssetResource {
  if (input.draft) {
    return { _tag: "draft-workspace-file", cwd: input.workspaceRoot, path: input.absolutePath };
  }
  return { _tag: input.kind, threadId: input.threadRef.threadId, path: input.absolutePath };
}
