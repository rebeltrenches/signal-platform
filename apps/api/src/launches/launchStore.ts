import type { LaunchRepository, LaunchStatus, CreateDraftLaunchInput, SetBondingCurveConfigInput } from './LaunchRepository.js';
import { MemoryLaunchRepository } from './MemoryLaunchRepository.js';
import { PrismaLaunchRepository, type LaunchPrismaLikeClient } from './PrismaLaunchRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

export { LaunchValidationError, LaunchNotFoundError } from './LaunchRepository.js';
export type { LaunchRecord, LaunchStatus, BondingCurveRecord, GraduationRecord, CreateDraftLaunchInput, SetBondingCurveConfigInput } from './LaunchRepository.js';

let activeRepository: LaunchRepository = new MemoryLaunchRepository();
let databaseReady = false;

export async function initializeStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') return;
  const client = (await getSharedPrismaClient()) as LaunchPrismaLikeClient;
  activeRepository = new PrismaLaunchRepository(client);
  databaseReady = true;
}

function resolveRepository(): LaunchRepository {
  if (process.env.CHAT_STORAGE === 'database' && !databaseReady) {
    throw new Error('Database launch storage requested but initializeStorage() has not completed.');
  }
  return activeRepository;
}

export function createDraftLaunch(input: CreateDraftLaunchInput) { return resolveRepository().createDraftLaunch(input); }
export function getLaunchByTokenId(tokenId: string) { return resolveRepository().getLaunchByTokenId(tokenId); }
export function getLaunchById(launchId: string) { return resolveRepository().getLaunchById(launchId); }
export function listLaunches(status?: LaunchStatus) { return resolveRepository().listLaunches(status); }
export function setBondingCurveConfig(launchId: string, input: SetBondingCurveConfigInput) { return resolveRepository().setBondingCurveConfig(launchId, input); }
export function updateBondingCurveProgress(launchId: string, newProgress: string) { return resolveRepository().updateBondingCurveProgress(launchId, newProgress); }
export function markGraduated(launchId: string, dexId: string, poolAddress: string | null) { return resolveRepository().markGraduated(launchId, dexId, poolAddress); }
export function __resetForTests() { activeRepository = new MemoryLaunchRepository(); databaseReady = false; }
