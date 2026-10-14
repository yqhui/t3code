/** Cap for the per-thread "recently seen" URL list shown in the empty state. */
export const PREVIEW_RECENT_URL_LIMIT = 10;

/**
 * Common Chromium error codes mapped to a short human label. Used by the
 * unreachable view to drop the raw `ERR_*` code in favour of friendlier copy.
 */
export const PREVIEW_ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  ERR_NAME_NOT_RESOLVED: "无法解析 DNS 地址",
  ERR_NAME_RESOLUTION_FAILED: "无法解析 DNS 地址",
  ERR_CONNECTION_REFUSED: "连接被拒绝",
  ERR_CONNECTION_RESET: "连接被重置",
  ERR_CONNECTION_CLOSED: "连接已关闭",
  ERR_CONNECTION_TIMED_OUT: "连接超时",
  ERR_INTERNET_DISCONNECTED: "无网络连接",
  ERR_TIMED_OUT: "连接超时",
  ERR_CERT_AUTHORITY_INVALID: "证书颁发机构不受信任",
  ERR_CERT_COMMON_NAME_INVALID: "证书主机名不匹配",
  ERR_CERT_DATE_INVALID: "证书已过期或尚未生效",
  ERR_TOO_MANY_REDIRECTS: "重定向次数过多",
});
