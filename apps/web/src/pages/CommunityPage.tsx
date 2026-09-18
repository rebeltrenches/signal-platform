import React from 'react';

/**
 * Community — master spec section 16/8. Real-time chat needs a running
 * server (WebSocket/SSE) and real authentication (Stage 19) — neither
 * exists in this build. The architecture is real, though:
 * ChatRoom/ChatMessage/MessageReport/UserReport models already exist in
 * packages/database/prisma/schema.prisma, ready for Stage 19+ to wire up
 * — this page names that honestly rather than shipping a fake chat box
 * with messages that vanish on refresh.
 */
export function CommunityPage() {
  return (
    <div className="container-narrow" style={{ paddingTop: 40, paddingBottom: 80 }}>
      <h1 style={{ font: 'var(--text-h1)', marginBottom: 8 }}>Community</h1>
      <p style={{ color: 'var(--ink-dim)', marginBottom: 32 }}>
        The main Signal community, and a room for every launched token.
      </p>

      <div className="empty-state" style={{ textAlign: 'left', padding: 24 }}>
        <h3>Coming Soon</h3>
        <p style={{ marginBottom: 14 }}>
          Real-time messaging needs a running server and real wallet-linked accounts (Stage 19) —
          neither exists in this build yet. Rather than ship a chat box where messages vanish on
          refresh, this stays honestly unbuilt until it can be real.
        </p>
        <p>
          The architecture already exists: <code>ChatRoom</code>, <code>ChatMessage</code>,{' '}
          <code>MessageReport</code>, and <code>UserReport</code> models are in the database schema,
          with soft-delete for moderation (so a moderation action is itself auditable, never a
          silent erasure) and reporting wired to the same evidence categories used everywhere else
          in this product.
        </p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ font: 'var(--text-h2)', marginBottom: 12 }}>What will exist here</h2>
        <div className="review-row"><span className="k">Main community room</span><span className="v" style={{ color: 'var(--ink-faint)' }}>Coming Soon</span></div>
        <div className="review-row"><span className="k">Per-token rooms</span><span className="v" style={{ color: 'var(--ink-faint)' }}>Coming Soon — linked from each token's page</span></div>
        <div className="review-row"><span className="k">Wallet-linked identity</span><span className="v" style={{ color: 'var(--ink-faint)' }}>Coming Soon — needs Stage 19</span></div>
        <div className="review-row"><span className="k">Report message / report user</span><span className="v" style={{ color: 'var(--ink-faint)' }}>Architecture ready, needs Stage 19</span></div>
        <div className="review-row"><span className="k">Moderation</span><span className="v" style={{ color: 'var(--ink-faint)' }}>Soft-delete + audit trail designed, not yet active</span></div>
      </div>
    </div>
  );
}
