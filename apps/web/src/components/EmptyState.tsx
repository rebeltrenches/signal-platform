import React from 'react';

const DEFAULT_ICON = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
  </>
);

export function EmptyState({ title, body, cta, icon }: { title: string; body: string; cta?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        {icon || DEFAULT_ICON}
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      {cta && <div style={{ marginTop: 18 }}>{cta}</div>}
    </div>
  );
}
