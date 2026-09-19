import React from 'react';
import { ChatRoom } from '../components/ChatRoom.js';

/**
 * The main, Signal-wide chatroom. Real: messages actually persist (for
 * as long as apps/api's process keeps running — in-memory, no database
 * is connected anywhere in this project), identity is a real Ed25519
 * signature verified server-side (not a claimed address), rate-limiting
 * and moderation are real and enforced. Updates arrive by polling, not
 * a WebSocket push — there's no persistent-connection server here. See
 * apps/api/src/chat/store.ts's header for the full, honest accounting
 * of what's real and what its limits are.
 *
 * Per-token rooms live on each token's own page (TokenDetailPage's
 * Community tab) — this page is specifically the Signal-wide room.
 */
export function CommunityPage() {
  return (
    <div className="container-narrow" style={{ paddingTop: 40, paddingBottom: 80 }}>
      <h1 style={{ font: 'var(--text-h1)', marginBottom: 8 }}>Community</h1>
      <p style={{ color: 'var(--ink-dim)', marginBottom: 28 }}>
        The main Signal community. Every launched token also has its own room, linked from that
        token's page.
      </p>

      <ChatRoom endpoint="/api/v1/chat/main/messages" roomId="main" label="the Signal community" />

      <p className="hint" style={{ marginTop: 16, textTransform: 'none', color: 'var(--ink-faint)' }}>
        Messages are stored for as long as the server keeps running, not in a permanent database yet
        — see <a href="/security" style={{ color: 'var(--brand)' }}>Security</a> for exactly what
        that means. Every message here is signed by the sender's own wallet; nobody can post as an
        address they don't control.
      </p>
    </div>
  );
}
