/**
 * Browser import - pulling cookies from a browser already installed on the
 * machine into a T3 Code browser profile.
 *
 * Only cookies are imported. They carry the logged-in sessions, which is what
 * makes an imported profile useful; saved passwords are deliberately out of
 * scope because Electron exposes no password store to put them in.
 *
 * Availability is per source and per platform, and the reasons are modelled
 * explicitly: some are a permission the user can grant, one is a limitation
 * no amount of consent works around. The UI needs to tell those apart.
 *
 * @module BrowserImport
 */
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserProfileId } from "./browserProfile.ts";

const BROWSER_IMPORT_SOURCE_IDS = [
  "chrome",
  "edge",
  "brave",
  "vivaldi",
  "opera",
  "arc",
  "helium",
  "firefox",
  "safari",
] as const;

export const BrowserImportSourceId = Schema.Literals(BROWSER_IMPORT_SOURCE_IDS);
export type BrowserImportSourceId = typeof BrowserImportSourceId.Type;

/**
 * Why a detected source cannot be imported right now.
 *
 * `needsKeychainApproval` and `browserRunning` are recoverable — the user
 * grants access or quits the browser. `unsupportedPlatform` is not: it covers
 * cases like Chrome on Windows, whose App-Bound Encryption is designed to stop
 * exactly this, and which we will not work around.
 */
export const BrowserImportUnavailableReason = Schema.Literals([
  "notInstalled",
  "needsKeychainApproval",
  "keychainItemMissing",
  "needsFullDiskAccess",
  "browserRunning",
  "unsupportedPlatform",
]);
export type BrowserImportUnavailableReason = typeof BrowserImportUnavailableReason.Type;

/**
 * Why an import that was actually attempted failed.
 *
 * A superset of the unavailable reasons: a source can pass the pre-flight
 * check and still fail, most often because the user declined the keychain
 * prompt the read triggers.
 */
export const BrowserImportFailureReason = Schema.Literals([
  ...BrowserImportUnavailableReason.literals,
  /** The operating system's keyring or its bundled reader is unavailable. */
  "keychainUnavailable",
  /** No source registered under the requested id. */
  "unknownSource",
  /** The requested profile directory is not one the source reported. */
  "unknownSourceProfile",
  /** The target profile's Electron session could not be opened. */
  "sessionUnavailable",
  /**
   * The cookies were written, but the new profile could not be saved to
   * settings, so its partition was cleared again rather than left orphaned.
   */
  "profileNotSaved",
  /**
   * The cookies were written, but the profile count reached its cap while the
   * import ran, so the new profile was not saved and its partition was cleared.
   */
  "profileLimitReached",
  /** Anything else: a corrupt database, a failed decrypt, a vanished file. */
  "readFailed",
]);
export type BrowserImportFailureReason = typeof BrowserImportFailureReason.Type;

/** A profile inside the source browser, e.g. Chromium's "Default" directory. */
export const BrowserImportSourceProfile = Schema.Struct({
  /** Directory name under the source's user-data dir. */
  directory: TrimmedNonEmptyString,
  /** The name the source browser shows for it. */
  name: TrimmedNonEmptyString,
  /**
   * How many cookies the profile holds. Counted without decrypting, so it is
   * cheap; absent when the store could not be read yet (Safari before Full
   * Disk Access is granted).
   */
  cookieCount: Schema.optional(Schema.Int),
});
export type BrowserImportSourceProfile = typeof BrowserImportSourceProfile.Type;

export const BrowserImportSource = Schema.Struct({
  id: BrowserImportSourceId,
  name: TrimmedNonEmptyString,
  profiles: Schema.Array(BrowserImportSourceProfile),
  /** Absent when the source is importable. */
  unavailable: Schema.optional(BrowserImportUnavailableReason),
});
export type BrowserImportSource = typeof BrowserImportSource.Type;

export const BrowserImportInput = Schema.Struct({
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  /** T3 Code profile the cookies are written into. */
  targetProfileId: BrowserProfileId,
});
export type BrowserImportInput = typeof BrowserImportInput.Type;

/** IPC payload: the import input plus the environment the partition belongs to. */
export const DesktopPreviewImportCookiesInputSchema = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  sourceId: BrowserImportSourceId,
  sourceProfileDirectory: TrimmedNonEmptyString,
  targetProfileId: BrowserProfileId,
});

export const BrowserImportResult = Schema.Struct({
  /** Cookies successfully written into the target partition. */
  imported: Schema.Int,
  /**
   * Cookies read but not written — expired, rejected as malformed, or held
   * under a key we could not use. Surfaced rather than hidden so a
   * mostly-failed import doesn't look like a success.
   */
  skipped: Schema.Int,
  /**
   * The distinct hosts those skipped cookies belonged to, so the user can be
   * told what didn't come over rather than just how many. Capped, since a
   * broken key can skip thousands across many sites.
   */
  skippedDomains: Schema.Array(Schema.String),
});
export type BrowserImportResult = typeof BrowserImportResult.Type;

const BROWSER_IMPORT_UNAVAILABLE_COPY: Readonly<Record<BrowserImportUnavailableReason, string>> = {
  notInstalled: "此机器上未安装。",
  needsKeychainApproval: "需要访问钥匙串才能读取其 Cookie。",
  keychainItemMissing: "钥匙串中没有加密密钥——请先在该浏览器中登录一次，然后重试。",
  needsFullDiskAccess: "请在系统设置 → 隐私与安全性中授予 T3 Code 完全磁盘访问权限，然后重试。",
  browserRunning: "请先退出该浏览器，以便读取其 Cookie 数据库。",
  unsupportedPlatform: "此平台不支持从该浏览器导入。",
};

/** What to tell the user when an attempted import fails. */
export const BROWSER_IMPORT_FAILURE_COPY: Readonly<Record<BrowserImportFailureReason, string>> = {
  ...BROWSER_IMPORT_UNAVAILABLE_COPY,
  keychainUnavailable: "无法访问系统密钥环。请确保桌面密钥环正在运行且已解锁，然后重试。",
  unknownSource: "该浏览器已无法导入。",
  unknownSourceProfile: "该浏览器配置文件已不存在。",
  sessionUnavailable: "无法打开目标配置文件。",
  profileNotSaved: "Cookie 已导入，但无法保存新配置文件。请重试。",
  profileLimitReached: "已达配置文件数量上限。请删除一个配置文件，或导入到现有配置文件中。",
  readFailed: "无法读取该浏览器的 Cookie 数据库。",
};
