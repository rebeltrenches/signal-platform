/**
 * The active alert repository, chosen by CHAT_STORAGE (the same
 * variable every other store facade in this project reads). Same
 * defaulting and loud-throw-rather-than-silent-fallback behavior as
 * every other store.ts in this project.
 */
import type { AlertRepository, CreateAlertInput } from './AlertRepository.js';
import { MemoryAlertRepository } from './MemoryAlertRepository.js';

export { AlertValidationError, AlertUnauthorizedError, ALERT_KINDS } from './AlertRepository.js';
export type { AlertRecord, CreateAlertInput, AlertKind } from './AlertRepository.js';

let activeRepository: AlertRepository = new MemoryAlertRepository();

function resolveRepository(): AlertRepository {
  if (process.env.CHAT_STORAGE === 'database') {
    throw new Error(
      'CHAT_STORAGE=database is set, but no real Prisma client is wired in for alerts. ' +
      'PrismaAlertRepository exists and is tested against a mock, but has never run ' +
      'against a real Postgres instance — see docs/BACKEND-DEPLOYMENT.md.'
    );
  }
  return activeRepository;
}

export function createAlert(ownerWalletAddress: string, input: CreateAlertInput) {
  return resolveRepository().createAlert(ownerWalletAddress, input);
}
export function listAlerts(ownerWalletAddress: string) {
  return resolveRepository().listAlerts(ownerWalletAddress);
}
export function removeAlert(ownerWalletAddress: string, alertId: string) {
  return resolveRepository().removeAlert(ownerWalletAddress, alertId);
}

/** Test-only. Never called from any real route handler. */
export function __resetForTests(): void {
  activeRepository = new MemoryAlertRepository();
}
