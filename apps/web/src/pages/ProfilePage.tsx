import React from 'react';
export function ProfilePage({ publicView = false }: { publicView?: boolean }) {
  return (
    <div className={`container profile-page ${publicView ? 'profile-public-page' : ''}`} data-profile-mode={publicView ? 'public' : 'edit'}>
      <div className="page-head">
        <div><h1>{publicView ? 'Signal profile' : 'Make Signal yours'}</h1><p>{publicView ? 'People and projects in the Signal community.' : 'Your identity, your style. Choose what you share.'}</p></div>
        <a className="btn btn-ghost" href={publicView ? '/profile' : '/dashboard'}>{publicView ? 'My profile' : 'Dashboard'}</a>
      </div>
      <p id="profile-status" className="profile-status hint" role="status" aria-live="polite">{publicView ? 'Loading profile…' : 'Customize your preview, then sign in with your Solana wallet to save.'}</p>
      <div className="profile-layout">
        <section className="profile-preview-column" aria-label="Profile preview">
          {!publicView && <p className="eyebrow">LIVE PREVIEW</p>}
          <article className="card profile-card" id="profile-card" data-theme="aurora">
            <div className="profile-banner" id="profile-banner"><img id="profile-banner-image" alt="Profile banner" hidden referrerPolicy="no-referrer" /></div>
            <div className="profile-identity">
              <div className="profile-avatar" id="profile-avatar"><span id="profile-initials">S</span><img id="profile-avatar-image" alt="Profile avatar" hidden referrerPolicy="no-referrer" /></div>
              <span id="profile-visibility" className="profile-chip">Private preview</span>
              <h2 id="profile-display-name">Your display name</h2>
              <p id="profile-handle" className="profile-handle">@your_username</p>
              <div id="profile-roles" className="profile-badges" />
              <p id="profile-bio" className="profile-bio">Tell the community a little about yourself.</p>
              <div id="profile-socials" className="profile-socials" />
              <div id="profile-wallet" className="profile-wallet" hidden />
              <p id="profile-joined" className="hint" />
            </div>
          </article>
          <section id="profile-project-section" className="profile-project-section" hidden>
            <div className="section-head"><h2>Registered projects</h2></div>
            <div id="profile-projects" />
          </section>
          {!publicView && <p className="hint profile-preview-note">Your portfolio, watchlist and private notes stay private. Roles are self-selected; they are not endorsements.</p>}
          <div id="profile-public-error" className="card" hidden><h2 id="profile-error-title">Profile unavailable</h2><p id="profile-error-body" className="hint" /><a className="btn btn-ghost" href="/explore">Explore Signal</a></div>
        </section>
        {!publicView && <form id="profile-form" className="card profile-editor">
          <div className="profile-sign-in-row"><button className="btn btn-ghost" id="profile-sign-in" type="button">Sign in to load or save</button><p className="hint">Sign a wallet message to manage your profile. No transaction or fee.</p></div>
          <fieldset><legend>Your identity</legend>
            <label className="profile-field" htmlFor="profile-username">Username<span className="hint">Your unique link: <span id="profile-link-preview">/u/your_username</span></span>
              <input className="input" id="profile-username" name="username" required minLength={3} maxLength={24} pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" placeholder="Choose a username" autoComplete="username" spellCheck={false} aria-describedby="profile-username-help" />
            </label>
            <p className="hint" id="profile-username-help">3–24 letters, numbers or underscores. Start with a letter. Availability is checked when you save.</p>
            <label className="profile-field" htmlFor="profile-name">Display name<input className="input" id="profile-name" name="displayName" maxLength={50} required placeholder="What should we call you?" /></label>
            <label className="profile-field" htmlFor="profile-bio-input">Bio<textarea className="input" id="profile-bio-input" name="bio" maxLength={280} rows={3} placeholder="What are you building or exploring?" /><span className="hint" id="profile-bio-count">0 / 280</span></label>
            <div className="profile-field"><span>How do you use Signal?</span><div className="profile-role-options">
              {['creator', 'researcher', 'community'].map((role) => <label key={role} className="profile-choice"><input type="checkbox" name="roles" value={role} />{role[0]!.toUpperCase() + role.slice(1)}</label>)}
            </div></div>
          </fieldset>
          <fieldset><legend>Your style</legend>
            <div className="profile-image-options">
              <div><label className="profile-field" htmlFor="profile-avatar-upload">Avatar<input id="profile-avatar-upload" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="btn btn-ghost" type="button" data-remove-image="avatar">Remove avatar</button></div>
              <div><label className="profile-field" htmlFor="profile-banner-upload">Banner<input id="profile-banner-upload" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="btn btn-ghost" type="button" data-remove-image="banner">Remove banner</button></div>
            </div>
            <p className="hint">JPEG, PNG or WebP, up to 5 MB. Images are resized before saving. Square avatars and wide banners work best.</p>
            <div className="profile-appearance-row">
              <label className="profile-field" htmlFor="profile-theme">Theme<select id="profile-theme" className="input" name="theme"><option value="aurora">Aurora</option><option value="midnight">Midnight</option><option value="ocean">Ocean</option><option value="ember">Ember</option></select></label>
              <label className="profile-field" htmlFor="profile-accent">Accent colour<input id="profile-accent" name="accent" type="color" defaultValue="#8b5cf6" /></label>
            </div>
          </fieldset>
          <fieldset><legend>Your links</legend>
            <label className="profile-field" htmlFor="profile-website">Website<input className="input" id="profile-website" type="url" name="website" maxLength={500} placeholder="https://your-site.com" /></label>
            <label className="profile-field" htmlFor="profile-twitter">X<input className="input" id="profile-twitter" type="url" name="twitter" maxLength={500} placeholder="https://x.com/your_handle" /></label>
            <label className="profile-field" htmlFor="profile-telegram">Telegram<input className="input" id="profile-telegram" type="url" name="telegram" maxLength={500} placeholder="https://t.me/your_group" /></label>
          </fieldset>
          <fieldset><legend>Privacy and projects</legend>
            <label className="profile-choice"><input type="checkbox" id="profile-is-public" name="isPublic" /><span>Publish my profile<span className="hint">Allow anyone with your profile link to view it.</span></span></label>
            <label className="profile-choice"><input type="checkbox" id="profile-show-wallet" name="showWallet" /><span>Show my wallet address<span className="hint">Visitors can use it to inspect public blockchain activity.</span></span></label>
            <label className="profile-choice"><input type="checkbox" id="profile-show-projects" name="showProjects" /><span>Show my registered projects<span className="hint">Project transactions may reveal your wallet even if its address is hidden here.</span></span></label>
            <label className="profile-field" htmlFor="profile-featured">Featured project<select className="input" id="profile-featured" name="featuredTokenAddress"><option value="">No featured project</option></select><span className="hint">Choose from projects registered to your signed-in wallet.</span></label>
          </fieldset>
          <div className="profile-actions"><button className="btn btn-brand" id="profile-save" type="submit" disabled>Save private profile</button><a className="btn btn-ghost" id="profile-view-link" hidden>View public profile ↗</a><button className="btn btn-ghost" id="profile-copy-link" type="button" hidden>Copy link</button></div>
          <p id="profile-save-status" className="hint" role="status" aria-live="polite">Connecting a wallet does not publish your profile.</p>
          <details id="profile-delete-section" hidden><summary>Delete profile</summary><p className="hint">Removes your profile and releases your username. Your tokens, wallet and watchlist are unaffected.</p><button className="btn btn-ghost" id="profile-delete" type="button">Delete my profile</button></details>
        </form>}
      </div>
    </div>
  );
}
