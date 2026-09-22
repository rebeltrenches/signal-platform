import type {
  AlertRepository,
  CreateAlertInput,
} from './AlertRepository.js';
import { MemoryAlertRepository } from './MemoryAlertRepository.js';
import { PrismaAlertRepository } from './PrismaAlertRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

export {
  AlertValidationError,
  AlertUnauthorizedError,
  ALERT_KINDS,
} from './AlertRepository.js';

export type {
  AlertRecord,
  CreateAlertInput,
  AlertKind,
} from './AlertRepository.js';

let activeRepository: AlertRepository = new MemoryAlertRepository();
let databaseReady = false;

export async function initializeStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') {
    return;
  }

  const prisma = await getSharedPrismaClient();
  activeRepository = new PrismaAlertRepository(prisma);
  databaseReady = true;
}

function resolveRepository(): AlertRepository {
  if (process.env.CHAT_STORAGE === 'database' && !databaseReady) {
    throw new Error(
      'Database alert storage requested but initializeStorage() has not completed.',
    );
  }

  return activeRepository;
}

export function listAlerts(walletAddress: string) {
  return resolveRepository().listAlerts(walletAddress);
}

export function createAlert(walletAddress: string, input: CreateAlertInput) {
  return resolveRepository().createAlert(walletAddress, input);
}

export function removeAlert(walletAddress: string, alertId: string) {
  return resolveRepository().removeAlert(walletAddress, alertId);
}

export function __resetForTests(): void {
  activeRepository = new MemoryAlertRepository();
  databaseReady = false;
}
