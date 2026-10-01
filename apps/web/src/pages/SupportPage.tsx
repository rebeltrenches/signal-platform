import React from 'react';

export function SupportPage() {
  return (
    <section className="container support-page">
      <link rel="stylesheet" href="/styles/support.css?v=1" />
      <a className="support-back" href="/">← Back to home</a>
      <div className="support-card card">
        <span className="section-eyebrow">Signal Support</span>
        <h1>Tell us what happened.</h1>
        <p className="support-intro">Having trouble with Signal? Send the team a ticket with the details so we can investigate.</p>
        <form id="support-form">
          <div className="support-fields">
            <label>How can we reach you?
              <input name="contact" required maxLength={254} placeholder="Your email or @Telegram username" autoComplete="off" />
            </label>
            <label>Issue type
              <select name="category" required defaultValue="">
                <option value="" disabled>Select an issue</option>
                <option value="wallet">Wallet connection</option>
                <option value="launch">Token launch</option>
                <option value="trade">Trading or transaction</option>
                <option value="data">Prices or token data</option>
                <option value="website">Website or mobile issue</option>
                <option value="other">Something else</option>
              </select>
            </label>
          </div>
          <label>Subject<input name="subject" required minLength={5} maxLength={100} placeholder="A short summary of the issue" /></label>
          <label>What happened?
            <textarea name="description" required minLength={20} maxLength={2000} rows={6} placeholder="Explain what you tried, what happened, and any error message. Include a public transaction hash if it helps." />
          </label>
          <label>Page where it happened <span className="support-optional">(optional)</span>
            <input name="page" type="url" maxLength={300} placeholder="https://…" />
          </label>
          <div className="support-trap" aria-hidden="true">
            <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
          </div>
          <p className="support-note">Never include seed phrases, private keys, passwords or bot tokens.</p>
          <label className="support-consent"><input name="consent" type="checkbox" required />
            <span>Send these details and my contact information to Signal’s support team through Telegram.</span>
          </label>
          <button className="btn btn-brand" id="support-submit" type="submit" disabled>Connecting…</button>
          <p id="support-status" role="status" aria-live="polite">Checking support availability…</p>
        </form>
        <div id="support-success" hidden tabIndex={-1}>
          <h2>Ticket delivered.</h2>
          <p>Your reference: <strong id="support-reference" /></p>
          <p>The team received your issue. Keep this reference when following up.</p>
          <a className="btn btn-ghost" href="/">Back to home</a>
        </div>
        <noscript>Enable JavaScript to submit a support ticket.</noscript>
      </div>
    </section>
  );
}
