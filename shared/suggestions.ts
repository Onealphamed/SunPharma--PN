// Dependency SUGGESTIONS read from the Readiness Checklist's own Remarks column.
// Nothing here is applied automatically: the PM reviews each suggestion on the
// Risks & Dependencies page and applies it with one click (or ignores it).
import { norm } from './model';
import type { Deliverable } from './project';

export interface DependencySuggestion {
  /** Deliverable that should wait. */
  successor: string;
  /** Prerequisite deliverable. */
  predecessor: string;
  /** Checklist remark the suggestion is based on, quoted with its source row. */
  basis: string;
}

interface Rule {
  /** Remark on the deliverable that carries the rule. */
  remark: RegExp;
  /** Which side of the dependency the remark's own deliverable is on. */
  self: 'successor' | 'predecessor';
  /** The other side, matched by task name. */
  other: RegExp;
}

const RULES: Rule[] = [
  // "Starts only after content approval" on AB-1..AB-4 invitations.
  { remark: /^starts only after content approval/i, self: 'successor', other: /^◆?\s*content pack approved/i },
  // "Gate for all KOL invitations" on the content-approval milestone.
  { remark: /^gate for all kol invitations/i, self: 'predecessor', other: /invitations sent with approved agenda/i },
  // "Gate for NAB-5 pre-read" on Sun approval of national content.
  { remark: /^gate for nab-5 pre-read/i, self: 'predecessor', other: /^nab-5: pre-read sent/i },
  // "Required before booking" on the NAB-5 travel approval.
  { remark: /^required before booking/i, self: 'predecessor', other: /^nab-5: air travel, hotel and transfers booked/i },
  // "Confirm in writing before any booking" on the Phase 1 travel scope decision.
  { remark: /^confirm in writing before any booking/i, self: 'predecessor', other: /outstation travel and stay \(only if requested\)|air travel, hotel and transfers booked/i },
];

export function suggestDependencies(ds: Deliverable[]): DependencySuggestion[] {
  const out: DependencySuggestion[] = [];
  const seen = new Set<string>();
  for (const x of ds) {
    const remark = String(x.rec.remarks ?? '').trim();
    if (!remark) continue;
    for (const rule of RULES) {
      if (!rule.remark.test(remark)) continue;
      for (const o of ds.filter(y => y.key !== x.key && rule.other.test(y.name))) {
        const [successor, predecessor] = rule.self === 'successor' ? [x, o] : [o, x];
        const sig = `${successor.key}>${predecessor.key}`;
        if (seen.has(sig) || successor.predecessors.some(p => norm(p) === norm(predecessor.key))) continue;
        seen.add(sig);
        out.push({ successor: successor.key, predecessor: predecessor.key, basis: `${x.id} remark: "${remark}"` });
      }
    }
  }
  return out;
}
