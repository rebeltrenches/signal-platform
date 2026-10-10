import { ProfileConflictError, type ProfileInput, type ProfileRecord, type ProfileRepository } from './ProfileRepository.js';
export interface ProfilePrismaClient {
  wallet: { upsert(args: any): Promise<any> };
  userProfile: { findUnique(args: any): Promise<any>; upsert(args: any): Promise<any>; deleteMany(args: any): Promise<any> };
}
function map(row: any): ProfileRecord | null {
  if (!row) return null;
  return {
    username: row.username, displayName: row.displayName, bio: row.bio, avatar: row.avatar, banner: row.banner,
    accent: row.accent, theme: row.theme, roles: row.roles, website: row.website, twitter: row.twitter, telegram: row.telegram,
    isPublic: row.isPublic, showWallet: row.showWallet, showProjects: row.showProjects, featuredTokenAddress: row.featuredTokenAddress,
    ownerWalletAddress: row.owner.address,
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
export class PrismaProfileRepository implements ProfileRepository {
  constructor(private readonly db: ProfilePrismaClient) {}
  async getByWallet(address: string) {
    return map(await this.db.userProfile.findUnique({ where: { ownerAddress_ownerChain: { ownerAddress: address, ownerChain: 'SOLANA' } }, include: { owner: true } }));
  }
  async getByUsername(username: string) { return map(await this.db.userProfile.findUnique({ where: { username }, include: { owner: true } })); }
  async save(address: string, input: ProfileInput): Promise<ProfileRecord> {
    await this.db.wallet.upsert({ where: { address_chain: { address, chain: 'SOLANA' } }, update: {}, create: { address, chain: 'SOLANA' } });
    try {
      const row = await this.db.userProfile.upsert({
        where: { ownerAddress_ownerChain: { ownerAddress: address, ownerChain: 'SOLANA' } },
        create: { ...input, ownerAddress: address, ownerChain: 'SOLANA' }, update: input, include: { owner: true },
      });
      return map(row)!;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') throw new ProfileConflictError('That username is already taken.');
      throw error;
    }
  }
  async remove(address: string) { await this.db.userProfile.deleteMany({ where: { ownerAddress: address, ownerChain: 'SOLANA' } }); }
}
