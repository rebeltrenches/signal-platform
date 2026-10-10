import type { Handler, RouteRequest } from '../router.js';
import { verifySessionToken } from '../auth/AuthSession.js';
import { ProfileConflictError, ProfileValidationError, normalizeUsername, validateProfile } from '../profiles/ProfileRepository.js';
import { ProfileUnavailableError, profiles } from '../profiles/profileStore.js';
import { listTokensByCreator } from '../tokens/tokenStore.js';
function owner(req: RouteRequest): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const session = verifySessionToken(value?.startsWith('Bearer ') ? value.slice(7) : '');
  return session?.chain.toUpperCase() === 'SOLANA' ? session.address : null;
}
function failure(error: unknown) {
  if (error instanceof ProfileValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: error.message } };
  if (error instanceof ProfileConflictError) return { status: 409, body: { error: 'USERNAME_TAKEN', message: error.message } };
  if (error instanceof ProfileUnavailableError) return { status: 503, body: { error: 'PROFILES_UNAVAILABLE', message: error.message } };
  console.error('[profiles] request failed', (error as Error)?.name);
  return { status: 503, body: { error: 'PROFILES_UNAVAILABLE', message: 'Profiles are temporarily unavailable. Please try again.' } };
}
const unauthorized = () => ({ status: 401, body: { error: 'UNAUTHORIZED', message: 'Sign in with your Solana wallet to edit your profile.' } });
export const getMyProfile: Handler = async (req) => {
  const address = owner(req);
  if (!address) return unauthorized();
  try {
    return { status: 200, body: { profile: await profiles().getByWallet(address), projects: await listTokensByCreator(address) } };
  } catch (error) { return failure(error); }
};
export const putMyProfile: Handler = async (req) => {
  const address = owner(req);
  if (!address) return unauthorized();
  try {
    const input = validateProfile(req.body);
    if (input.featuredTokenAddress) {
      const tokens = await listTokensByCreator(address);
      if (!tokens.some((t) => t.address === input.featuredTokenAddress)) throw new ProfileValidationError('You can only feature a project registered to your own wallet.');
    }
    return { status: 200, body: { profile: await profiles().save(address, input) } };
  } catch (error) { return failure(error); }
};
export const deleteMyProfile: Handler = async (req) => {
  const address = owner(req);
  if (!address) return unauthorized();
  try { await profiles().remove(address); return { status: 200, body: { deleted: true } }; } catch (error) { return failure(error); }
};
export const getPublicProfile: Handler = async (req) => {
  try {
    const username = normalizeUsername(req.params.username);
    const profile = await profiles().getByUsername(username);
    if (!profile?.isPublic) return { status: 404, body: { error: 'NOT_FOUND', message: 'This profile is private or does not exist.' } };
    // Explicit public projection: no owner id/address or private settings
    // are leaked by spreading a database record into a public response.
    const publicProfile = {
      username: profile.username, displayName: profile.displayName, bio: profile.bio, avatar: profile.avatar, banner: profile.banner,
      accent: profile.accent, theme: profile.theme, roles: profile.roles, website: profile.website, twitter: profile.twitter, telegram: profile.telegram,
      joinedAt: profile.createdAt, walletOwnershipVerified: true,
      ...(profile.showWallet ? { walletAddress: profile.ownerWalletAddress, chain: 'SOLANA' } : {}),
    };
    const tokens = profile.showProjects ? await listTokensByCreator(profile.ownerWalletAddress) : [];
    const projects = tokens.map((t) => ({ address: t.address, chain: t.chain, name: t.name, symbol: t.symbol, createdAt: t.createdAt, featured: t.address === profile.featuredTokenAddress }));
    return { status: 200, body: { profile: publicProfile, projects } };
  } catch (error) { return failure(error); }
};
