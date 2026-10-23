import { useCallback } from 'react';
import { norm } from '../../../shared/model';
import { useData } from '../data';

/** Save Settings values by key: updates existing rows, adds missing ones (PM only, enforced server-side). */
export function useSetting() {
  const { project, update, create } = useData();
  return useCallback(
    async (pairs: [string, string][]) => {
      for (const [key, value] of pairs) {
        const rec = (project.tables.settings ?? []).find(r => norm(r.key) === norm(key));
        if (rec) {
          if (String(rec.value ?? '') !== value) await update('settings', rec, { value: value || null });
        } else if (value) {
          await create('settings', { key, value, visibility: 'Client' });
        }
      }
    },
    [project.tables.settings, update, create],
  );
}
