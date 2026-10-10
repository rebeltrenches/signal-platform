import { ProfileConflictError, type ProfileInput, type ProfileRecord, type ProfileRepository } from './ProfileRepository.js';
/** Test/development repository only. Production never falls back to memory. */
export class MemoryProfileRepository implements ProfileRepository {
  private profiles = new Map<string, ProfileRecord>();
  async getByWallet(address: string) { return this.profiles.get(address) ?? null; }
  async getByUsername(username: string) { return [...this.profiles.values()].find((p) => p.username === username) ?? null; }
  async save(address: string, input: ProfileInput) {
    const claimed = [...this.profiles.values()].find((p) => p.username === input.username);
    if (claimed && claimed.ownerWalletAddress !== address) throw new ProfileConflictError('That username is already taken.');
    const now = new Date().toISOString();
    const profile = { ...input, ownerWalletAddress: address, createdAt: this.profiles.get(address)?.createdAt ?? now, updatedAt: now };
    this.profiles.set(address, profile);
    return profile;
  }
  async remove(address: string) { this.profiles.delete(address); }
}
