(function () {
  const root = document.querySelector('[data-profile-mode]');
  if (!root) return;
  const publicView = root.dataset.profileMode === 'public';
  const byId = (id) => document.getElementById(id);
  const form = byId('profile-form');
  const status = byId('profile-status');
  const saveStatus = byId('profile-save-status');
  const defaults = () => ({ username: '', displayName: '', bio: '', avatar: '', banner: '', accent: '#8b5cf6', theme: 'aurora', roles: [], website: '', twitter: '', telegram: '', isPublic: false, showWallet: false, showProjects: false, featuredTokenAddress: '' });
  let state = defaults();
  let saved = null;
  let projects = [];
  let currentWallet = '';
  let authenticatedWallet = '';
  let generation = 0;
  let busy = false;
  let dirty = false;
  let imageOperations = 0;
  const imageVersions = { avatar: 0, banner: 0 };
  const api = (path) => (window.SIGNAL_API_BASE_URL || '').replace(/\/$/, '') + path;
  const username = (value) => String(value || '').trim().toLowerCase();
  const key = () => `signal_profile_draft_v1:${currentWallet || 'anonymous'}`;
  function setStatus(message) { status.textContent = message; }
  function message(text) { if (saveStatus) saveStatus.textContent = text; }
  function readDraft() {
    try { const entry = JSON.parse(localStorage.getItem(key()) || 'null'); return entry && entry.dirty && entry.profile ? entry.profile : null; } catch { return null; }
  }
  function saveDraft() {
    try { localStorage.setItem(key(), JSON.stringify({ dirty, profile: state })); return true; } catch { return false; }
  }
  function clearDraft() { try { localStorage.removeItem(key()); } catch {} }
  function readForm() {
    if (!form) return;
    for (const field of ['username', 'displayName', 'bio', 'accent', 'theme', 'website', 'twitter', 'telegram', 'featuredTokenAddress']) state[field] = form.elements.namedItem(field).value;
    state.username = username(state.username);
    state.roles = [...form.querySelectorAll('input[name="roles"]:checked')].map((el) => el.value);
    for (const field of ['isPublic', 'showWallet', 'showProjects']) state[field] = form.elements.namedItem(field).checked;
  }
  function fillForm() {
    if (!form) return;
    for (const field of ['username', 'displayName', 'bio', 'accent', 'theme', 'website', 'twitter', 'telegram', 'featuredTokenAddress']) form.elements.namedItem(field).value = state[field] || '';
    for (const el of form.querySelectorAll('input[name="roles"]')) el.checked = state.roles.includes(el.value);
    for (const field of ['isPublic', 'showWallet', 'showProjects']) form.elements.namedItem(field).checked = state[field] === true;
  }
  function safeLink(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function safeImage(value) {
    return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value || '') ? value : safeLink(value);
  }
  function image(id, value) {
    const el = byId(id);
    const source = safeImage(value);
    el.hidden = !source;
    if (!source) { el.removeAttribute('src'); return; }
    el.onload = () => { if (id === 'profile-avatar-image') byId('profile-initials').hidden = true; };
    el.onerror = () => { el.hidden = true; if (id === 'profile-avatar-image') byId('profile-initials').hidden = false; };
    if (el.getAttribute('src') !== source) el.src = source;
  }
  function link(text, href) {
    const el = document.createElement('a');
    el.textContent = text; el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.referrerPolicy = 'no-referrer';
    return el;
  }
  function renderProjects() {
    const visible = publicView ? projects : state.showProjects ? projects : [];
    byId('profile-project-section').hidden = !visible.length;
    const list = byId('profile-projects'); list.replaceChildren();
    const sorted = [...visible].sort((a, b) => Number(b.featured || b.address === state.featuredTokenAddress) - Number(a.featured || a.address === state.featuredTokenAddress));
    for (const project of sorted) {
      const card = document.createElement('a'); card.className = 'card profile-project';
      card.href = `/token/${encodeURIComponent(project.address)}?chain=${encodeURIComponent(String(project.chain).toLowerCase())}`;
      const title = document.createElement('strong'); title.textContent = `${project.name} (${project.symbol})`;
      const detail = document.createElement('span'); detail.className = 'hint'; detail.textContent = `${project.featured || project.address === state.featuredTokenAddress ? 'Featured · ' : ''}${project.chain} · ${project.address}`;
      card.append(title, detail); list.append(card);
    }
  }
  function render() {
    const card = byId('profile-card'); card.dataset.theme = ['aurora','midnight','ocean','ember'].includes(state.theme) ? state.theme : 'aurora';
    card.style.setProperty('--profile-accent', /^#[0-9a-f]{6}$/i.test(state.accent) ? state.accent : '#8b5cf6');
    const name = state.displayName || 'Your display name';
    byId('profile-display-name').textContent = name;
    byId('profile-handle').textContent = '@' + (username(state.username) || 'your_username');
    byId('profile-initials').textContent = name.trim().split(/\s+/).slice(0,2).map((s) => s[0]).join('').toUpperCase();
    byId('profile-initials').hidden = false;
    image('profile-avatar-image', state.avatar); image('profile-banner-image', state.banner);
    if (byId('profile-avatar-image').complete && byId('profile-avatar-image').naturalWidth && !byId('profile-avatar-image').hidden) byId('profile-initials').hidden = true;
    byId('profile-bio').textContent = state.bio || (publicView ? '' : 'Tell the community a little about yourself.');
    byId('profile-visibility').textContent = publicView ? 'Public profile' : dirty ? (state.isPublic ? 'Public profile preview · unsaved' : 'Private preview · unsaved') : saved ? (saved.isPublic ? 'Public profile' : 'Private profile') : 'Private preview';
    const roles = byId('profile-roles'); roles.replaceChildren();
    for (const role of state.roles || []) {
      if (!['creator','researcher','community'].includes(role)) continue;
      const badge = document.createElement('span'); badge.textContent = role[0].toUpperCase() + role.slice(1); badge.title = 'Self-selected role'; roles.append(badge);
    }
    if (publicView ? state.walletOwnershipVerified : saved && authenticatedWallet === currentWallet) {
      const verified = document.createElement('span'); verified.textContent = 'Wallet ownership verified'; verified.title = 'Signed in with a wallet. This does not verify identity or endorse projects.'; roles.append(verified);
    }
    const socials = byId('profile-socials'); socials.replaceChildren();
    for (const [field, label] of [['website','Website ↗'], ['twitter','X ↗'], ['telegram','Telegram ↗']]) {
      const href = safeLink(state[field]); if (href) socials.append(link(label, href));
    }
    const walletAddress = publicView ? state.walletAddress : state.showWallet ? currentWallet : '';
    const wallet = byId('profile-wallet'); wallet.replaceChildren(); wallet.hidden = !walletAddress;
    if (walletAddress) {
      const code = document.createElement('code'); code.textContent = walletAddress; wallet.append(code);
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-ghost'; copy.textContent = 'Copy address'; copy.addEventListener('click', () => copyText(walletAddress, copy));
      wallet.append(copy, link('Solscan ↗', `https://solscan.io/account/${encodeURIComponent(walletAddress)}`));
    }
    const joined = publicView ? state.joinedAt : saved?.createdAt;
    byId('profile-joined').textContent = joined && Number.isFinite(Date.parse(joined)) ? `Joined ${new Date(joined).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}` : '';
    if (!publicView) {
      byId('profile-link-preview').textContent = '/u/' + (username(state.username) || 'your_username');
      byId('profile-bio-count').textContent = `${state.bio.length} / 280`;
      byId('profile-save').textContent = state.isPublic ? 'Save public profile' : 'Save private profile';
      byId('profile-save').disabled = busy || imageOperations > 0 || !currentWallet || authenticatedWallet !== currentWallet;
      byId('profile-sign-in').hidden = !!currentWallet && authenticatedWallet === currentWallet;
      byId('profile-sign-in').disabled = busy;
      const published = saved?.isPublic === true;
      byId('profile-view-link').hidden = !published;
      byId('profile-copy-link').hidden = !published;
      if (published) byId('profile-view-link').href = '/u/' + encodeURIComponent(saved.username);
      byId('profile-delete-section').hidden = !saved;
      byId('profile-delete').disabled = busy;
    }
    renderProjects();
  }
  async function copyText(value, button) {
    try { await navigator.clipboard.writeText(value); button.textContent = 'Copied'; } catch { button.textContent = 'Copy unavailable'; message('Copy this link from your browser address bar.'); }
  }
  function setProjectOptions() {
    const select = byId('profile-featured'); if (!select) return;
    select.replaceChildren(); const none = document.createElement('option'); none.value = ''; none.textContent = 'No featured project'; select.append(none);
    for (const project of projects) { const option = document.createElement('option'); option.value = project.address; option.textContent = `${project.name} (${project.symbol})`; select.append(option); }
    if (state.featuredTokenAddress && !projects.some((p) => p.address === state.featuredTokenAddress)) { const pending = document.createElement('option'); pending.value = state.featuredTokenAddress; pending.textContent = 'Previously selected project — sign in to check'; select.append(pending); }
    select.value = state.featuredTokenAddress;
  }
  async function request(path, options = {}) {
    const response = await fetch(api(path), { ...options, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || (response.status === 404 || response.status === 503 ? 'Profile saving is not available on this deployment yet.' : 'Could not load profiles. Please try again.'));
      error.status = response.status; throw error;
    }
    return body;
  }
  async function loadMine(token, address, version) {
    const body = await request('/api/v1/profiles/me', { headers: { authorization: `Bearer ${token}` } });
    if (version !== generation || currentWallet !== address) return false;
    authenticatedWallet = address; saved = body.profile; projects = body.projects || [];
    if (!dirty && saved) state = { ...defaults(), ...Object.fromEntries(Object.keys(defaults()).map((field) => [field, saved[field]])) };
    setProjectOptions(); fillForm(); render();
    setStatus(saved ? (dirty ? 'Saved profile loaded. Your unsaved draft remains in the preview.' : 'Your profile is loaded. Choose what you share.') : 'Signed in. Your new profile stays private unless you publish it.');
    return true;
  }
  async function walletChanged() {
    const address = window.launchpadWallet?.address || '';
    // Invalidate in-flight saves, loads and image operations on wallet changes.
    generation++; imageVersions.avatar++; imageVersions.banner++;
    const version = generation;
    const anonymousDraft = !currentWallet && dirty ? { ...state } : null;
    currentWallet = address; authenticatedWallet = ''; saved = null; projects = []; state = defaults(); busy = false;
    const draft = readDraft() || (address ? anonymousDraft : null); dirty = !!draft; if (draft) { state = { ...defaults(), ...draft }; saveDraft(); }
    setProjectOptions(); fillForm(); render();
    message(draft ? 'Restored your unsaved draft from this browser.' : 'Connecting a wallet does not publish your profile.');
    setStatus(address ? 'Sign in to load and save your profile.' : 'Customize your preview, then connect your Solana wallet to save.');
    const token = window.signalAuth?.getSessionToken(address);
    if (address && token) {
      busy = true; render();
      try { await loadMine(token, address, version); }
      catch (error) { if (version === generation) { setStatus(error.message); } }
      finally { if (version === generation) { busy = false; render(); } }
    }
  }
  async function resizeImage(file, kind) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP image under 5 MB.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const source = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This image could not be opened.')); img.src = objectUrl; });
      let width = kind === 'avatar' ? 320 : 960;
      let height = kind === 'avatar' ? 320 : 320;
      for (let attempt = 0; attempt < 4; attempt++) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image resizing is unavailable in this browser.');
        context.fillStyle = '#151125'; context.fillRect(0, 0, width, height);
        const scale = Math.max(width / source.naturalWidth, height / source.naturalHeight);
        const drawnWidth = source.naturalWidth * scale, drawnHeight = source.naturalHeight * scale;
        context.drawImage(source, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
        const encoded = canvas.toDataURL('image/jpeg', 0.78 - attempt * 0.12);
        if (encoded.length <= 96_000) return encoded;
        width = Math.round(width * 0.8); height = Math.round(height * 0.8);
      }
      throw new Error('This image is too large after resizing. Try a simpler image.');
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  if (publicView) {
    const parts = location.pathname.split('/').filter(Boolean);
    const handle = parts[0] === 'u' && parts[1] !== 'example' ? parts[1] : new URLSearchParams(location.search).get('username');
    if (!handle) { showPublicError('Choose a profile', 'Open a shared Signal profile link to see someone’s profile.'); return; }
    request('/api/v1/profiles/' + encodeURIComponent(handle)).then((body) => {
      state = body.profile; projects = body.projects || []; document.title = `${state.displayName} (@${state.username}) — Signal`;
      render(); setStatus('');
    }).catch((error) => showPublicError(error.status === 404 ? 'Profile not available' : 'Profiles temporarily unavailable', error.status === 404 ? 'This profile is private or does not exist.' : 'Please try again later.'));
    function showPublicError(title, detail) { byId('profile-card').hidden = true; byId('profile-public-error').hidden = false; byId('profile-error-title').textContent = title; byId('profile-error-body').textContent = detail; setStatus(''); }
    return;
  }
  form.addEventListener('input', () => {
    readForm(); dirty = true;
    const stored = saveDraft(); render(); message(stored ? 'Unsaved draft kept in this browser. Save to sync your profile.' : 'Unsaved changes. Browser storage is unavailable; keep this page open until you save.');
  });
  for (const kind of ['avatar','banner']) {
    byId(`profile-${kind}-upload`).addEventListener('change', async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      const version = generation, imageVersion = ++imageVersions[kind]; imageOperations++; render(); message('Preparing image…');
      try {
        const encoded = await resizeImage(file, kind);
        if (version !== generation || imageVersion !== imageVersions[kind]) return;
        state[kind] = encoded; dirty = true; const stored = saveDraft(); render(); message(stored ? 'Image ready. Save your profile to keep it across devices.' : 'Image ready. Save your profile; browser draft storage is unavailable.');
      } catch (error) { if (version === generation) message(error.message); }
      finally { imageOperations--; event.target.value = ''; render(); }
    });
  }
  for (const button of form.querySelectorAll('[data-remove-image]')) button.addEventListener('click', () => {
    const kind = button.dataset.removeImage; imageVersions[kind]++; state[kind] = ''; dirty = true; saveDraft(); render(); message('Image removed from your preview. Save to apply.');
  });
  byId('profile-sign-in').addEventListener('click', async () => {
    if (busy) return;
    const address = window.launchpadWallet?.address;
    if (!address) { document.getElementById('wallet-connect-btn')?.click(); message('Connect your Solana wallet, then sign in to manage your profile.'); return; }
    const version = generation; busy = true; render();
    try {
      message('Approve the wallet sign-in message. This does not send a transaction.');
      const token = await window.signalAuth.signIn(address);
      if (version !== generation) return;
      await loadMine(token, address, version);
      if (version === generation) message('Signed in. Review your profile, then press Save.');
    } catch (error) { if (version === generation) message(error.message); }
    finally { if (version === generation) { busy = false; render(); } }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy || imageOperations) return;
    readForm(); saveDraft();
    const address = window.launchpadWallet?.address;
    if (!address) { document.getElementById('wallet-connect-btn')?.click(); message('Connect your Solana wallet, then sign in to save.'); return; }
    const version = generation; busy = true; render();
    try {
      if (authenticatedWallet !== address) {
        message('Approve the wallet sign-in message. This does not send a transaction.');
        const token = await window.signalAuth.signIn(address);
        if (version !== generation) return;
        await loadMine(token, address, version);
        if (version === generation) message('Signed in. Review your profile, then press Save.');
        return;
      }
      const token = window.signalAuth.getSessionToken(address);
      if (!token) { authenticatedWallet = ''; throw new Error('Please sign in again to save your profile.'); }
      const submitted = JSON.parse(JSON.stringify(state));
      message('Saving your profile…');
      const body = await request('/api/v1/profiles/me', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(submitted) });
      if (version !== generation) return;
      saved = body.profile;
      // Preserve edits made while the save was in flight.
      const editedDuringSave = JSON.stringify(state) !== JSON.stringify(submitted);
      if (!editedDuringSave) { state = { ...defaults(), ...Object.fromEntries(Object.keys(defaults()).map((field) => [field, saved[field]])) }; dirty = false; clearDraft(); fillForm(); }
      else { dirty = true; saveDraft(); }
      message(editedDuringSave ? 'Profile saved. Your newer edits are still an unsaved draft.' : saved.isPublic ? 'Public profile saved. You can share your link.' : 'Private profile saved. Only you can load it when signed in.');
      setStatus(saved.isPublic ? 'Your profile is public.' : 'Your profile is private.'); render();
    } catch (error) { if (version === generation) { if (error.status === 401) authenticatedWallet = ''; message(error.message); } }
    finally { if (version === generation) { busy = false; render(); } }
  });
  byId('profile-copy-link').addEventListener('click', () => { if (saved?.isPublic) copyText(location.origin + '/u/' + encodeURIComponent(saved.username), byId('profile-copy-link')); });
  byId('profile-delete').addEventListener('click', async () => {
    if (busy || !saved || authenticatedWallet !== currentWallet) return;
    if (!window.confirm('Delete your Signal profile and release your username? Your wallet and tokens will remain unchanged.')) return;
    const version = generation; busy = true; render();
    try {
      await request('/api/v1/profiles/me', { method: 'DELETE', headers: { authorization: `Bearer ${window.signalAuth.getSessionToken(currentWallet) || ''}` } });
      if (version !== generation) return;
      clearDraft(); state = defaults(); saved = null; dirty = false; fillForm(); message('Your profile has been deleted.'); setStatus('Your profile is no longer published.');
    } catch (error) { if (version === generation) { if (error.status === 401) authenticatedWallet = ''; message(error.message); } }
    finally { if (version === generation) { busy = false; render(); } }
  });
  document.addEventListener('launchpad:wallet-connected', walletChanged);
  document.addEventListener('launchpad:wallet-disconnected', walletChanged);
  walletChanged();
})();
