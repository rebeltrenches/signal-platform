import {
  type ChatRepository,
  type ChatMessageRecord,
  type ChatRoomRecord,
  RateLimitError,
  ValidationError,
  UnauthorizedError,
} from './ChatRepository.js';
import { ensureWallet, ensureUserForWallet } from '../db/ensureWallet.js';

export const MAX_MESSAGE_LENGTH = 500;
export const RATE_LIMIT_MS = 3000;

/**
 * The narrow slice of a real Prisma client this repository actually
 * calls — typed loosely (not against @prisma/client's generated types)
 * deliberately: no Prisma client has ever been generated anywhere this
 * project has been built (no internet to install the `prisma` CLI), so
 * there is no generated-types file to import against. A real
 * PrismaClient instance satisfies this shape structurally; wiring one
 * in is the one piece of glue that needs a real Postgres + a real
 * `prisma generate` run to actually exist, neither of which is
 * possible here. That wiring is NOT included in this repository —
 * only the query logic is, verified against a mock implementing this
 * exact interface (see chat-repository.test.ts).
 */
export interface PrismaLikeClient {
  chatRoom: {
    findUnique(args: any): Promise<any>;
    create(args: any): Promise<any>;
  };
  chatMessage: {
    create(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
    findUnique(args: any): Promise<any>;
    findFirst(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  wallet: {
    findUnique(args: any): Promise<any>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  user: {
    create(args: any): Promise<any>;
  };
  messageReport: {
    findFirst(args: any): Promise<any>;
    create(args: any): Promise<any>;
  };
}

function mapRoom(row: any): ChatRoomRecord {
  return {
    id: row.id,
    kind: row.kind === 'main' ? 'main' : 'token',
    tokenAddress: row.tokenId ? row.token?.address ?? null : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function mapMessage(row: any): ChatMessageRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    walletAddress: row.authorWallet?.address ?? row.walletAddress,
    content: row.deletedAt ? '' : row.content,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    deletedAt: row.deletedAt ? (row.deletedAt instanceof Date ? row.deletedAt.toISOString() : row.deletedAt) : null,
    // The schema has no deletedByWalletId column (deliberately not added —
    // see the class doc below for why), so a message re-fetched after
    // deletion always reports deletedBy: null here, even though the
    // wallet that deleted it is known at the MOMENT of deletion (returned
    // directly from deleteMessage() below). This has no externally
    // visible effect: routes/chat.ts never includes deletedBy in any API
    // response — it's purely an internal difference from
    // MemoryChatRepository, which happens to remember it for the life of
    // the process. Stated here precisely rather than left implicit.
    deletedBy: row.deletedByWalletId ?? null,
    reportCount: row._count?.reports ?? row.reportCount ?? 0,
  };
}

function validateContent(content: unknown): string {
  if (typeof content !== 'string') throw new ValidationError('Message content must be a string.');
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new ValidationError('Message cannot be empty.');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Message exceeds the ${MAX_MESSAGE_LENGTH}-character limit.`);
  }
  return trimmed;
}

/**
 * Real repository logic against the EXISTING schema — zero schema
 * changes. Two real gaps in the schema-as-it-stands were found while
 * building this, neither requiring a schema change to work around:
 *
 * 1. MessageReport.reporterId and ChatMessage.authorWalletId both
 *    ultimately need a Wallet row (and, for reports, a User row via
 *    Wallet.userId) to exist before a write can succeed — but nothing
 *    in the wallet-connect flow creates either today. ensureWallet()
 *    and ensureUserForWallet() below create them on first use,
 *    race-condition-safe (catch the unique-constraint violation, then
 *    re-read) — using the relations the schema already models, not new
 *    ones.
 * 2. Rate-limiting needs "when did this wallet last post" — rather
 *    than adding a denormalized timestamp column, this is derived
 *    directly from ChatMessage.createdAt via a findFirst ordered
 *    descending. One extra query per post; no schema change.
 *
 * NEVER RUN AGAINST A REAL DATABASE. Tested via a mock PrismaLikeClient
 * only (chat-repository.test.ts) — that proves this class calls the
 * right operations with the right shapes, not that real Postgres
 * accepts them. Do not treat this as production-verified until it has
 * actually been run against a real instance.
 */
export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly db: PrismaLikeClient) {}

  async getMainRoom(): Promise<ChatRoomRecord> {
    const room = await this.db.chatRoom.findUnique({ where: { id: 'main' } });
    if (room) return mapRoom(room);
    const created = await this.db.chatRoom.create({ data: { id: 'main', kind: 'main' } });
    return mapRoom(created);
  }

  async getOrCreateTokenRoom(tokenAddress: string): Promise<ChatRoomRecord> {
    const id = `token:${tokenAddress}`;
    const existing = await this.db.chatRoom.findUnique({ where: { id }, include: { token: true } });
    if (existing) return mapRoom(existing);
    const created = await this.db.chatRoom.create({ data: { id, kind: 'token' } });
    return mapRoom({ ...created, tokenId: null });
  }

  async getRoomById(roomId: string): Promise<ChatRoomRecord | null> {
    const room = await this.db.chatRoom.findUnique({ where: { id: roomId }, include: { token: true } });
    return room ? mapRoom(room) : null;
  }

  private async checkRateLimit(walletId: string): Promise<void> {
    const last = await this.db.chatMessage.findFirst({
      where: { authorWalletId: walletId },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) return;
    const lastTime = new Date(last.createdAt).getTime();
    const elapsed = Date.now() - lastTime;
    if (elapsed < RATE_LIMIT_MS) {
      throw new RateLimitError(`Wait ${Math.ceil((RATE_LIMIT_MS - elapsed) / 1000)}s before posting again.`);
    }
  }

  async postMessage(roomId: string, walletAddress: string, content: string): Promise<ChatMessageRecord> {
    const validated = validateContent(content);
    const wallet = await ensureWallet(this.db, walletAddress);
    await this.checkRateLimit(wallet.id);

    const created = await this.db.chatMessage.create({
      data: { roomId, authorWalletId: wallet.id, content: validated },
    });
    return mapMessage({ ...created, authorWallet: { address: walletAddress } });
  }

  async listMessages(roomId: string, sinceId?: string): Promise<ChatMessageRecord[]> {
    let cursorTime: Date | undefined;
    if (sinceId) {
      const cursor = await this.db.chatMessage.findUnique({ where: { id: sinceId } });
      cursorTime = cursor ? new Date(cursor.createdAt) : undefined;
    }
    const rows = await this.db.chatMessage.findMany({
      where: { roomId, ...(cursorTime ? { createdAt: { gt: cursorTime } } : {}) },
      include: { authorWallet: true, _count: { select: { reports: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapMessage);
  }

  async reportMessage(messageId: string, reporterWallet: string): Promise<ChatMessageRecord> {
    const message = await this.db.chatMessage.findUnique({ where: { id: messageId }, include: { authorWallet: true } });
    if (!message) throw new ValidationError('Message not found.');

    const reporterUserId = await ensureUserForWallet(this.db, reporterWallet);
    const alreadyReported = await this.db.messageReport.findFirst({ where: { messageId, reporterId: reporterUserId } });
    if (!alreadyReported) {
      await this.db.messageReport.create({
        data: { messageId, reporterId: reporterUserId, reason: 'OTHER' },
      });
    }
    const updated = await this.db.chatMessage.findUnique({
      where: { id: messageId },
      include: { authorWallet: true, _count: { select: { reports: true } } },
    });
    return mapMessage(updated);
  }

  isModerator(walletAddress: string): boolean {
    const raw = process.env.CHAT_MODERATOR_WALLETS ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(walletAddress);
  }

  async deleteMessage(messageId: string, requestingWallet: string): Promise<ChatMessageRecord> {
    if (!this.isModerator(requestingWallet)) {
      throw new UnauthorizedError('Only an authorized moderator can remove a message.');
    }
    const existing = await this.db.chatMessage.findUnique({ where: { id: messageId }, include: { authorWallet: true } });
    if (!existing) throw new ValidationError('Message not found.');

    const updated = await this.db.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
    // deletedBy is known right here, at the moment of deletion, even
    // though (per the note in mapMessage above) it isn't persisted.
    return { ...mapMessage({ ...updated, authorWallet: existing.authorWallet }), deletedBy: requestingWallet };
  }
}
