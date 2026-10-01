(function () {
  const form = document.getElementById('support-form');
  if (!form) return;
  const button = document.getElementById('support-submit');
  const status = document.getElementById('support-status');
  let sending = false;
  function message(text, error) {
    status.textContent = text;
    status.dataset.error = String(Boolean(error));
  }
  async function availability() {
    try {
      const response = await fetch('/api/support/tickets', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok || !body.configured) throw new Error('unavailable');
      button.disabled = false;
      button.textContent = 'Submit ticket';
      message('No wallet connection or payment required.');
    } catch {
      button.disabled = true;
      button.textContent = 'Support unavailable';
      message('Ticket delivery is not available yet. Please try again later.', true);
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    sending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    message('Sending your ticket to the team…');
    const fields = new FormData(form);
    const payload = Object.fromEntries(fields.entries());
    payload.consent = fields.get('consent') === 'on';
    try {
      const response = await fetch('/api/support/tickets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(35000),
      });
      const body = await response.json();
      if (!response.ok || body.delivered !== true || !/^SIG-[A-F0-9]{16}$/.test(body.reference || '')) {
        throw new Error(body.message || 'We could not confirm delivery. Keep your details and try again later.');
      }
      document.getElementById('support-reference').textContent = body.reference;
      form.hidden = true;
      const success = document.getElementById('support-success');
      success.hidden = false;
      success.focus();
    } catch (error) {
      message(error.name === 'TimeoutError' || error.name === 'TypeError'
        ? 'We could not confirm delivery. Your details are still here. Check with support before resending to avoid a duplicate.'
        : error.message, true);
    } finally {
      sending = false;
      button.disabled = false;
      button.textContent = 'Submit ticket';
    }
  });
  availability();
  window.addEventListener('online', () => { if (!sending && !form.hidden) availability(); });
})();
