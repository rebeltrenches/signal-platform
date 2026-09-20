/**
 * The persistence boundary for alert CONFIGURATION only — creating,
 * listing, and deleting an alert's settings. Deliberately does NOT
 * include anything about actually checking a threshold, scheduling a
 * check, or sending a notification: that needs a real scheduler, real
 * price/volume feeds, and a real notification channel, none of which
 * exist. This stage's own approved scope is explicit about that
 * boundary, and this interface reflects it directly rather than
 * leaving a tempting half-built trigger() method sitting unused.
 *
 * Alert.tokenId (schema) has no free-text fallback the way
 * Watchlist.walletAddress does — an alert with no real Token row has
 * nowhere to record what it's even about — so creating an alert
 * requires the token to already be registered (Stage 2's
 * TokenRepository). This is a deliberate design choice, not an
 * oversight: reusing existing token-resolution infrastructure rather
 * than inventing a second, parallel way to reference a token.
 */

export const ALERT_KINDS = ['price_move', 'volume_move', 'liquidity_change', 'graduation'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertRecord {
  id: string;
  ownerWalletAddress: string;
  tokenChain: string;
  tokenAddress: string;
  kind: AlertKind;
  threshold: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export interface CreateAlertInput {
  tokenChain: string;
  tokenAddress: string;
  kind: AlertKind;
  threshold: Record<string, unknown>;
}

export class AlertValidationError extends Error {}
export class AlertUnauthorizedError extends Error {}

export interface AlertRepository {
  /** Throws AlertValidationError if the token isn't registered, or
   *  kind/threshold are malformed. Never fabricates a tokenId for an
   *  unregistered token. */
  createAlert(ownerWalletAddress: string, input: CreateAlertInput): Promise<AlertRecord>;
  listAlerts(ownerWalletAddress: string): Promise<AlertRecord[]>;
  /** Throws AlertUnauthorizedError for an alert belonging to a
   *  DIFFERENT owner — explicit and testable, same reasoning as
   *  WatchlistRepository.removeItem: a silent no-op can't be
   *  distinguished from "nothing was there" so it can't prove
   *  enforcement. A genuinely nonexistent id is a real no-op. */
  removeAlert(ownerWalletAddress: string, alertId: string): Promise<void>;
}
