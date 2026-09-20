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

export function createAlert(input: CreateAlertInput) {
  return resolveRepository().createAlert(input);
}

export function deleteAlert(alertId: string, walletAddress: string) {
  return resolveRepository().deleteAlert(alertId, walletAddress);
}

export function __resetForTests(): void {
  activeRepository = new MemoryAlertRepository();
  databaseReady = false;
}
