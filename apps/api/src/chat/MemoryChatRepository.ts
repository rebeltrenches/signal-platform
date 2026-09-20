import crypto from 'node:crypto';
import {
  type ChatRepository,
  type ChatMessageRecord,
  type ChatRoomRecord,
  RateLimitError,
  ValidationError,
  UnauthorizedError,
} from './ChatRepository.js';

export const MAX_MESSAGE_LENGTH = 500;
export const RATE_LIMIT_MS = 3000; // one message per wallet per 3 seconds

const MAIN_ROOM_ID = 'main';

function tokenRoomId(tokenAddress: string): string {
  return `token:${tokenAddress}`;
}

function validateContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new ValidationError('Message content must be a string.');
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new ValidationError('Message cannot be empty.');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Message exceeds the ${MAX_MESSAGE_LENGTH}-character limit.`);
  }
  return trimmed;
}

/**
 * The exact in-memory logic that has been running throughout this
 * project — unchanged behavior, only moved behind the ChatRepository
 * interface so routes/chat.ts doesn't need to know or care which
 * implementation is active. This remains the default; it's the only
 * implementation that has ever actually been exercised against real
 * HTTP requests.
 */
export class MemoryChatRepository implements ChatRepository {
  private rooms = new Map<string, ChatRoomRecord>([
    [MAIN_ROOM_ID, { id: MAIN_ROOM_ID, kind: 'main', tokenAddress: null, createdAt: new Date().toISOString() }],
  ]);
  private messagesByRoom = new Map<string, ChatMessageRecord[]>([[MAIN_ROOM_ID, []]]);
  private lastPostAt = new Map<string, number>();
  private reportedBy = new Map<string, Set<string>>();
  private messageIndex = new Map<string, ChatMessageRecord>();

  async getMainRoom(): Promise<ChatRoomRecord> {
    return this.rooms.get(MAIN_ROOM_ID)!;
  }

  async getOrCreateTokenRoom(tokenAddress: string): Promise<ChatRoomRecord> {
    const id = tokenRoomId(tokenAddress);
    let room = this.rooms.get(id);
    if (!room) {
      room = { id, kind: 'token', tokenAddress, createdAt: new Date().toISOString() };
      this.rooms.set(id, room);
      this.messagesByRoom.set(id, []);
    }
    return room;
  }

  async getRoomById(roomId: string): Promise<ChatRoomRecord | null> {
    return this.rooms.get(roomId) ?? null;
  }

  private checkRateLimit(walletAddress: string): void {
    const last = this.lastPostAt.get(walletAddress);
    const now = Date.now();
    if (last !== undefined && now - last < RATE_LIMIT_MS) {
      throw new RateLimitError(`Wait ${Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000)}s before posting again.`);
    }
  }

  async postMessage(roomId: string, walletAddress: string, content: string): Promise<ChatMessageRecord> {
    const validated = validateContent(content);
    this.checkRateLimit(walletAddress);

    const list = this.messagesByRoom.get(roomId);
    if (!list) throw new ValidationError('Room does not exist.');

    const message: ChatMessageRecord = {
      id: crypto.randomUUID(),
      roomId,
      walletAddress,
      content: validated,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      deletedBy: null,
      reportCount: 0,
    };
    list.push(message);
    this.messageIndex.set(message.id, message);
    this.lastPostAt.set(walletAddress, Date.now());
    return message;
  }

  async listMessages(roomId: string, sinceId?: string): Promise<ChatMessageRecord[]> {
    const list = this.messagesByRoom.get(roomId) ?? [];
    const fromIndex = sinceId ? list.findIndex((m) => m.id === sinceId) + 1 : 0;
    return list.slice(fromIndex);
  }

  async reportMessage(messageId: string, reporterWallet: string): Promise<ChatMessageRecord> {
    const message = this.messageIndex.get(messageId);
    if (!message) throw new ValidationError('Message not found.');

    const already = this.reportedBy.get(messageId) ?? new Set<string>();
    if (already.has(reporterWallet)) return message;
    already.add(reporterWallet);
    this.reportedBy.set(messageId, already);
    message.reportCount += 1;
    return message;
  }

  isModerator(walletAddress: string): boolean {
    const raw = process.env.CHAT_MODERATOR_WALLETS ?? '';
    const allowlist = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return allowlist.includes(walletAddress);
  }

  async deleteMessage(messageId: string, requestingWallet: string): Promise<ChatMessageRecord> {
    if (!this.isModerator(requestingWallet)) {
      throw new UnauthorizedError('Only an authorized moderator can remove a message.');
    }
    const message = this.messageIndex.get(messageId);
    if (!message) throw new ValidationError('Message not found.');

    message.deletedAt = new Date().toISOString();
    message.deletedBy = requestingWallet;
    return message;
  }

  /** Test-only — never called from any real route handler. */
  __resetForTests(): void {
    this.rooms.clear();
    this.rooms.set(MAIN_ROOM_ID, { id: MAIN_ROOM_ID, kind: 'main', tokenAddress: null, createdAt: new Date().toISOString() });
    this.messagesByRoom.clear();
    this.messagesByRoom.set(MAIN_ROOM_ID, []);
    this.lastPostAt.clear();
    this.reportedBy.clear();
    this.messageIndex.clear();
  }
}
