import { getSharedPrismaClient } from '../db/prismaClient.js';
import { PrismaProfileRepository } from './PrismaProfileRepository.js';
import type { ProfileRepository } from './ProfileRepository.js';
let repository: ProfileRepository | null = null;
export class ProfileUnavailableError extends Error {}
export async function initializeProfileStorage() {
  // Use the existing database setting. Never create apparently saved,
  // public profiles in ephemeral memory on a deployed API.
  if (process.env.CHAT_STORAGE === 'database') repository = new PrismaProfileRepository(await getSharedPrismaClient());
}
export function profiles(): ProfileRepository {
  if (!repository) throw new ProfileUnavailableError('Profile saving is not available yet. Your preview has not been published.');
  return repository;
}
export function __setProfileRepositoryForTests(value: ProfileRepository | null) { repository = value; }
