import crypto from 'node:crypto';
import type { AlertRepository, AlertRecord, CreateAlertInput } from './AlertRepository.js';
import { ALERT_KINDS, AlertValidationError, AlertUnauthorizedError } from './AlertRepository.js';
import { getTokenByAddress } from '../tokens/tokenStore.js';

/** Real, working, in-process — same honest limits as every other
 *  Memory* repository: genuinely there for as long as this process
 *  runs, gone on restart. */
export class MemoryAlertRepository implements AlertRepository {
  private alerts = new Map<string, AlertRecord>();

  async createAlert(ownerWalletAddress: string, input: CreateAlertInput): Promise<AlertRecord> {
    if (!ownerWalletAddress) throw new AlertValidationError('ownerWalletAddress is required.');
    if (!ALERT_KINDS.includes(input.kind)) {
      throw new AlertValidationError(`kind must be one of: ${ALERT_KINDS.join(', ')}`);
    }
    if (!input.threshold || typeof input.threshold !== 'object' || Array.isArray(input.threshold)) {
      throw new AlertValidationError('threshold must be a JSON object.');
    }
    // Reuses Stage 2's real token registration — never invents a
    // tokenId for a token nobody has registered.
    const token = await getTokenByAddress(input.tokenChain, input.tokenAddress);
    if (!token) {
      throw new AlertValidationError(
        `No Signal-registered token at ${input.tokenChain}:${input.tokenAddress} — an alert needs a real, already-registered token.`
      );
    }

    const record: AlertRecord = {
      id: crypto.randomUUID(),
      ownerWalletAddress,
      tokenChain: input.tokenChain,
      tokenAddress: input.tokenAddress,
      kind: input.kind,
      threshold: input.threshold,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.alerts.set(record.id, record);
    return record;
  }

  async listAlerts(ownerWalletAddress: string): Promise<AlertRecord[]> {
    return Array.from(this.alerts.values())
      .filter((a) => a.ownerWalletAddress === ownerWalletAddress)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async removeAlert(ownerWalletAddress: string, alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) return; // genuinely doesn't exist — a real no-op
    if (alert.ownerWalletAddress !== ownerWalletAddress) {
      throw new AlertUnauthorizedError('This alert does not belong to the requesting wallet.');
    }
    this.alerts.delete(alertId);
  }

  /** Test-only. Never called from any real route handler. */
  __resetForTests(): void {
    this.alerts.clear();
  }
}
