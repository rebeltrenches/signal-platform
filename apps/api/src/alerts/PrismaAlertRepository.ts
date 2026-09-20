import type { AlertRepository, AlertRecord, CreateAlertInput } from './AlertRepository.js';
import { ALERT_KINDS, AlertValidationError, AlertUnauthorizedError } from './AlertRepository.js';
import { ensureUserForWallet, type UserCapableClient } from '../db/ensureWallet.js';

/**
 * The narrow slice of a real Prisma client this repository calls —
 * loosely typed for the same reason as every other Prisma*Repository
 * in this project. Queries the Token table directly (not through
 * apps/api/src/tokens/tokenStore.ts's facade) — a Prisma-backed
 * repository should resolve a token via the SAME real database
 * connection, not a separately-configured store that might be
 * backed by something else entirely.
 */
export interface AlertPrismaLikeClient extends UserCapableClient {
  token: {
    findUnique(args: any): Promise<any>;
  };
  alert: {
    findUnique(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
    delete(args: any): Promise<any>;
  };
}

function mapAlert(row: any, ownerWalletAddress: string, tokenChain: string, tokenAddress: string): AlertRecord {
  return {
    id: row.id,
    ownerWalletAddress,
    tokenChain,
    tokenAddress,
    kind: row.kind,
    threshold: row.thresholdJson,
    active: row.active,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

/**
 * Real repository logic against the EXISTING schema — zero schema
 * changes. Alert.userId requires a real User row exactly like
 * Watchlist/ChatMessage/Token did; ensureUserForWallet() (shared,
 * db/ensureWallet.ts) resolves it. Alert.tokenId requires a real,
 * already-registered Token row — there's no free-text fallback the
 * way Watchlist has, so creating an alert for an unregistered token
 * fails with a real validation error rather than inventing a tokenId.
 *
 * NEVER RUN AGAINST A REAL DATABASE. Tested via a mock
 * AlertPrismaLikeClient only.
 */
export class PrismaAlertRepository implements AlertRepository {
  constructor(private readonly db: AlertPrismaLikeClient) {}

  async createAlert(ownerWalletAddress: string, input: CreateAlertInput): Promise<AlertRecord> {
    if (!ALERT_KINDS.includes(input.kind)) {
      throw new AlertValidationError(`kind must be one of: ${ALERT_KINDS.join(', ')}`);
    }
    if (!input.threshold || typeof input.threshold !== 'object' || Array.isArray(input.threshold)) {
      throw new AlertValidationError('threshold must be a JSON object.');
    }

    const token = await this.db.token.findUnique({
      where: { chain_address: { chain: input.tokenChain, address: input.tokenAddress } },
    });
    if (!token) {
      throw new AlertValidationError(
        `No Signal-registered token at ${input.tokenChain}:${input.tokenAddress} — an alert needs a real, already-registered token.`
      );
    }

    const userId = await ensureUserForWallet(this.db, ownerWalletAddress);
    const created = await this.db.alert.create({
      data: { userId, tokenId: token.id, kind: input.kind, thresholdJson: input.threshold },
    });
    return mapAlert(created, ownerWalletAddress, input.tokenChain, input.tokenAddress);
  }

  async listAlerts(ownerWalletAddress: string): Promise<AlertRecord[]> {
    const userId = await ensureUserForWallet(this.db, ownerWalletAddress);
    const rows = await this.db.alert.findMany({ where: { userId }, include: { token: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((r: any) => mapAlert(r, ownerWalletAddress, r.token?.chain, r.token?.address));
  }

  async removeAlert(ownerWalletAddress: string, alertId: string): Promise<void> {
    const alert = await this.db.alert.findUnique({ where: { id: alertId }, include: { user: { include: { wallets: true } } } });
    if (!alert) return; // genuinely doesn't exist — a real no-op

    const ownerWallets: any[] = alert.user?.wallets ?? [];
    const isOwner = ownerWallets.some((w: any) => w.address === ownerWalletAddress);
    if (!isOwner) {
      throw new AlertUnauthorizedError('This alert does not belong to the requesting wallet.');
    }
    await this.db.alert.delete({ where: { id: alertId } });
  }
}
