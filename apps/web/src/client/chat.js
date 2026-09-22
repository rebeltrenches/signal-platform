// Real Signal Chatrooms client — shared by both the main community room
// (CommunityPage) and every per-token room (TokenDetailPage's Community
// tab). One file, parameterized by room, rather than two near-duplicate
// implementations.
//
// REAL, WORKING LIMITS:
//  - Production persistence is database-backed through apps/api's chat
//    repository. The in-memory repository remains available for tests/local use.
//  - "Real-time" here means polling (re-fetching on an interval), not a
//    WebSocket push — there is no persistent-connection server in this
//    project. This is disclosed, not hidden: the UI never claims to be
//    a live push feed.
//  - Identity is a real Ed25519 signature over each message (via the
//    wallet's own signMessage — no transaction, no SOL cost), verified
//    server-side — not just a claimed address. See apps/api/src/chat/
//    verify.ts for why this exists at all when other features in this
//    app don't need it.
(function () {
  // Configurable API origin: when apps/api is hosted separately from
  // this static frontend (see docs/SECURITY.md and the architecture
  // notes on why a separate host is the real production path for
  // this), a build can set window.SIGNAL_API_BASE_URL and every call
  // below targets that origin instead. Unset (the default, and the
  // only way this has ever actually run) means today's exact behavior
  // — a relative path, same-origin request.
  function apiUrl(path) {
    const base = window.SIGNAL_API_BASE_URL;
    return base ? `${base.replace(/\/$/, '')}${path}` : path;
  }

  const POLL_INTERVAL_MS = 4000;
  const MAX_MESSAGE_LENGTH = 500;

  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58Encode(bytes) {
    let num = 0n;
    for (const b of bytes) num = num * 256n + BigInt(b);
    let out = '';
    while (num > 0n) {
      out = BASE58_ALPHABET[Number(num % 58n)] + out;
      num = num / 58n;
    }
    for (const b of bytes) {
      if (b === 0) out = '1' + out;
      else break;
    }
    return out || '1';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function shortAddress(addr) {
    return addr.length > 10 ? `${addr.slice(0, 4)}\u2026${addr.slice(-4)}` : addr;
  }
  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** Real signing via the wallet's own signMessage — Phantom's method
   *  for proving key ownership without a transaction. Returns null if
   *  the wallet or this specific capability isn't available, so callers
   *  can show an honest "can't sign" state instead of a silent failure. */
  async function signPayload(canonical) {
    if (!window.solana || !window.solana.isPhantom || typeof window.solana.signMessage !== 'function') {
      return null;
    }
    const encoded = new TextEncoder().encode(canonical);
    const { signature } = await window.solana.signMessage(encoded, 'utf8');
    return base58Encode(signature instanceof Uint8Array ? signature : new Uint8Array(signature));
  }

  /** One chatroom instance, mounted into a container the page already
   *  rendered (empty/loading/composer markup lives in the page's own
   *  JSX so it matches that page's exact layout — this class only fills
   *  in behavior). */
  function mountChatRoom(root) {
    const endpoint = apiUrl(root.getAttribute('data-chat-endpoint'));
    const roomIdForSigning = root.getAttribute('data-chat-room-id');
    const listEl = root.querySelector('[data-chat-messages]');
    const emptyEl = root.querySelector('[data-chat-empty]');
    const skeletonEl = root.querySelector('[data-chat-skeleton]');
    const errorEl = root.querySelector('[data-chat-error]');
    const form = root.querySelector('[data-chat-form]');
    const input = root.querySelector('[data-chat-input]');
    const sendBtn = root.querySelector('[data-chat-send]');
    const charCount = root.querySelector('[data-chat-charcount]');
    const disconnectedEl = root.querySelector('[data-chat-disconnected]');
    if (!endpoint || !listEl) return;

    let lastMessageId = undefined;
    let knownMessages = [];
    let pollTimer = null;

    function isConnected() {
      return !!(window.launchpadWallet && window.launchpadWallet.address);
    }

    function renderConnectionGate() {
      const connected = isConnected();
      if (disconnectedEl) disconnectedEl.hidden = connected;
      if (form) form.hidden = !connected;
    }

    function renderMessages() {
      if (knownMessages.length === 0) {
        emptyEl.hidden = false;
        listEl.innerHTML = '';
        return;
      }
      emptyEl.hidden = true;
      const myAddress = window.launchpadWallet && window.launchpadWallet.address;
      listEl.innerHTML = knownMessages
        .map((m) => {
          const mine = myAddress && m.walletAddress === myAddress;
          if (m.deleted) {
            return `<div class="chat-message chat-message-removed" data-message-id="${m.id}"><span class="chat-meta">Message removed by a moderator</span></div>`;
          }
          const canModerate = window.__signalIsModerator === true;
          return `
          <div class="chat-message${mine ? ' chat-message-own' : ''}" data-message-id="${m.id}">
            <div class="chat-meta">
              <span class="chat-author" title="${m.walletAddress}">${shortAddress(m.walletAddress)}</span>
              <span class="chat-time">${formatTime(m.createdAt)}</span>
            </div>
            <div class="chat-body">${m.content}</div>
            <div class="chat-actions">
              <button type="button" class="chat-action-btn" data-report="${m.id}">Report</button>
              ${canModerate ? `<button type="button" class="chat-action-btn chat-action-danger" data-delete="${m.id}">Remove</button>` : ''}
              <span class="chat-report-status" data-report-status="${m.id}"></span>
            </div>
          </div>`;
        })
        .join('');
    }

    async function poll() {
      try {
        const url = new URL(endpoint, window.location.origin);
        if (lastMessageId) url.searchParams.set('since', lastMessageId);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        skeletonEl.hidden = true;
        errorEl.hidden = true;

        if (lastMessageId) {
          // Incremental: append only what's new, so an open composer or
          // scroll position isn't disturbed by re-rendering everything
          // every poll.
          if (data.messages.length > 0) {
            knownMessages = knownMessages.concat(data.messages);
            lastMessageId = data.messages[data.messages.length - 1].id;
            renderMessages();
          }
        } else {
          knownMessages = data.messages;
          if (data.messages.length > 0) lastMessageId = data.messages[data.messages.length - 1].id;
          renderMessages();
        }
      } catch (err) {
        skeletonEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = `Couldn't load messages: ${err.message}. Retrying\u2026`;
      }
    }

    function startPolling() {
      poll();
      pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = input.value.trim();
        if (!content || !isConnected()) return;

        sendBtn.disabled = true;
        input.disabled = true;
        errorEl.hidden = true;
        try {
          const timestamp = Date.now();
          const canonical = `signal-chat|${roomIdForSigning}|post|${content}|${timestamp}`;
          const signature = await signPayload(canonical);
          if (!signature) {
            throw new Error('This wallet can\u2019t sign messages (signMessage unavailable).');
          }
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ walletAddress: window.launchpadWallet.address, signature, timestamp, content }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || `Server returned ${res.status}`);

          input.value = '';
          if (charCount) charCount.textContent = `0/${MAX_MESSAGE_LENGTH}`;
          knownMessages = knownMessages.concat([data.message]);
          lastMessageId = data.message.id;
          renderMessages();
        } catch (err) {
          errorEl.hidden = false;
          errorEl.textContent = `Couldn\u2019t send: ${err.message}`;
        } finally {
          sendBtn.disabled = false;
          input.disabled = false;
          input.focus();
        }
      });

      input.addEventListener('input', () => {
        if (charCount) charCount.textContent = `${input.value.length}/${MAX_MESSAGE_LENGTH}`;
        sendBtn.disabled = input.value.trim().length === 0;
      });
    }

    listEl.addEventListener('click', async (e) => {
      const reportBtn = e.target.closest('[data-report]');
      const deleteBtn = e.target.closest('[data-delete]');

      if (reportBtn && isConnected()) {
        const messageId = reportBtn.getAttribute('data-report');
        const statusEl = root.querySelector(`[data-report-status="${messageId}"]`);
        reportBtn.disabled = true;
        try {
          const timestamp = Date.now();
          const canonical = `signal-chat|msg|report|${messageId}|${timestamp}`;
          const signature = await signPayload(canonical);
          if (!signature) throw new Error('sign failed');
          const res = await fetch(apiUrl(`/api/v1/chat/messages/${messageId}/report`), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ walletAddress: window.launchpadWallet.address, signature, timestamp }),
          });
          if (res.ok && statusEl) statusEl.textContent = 'Reported';
        } catch {
          if (statusEl) statusEl.textContent = 'Failed to report';
        }
      }

      if (deleteBtn && isConnected() && window.__signalIsModerator) {
        const messageId = deleteBtn.getAttribute('data-delete');
        deleteBtn.disabled = true;
        try {
          const timestamp = Date.now();
          const canonical = `signal-chat|msg|delete|${messageId}|${timestamp}`;
          const signature = await signPayload(canonical);
          if (!signature) throw new Error('sign failed');
          const qs = new URLSearchParams({ walletAddress: window.launchpadWallet.address, signature, timestamp: String(timestamp) });
          const res = await fetch(apiUrl(`/api/v1/chat/messages/${messageId}?${qs}`), { method: 'DELETE' });
          if (res.ok) {
            const data = await res.json();
            const idx = knownMessages.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              knownMessages[idx] = data.message;
              renderMessages();
            }
          }
        } catch {
          deleteBtn.disabled = false;
        }
      }
    });

    renderConnectionGate();
    async function refreshModeratorStatus() {
      if (!isConnected()) {
        window.__signalIsModerator = false;
        renderMessages();
        return;
      }
      try {
        const res = await fetch(apiUrl(`/api/v1/chat/is-moderator?walletAddress=${encodeURIComponent(window.launchpadWallet.address)}`));
        const data = await res.json();
        window.__signalIsModerator = data.isModerator === true;
      } catch {
        window.__signalIsModerator = false;
      }
      renderMessages();
    }

    document.addEventListener('launchpad:wallet-connected', async () => {
      renderConnectionGate();
      // Real check against the server's own allowlist — never assumed
      // client-side. This only controls whether the "Remove" button is
      // offered at all; the actual authorization happens again, for
      // real, on the server when it's clicked (see deleteChatMessage).
      await refreshModeratorStatus();
    });

    // wallet-connect.js may have connected before chat.js mounted, in
    // which case the event has already fired. Resolve moderator state
    // immediately as well so controls are correct on first render.
    if (isConnected()) refreshModeratorStatus();
    startPolling();
  }

  document.querySelectorAll('[data-chat-room]').forEach(mountChatRoom);

  // TokenDetailPage's Community tab: this page is a static layout
  // template with no server-side dynamic routing (see that file's own
  // header), so which token's room to show is only knowable client-side,
  // from a ?mint= query param. Handled here (not split into
  // token-detail.js) so all chat-specific logic — including this
  // room-selection step — stays in one file.
  const tokenChatMount = document.querySelector('[data-token-chat-mount]');
  if (tokenChatMount) {
    const mintAddress = new URLSearchParams(window.location.search).get('mint');
    const unselectedEl = document.querySelector('[data-token-chat-unselected]');
    if (mintAddress) {
      const roomEl = tokenChatMount.querySelector('[data-chat-room]');
      roomEl.setAttribute('data-chat-endpoint', `/api/v1/chat/token/${encodeURIComponent(mintAddress)}/messages`);
      roomEl.setAttribute('data-chat-room-id', `token:${mintAddress}`);
      const label = roomEl.querySelector('[data-chat-empty] p');
      if (label) label.textContent = `Be the first to say something about ${shortAddress(mintAddress)}.`;
      if (unselectedEl) unselectedEl.hidden = true;
      tokenChatMount.hidden = false;
      mountChatRoom(roomEl);
    }
    // No ?mint= present: leave the "no token selected" state showing
    // (its own markup, already rendered) and don't mount anything —
    // there's no real room to poll for without a real address.
  }

  window.mountSignalChatRoom = mountChatRoom;
  window.escapeHtmlForChat = escapeHtml;
})();
