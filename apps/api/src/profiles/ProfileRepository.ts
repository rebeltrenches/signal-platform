export const PROFILE_ROLES = ['creator', 'researcher', 'community'] as const;
export const PROFILE_THEMES = ['aurora', 'midnight', 'ocean', 'ember'] as const;
export interface ProfileInput {
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  banner: string;
  accent: string;
  theme: string;
  roles: string[];
  website: string;
  twitter: string;
  telegram: string;
  isPublic: boolean;
  showWallet: boolean;
  showProjects: boolean;
  featuredTokenAddress: string;
}
export interface ProfileRecord extends ProfileInput {
  ownerWalletAddress: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProfileRepository {
  getByWallet(address: string): Promise<ProfileRecord | null>;
  getByUsername(username: string): Promise<ProfileRecord | null>;
  save(address: string, input: ProfileInput): Promise<ProfileRecord>;
  remove(address: string): Promise<void>;
}
export class ProfileValidationError extends Error {}
export class ProfileConflictError extends Error {}

const RESERVED = new Set(['admin', 'administrator', 'signal', 'support', 'help', 'official', 'moderator', 'security', 'system', 'team', 'api', 'me', 'profile', 'profiles', 'wallet', 'verified', 'null', 'undefined']);
export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new ProfileValidationError('Choose a username.');
  const username = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) throw new ProfileValidationError('Username must be 3–24 letters, numbers or underscores, starting with a letter.');
  if (RESERVED.has(username)) throw new ProfileValidationError('That username is reserved. Please choose another.');
  return username;
}
function text(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new ProfileValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max || (required && !trimmed)) throw new ProfileValidationError(`${field} must be ${required ? '1–' : 'at most '}${max} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) throw new ProfileValidationError(`${field} contains unsupported characters.`);
  return trimmed;
}
function publicHttps(value: unknown, field: string, host?: RegExp): string {
  const raw = text(value, field, 500);
  if (!raw) return '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProfileValidationError(`${field} must be a full https:// link.`); }
  // These are browser links/images only; the server never fetches user URLs.
  const name = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !name.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(name) || name.includes(':') || /\.(local|internal|localhost)$/.test(name) || (host && !host.test(name))) {
    throw new ProfileValidationError(`${field} must be a public HTTPS ${host ? 'service ' : ''}link.`);
  }
  return url.href;
}
export function validateImage(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ProfileValidationError(`${field} must be an image.`);
  if (!value) return '';
  if (!value.startsWith('data:')) return publicHttps(value, field);
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || value.length > 100_000) throw new ProfileValidationError(`${field} must be a JPEG, PNG or WebP image under 75 KB. Resize it and try again.`);
  const bytes = Buffer.from(match[2]!, 'base64');
  const kind = match[1];
  const valid = kind === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : kind === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new ProfileValidationError(`${field} does not match its image format.`);
  return value;
}
export function validateProfile(value: unknown): ProfileInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileValidationError('Profile details are required.');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['username', 'displayName', 'bio', 'avatar', 'banner', 'accent', 'theme', 'roles', 'website', 'twitter', 'telegram', 'isPublic', 'showWallet', 'showProjects', 'featuredTokenAddress']);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new ProfileValidationError('Unsupported profile field.');
  for (const field of ['isPublic', 'showWallet', 'showProjects']) if (typeof input[field] !== 'boolean') throw new ProfileValidationError(`${field} must be true or false.`);
  if (typeof input.accent !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(input.accent)) throw new ProfileValidationError('Choose a valid accent colour.');
  if (!PROFILE_THEMES.includes(input.theme as any)) throw new ProfileValidationError('Choose a supported theme.');
  if (!Array.isArray(input.roles) || input.roles.length > 3 || input.roles.some((r) => !PROFILE_ROLES.includes(r))) throw new ProfileValidationError('Choose creator, researcher or community roles.');
  return {
    username: normalizeUsername(input.username), displayName: text(input.displayName, 'Display name', 50, true),
    bio: text(input.bio, 'Bio', 280), avatar: validateImage(input.avatar, 'Avatar'), banner: validateImage(input.banner, 'Banner'),
    accent: input.accent.toLowerCase(), theme: input.theme as string, roles: [...new Set(input.roles as string[])],
    website: publicHttps(input.website, 'Website'), twitter: publicHttps(input.twitter, 'X', /^(www\.)?(x\.com|twitter\.com)$/),
    telegram: publicHttps(input.telegram, 'Telegram', /^(www\.)?t\.me$/),
    isPublic: input.isPublic as boolean, showWallet: input.showWallet as boolean, showProjects: input.showProjects as boolean,
    featuredTokenAddress: text(input.featuredTokenAddress, 'Featured project', 128),
  };
}
