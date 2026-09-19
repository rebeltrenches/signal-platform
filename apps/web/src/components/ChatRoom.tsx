import React from 'react';

/**
 * Renders the static shell for one chatroom — every state (loading,
 * empty, error, disconnected, composer) as real markup from the start,
 * toggled by client/chat.js via hidden/data attributes rather than
 * injected later. Used identically by CommunityPage (the main room) and
 * TokenDetailPage's Community tab (a per-token room) — same component,
 * different endpoint/roomId, so the two can't drift out of sync with
 * each other.
 */
export function ChatRoom({ endpoint, roomId, label }: { endpoint: string; roomId: string; label: string }) {
  return (
    <div className="chat-room" data-chat-room="true" data-chat-endpoint={endpoint} data-chat-room-id={roomId} aria-label={label}>
      <div className="chat-messages" data-chat-messages>
        {/* populated by chat.js */}
      </div>

      <div data-chat-skeleton>
        <div className="chat-messages" style={{ flex: 'none' }}>
          {[0, 1, 2].map((i) => (
            <div className="chat-skeleton-row" key={i}>
              <div className="skeleton" style={{ width: 90, height: 10 }} />
              <div className="skeleton" style={{ width: `${70 - i * 15}%`, height: 14 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="empty-state" data-chat-empty hidden style={{ padding: '32px 16px' }}>
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 5h16v11H8l-4 4V5z" strokeLinejoin="round" />
        </svg>
        <h3>No messages yet</h3>
        <p>Be the first to say something in {label.toLowerCase()}.</p>
      </div>

      <div className="chat-error-banner" data-chat-error hidden></div>

      <form className="chat-composer" data-chat-form hidden>
        <div className="chat-composer-row">
          <textarea className="input" data-chat-input placeholder="Say something…" maxLength={500} />
          <button type="submit" className="btn btn-brand" data-chat-send disabled>
            Send
          </button>
        </div>
        <span className="chat-charcount" data-chat-charcount>0/500</span>
      </form>
      <div className="chat-disconnected-notice" data-chat-disconnected>
        Connect a wallet to post — you can read without connecting.
      </div>
    </div>
  );
}
