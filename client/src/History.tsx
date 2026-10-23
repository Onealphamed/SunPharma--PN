import { useEffect, useState } from 'react';
import type { Rec } from '../../shared/model';
import { api } from './api';
import { useData } from './data';
import { relTime } from './ui';

/** Update history for one record, from the Audit Log tab (internal users only). */
export function History({ recordId }: { recordId: string }) {
  const { snap } = useData();
  const [entries, setEntries] = useState<Rec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.audit(recordId).then(r => live && setEntries(r.entries)).catch(e => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [recordId, snap.version]);
  return (
    <section className="history">
      <h3>Update history</h3>
      {error && <p className="muted">Could not load history: {error}</p>}
      {!entries && !error && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted">No changes recorded since migration.</p>}
      {entries && entries.length > 0 && (
        <ol>
          {entries.map((e, i) => (
            <li key={i}>
              <span className="muted small" title={String(e.timestamp)}>{relTime(String(e.timestamp))}</span> · <strong>{String(e.user)}</strong>{' '}
              {e.field ? (
                <>
                  changed <em>{String(e.field)}</em> from “{String(e.oldValue || '—')}” to “{String(e.newValue || '—')}”
                </>
              ) : (
                String(e.action)
              )}
              {e.source === 'Sheet' && <span className="tag tag-neutral">in sheet</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
