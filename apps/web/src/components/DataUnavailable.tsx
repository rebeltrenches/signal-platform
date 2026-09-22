import React from 'react';
import type { DataPoint } from '@launchpad/types';

/**
 * Renders a DataPoint<T> honestly — spec section 3/10/41: never invent a
 * value for a metric we don't actually have. This is the ONE place that
 * decides how "we don't know yet" looks, so it can't accidentally drift
 * into looking like a real zero somewhere in the app.
 */
export function DataValue<T>({ point, format }: { point: DataPoint<T>; format: (v: T) => string }) {
  if (point.status === 'unavailable') {
    return <span className="data-unavailable" title="Signal does not currently have verified data for this field">Unavailable</span>;
  }
  return <>{format(point.value)}</>;
}
