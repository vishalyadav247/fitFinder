// Values the backoffice uses on both server and client (no secrets). Pure.

/** Minimum length of the super admin's password (env and Profile page). */
export const MIN_PASSWORD = 12;

/** Overview › Stores table: status filter and sort orders (URL values). */
export const STORE_STATUSES = ["installed", "uninstalled", "all"] as const;
export const STORE_SORTS = ["newest", "active", "domain"] as const;

/** Backoffice › Logs: how long entries are kept (days), and the page's filters (URL values). */
export const LOG_RETENTION_DAYS = [7, 14, 30] as const;
export const DEFAULT_LOG_RETENTION_DAYS = 14;
export const LOG_LEVELS = ["all", "error", "warn", "slow"] as const;
export const LOG_RANGES = ["1h", "24h", "7d", "all"] as const;
