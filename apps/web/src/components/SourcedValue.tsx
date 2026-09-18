import React from 'react';
import type { SourcedDataPoint, EvidenceSource } from '@launchpad/types';

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  'blockchain-derived': 'Blockchain-derived',
  'signal-verified': 'Signal-verified',
  'creator-provided': 'Creator-provided',
  'third-party': 'Third-party',
  'community-reported': 'Community-reported',
};

const SOURCE_COLOR: Record<EvidenceSource, string> = {
  'blockchain-derived': 'var(--up)',
  'signal-verified': 'var(--brand)',
  'creator-provided': 'var(--gold)',
  'third-party': 'var(--ink-dim)',
  'community-reported': 'var(--ink-faint)',
};

/** Renders a fact's source as a small, honest tag — spec section 11: never
 *  let a fact look like Signal generated or verified something it only
 *  relayed from elsewhere. */
export function SourceTag({ source }: { source: EvidenceSource }) {
  return (
    <span
      className="badge"
      style={{ borderColor: SOURCE_COLOR[source], color: SOURCE_COLOR[source], textTransform: 'none' }}
      title={`Source: ${SOURCE_LABEL[source]}`}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

/** A row pairing a label, a value (or honest "Unavailable"), and its
 *  evidence source. This is the one place a fact's source and its value
 *  are shown together, so no other component has to remember to do both. */
export function SourcedRow<T>({
  label,
  data,
  format,
}: {
  label: string;
  data: SourcedDataPoint<T>;
  format: (v: T) => string;
}) {
  return (
    <div className="review-row">
      <span className="k">{label}</span>
      <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {data.point.status === 'available' ? (
          format(data.point.value)
        ) : (
          <span className="data-unavailable">Unavailable</span>
        )}
        <SourceTag source={data.source} />
      </span>
    </div>
  );
}
