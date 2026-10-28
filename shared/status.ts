// Status vocabulary. The live list lives in the "Status Config" tab so definitions,
// colours and accepted spellings can be maintained without a rebuild; DEFAULT_STATUSES
// seeds that tab and is the fallback if the tab is missing.
//
// The eight statuses are used exactly as specified in the project brief. None of them
// counts as complete: completion is recorded separately with "Completion Confirmed",
// so "Approval" is never mistaken for "done".
import { norm } from './model';
import { StatusCategory, STATUS_CATEGORIES } from './schema';

export interface StatusDef {
  status: string;
  category: StatusCategory;
  countsComplete: boolean;
  color: string;
  definition: string;
  aliases: string[];
  order: number;
  active: boolean;
}

// Colours are validated as a set in CHART_ORDER (adjacent segments in stacked bars) for
// colour-vision deficiency and normal vision, on both the light and dark themes. Based on
// the DK0510 set (amber, pink, grey and violet re-stepped to suit dark mode too), plus cyan
// for "Approval" (here an approval stage, not completion).
export const DEFAULT_STATUSES: StatusDef[] = [
  { status: 'In Progress', category: 'Active', countsComplete: false, color: '#2a78d6', definition: 'Work has started and is actively being executed.', aliases: [], order: 1, active: true },
  { status: 'In Review', category: 'Review', countsComplete: false, color: '#1baf7a', definition: 'The deliverable is undergoing review (internal or client).', aliases: [], order: 2, active: true },
  { status: 'Yet to Start', category: 'Not started', countsComplete: false, color: '#8a8983', definition: 'The deliverable is planned but work has not begun.', aliases: [], order: 3, active: true },
  { status: 'Yet to Assign', category: 'Unassigned', countsComplete: false, color: '#bf8400', definition: 'No responsible owner has been assigned.', aliases: [], order: 4, active: true },
  { status: 'On Hold', category: 'Blocked', countsComplete: false, color: '#e34948', definition: 'Work has been intentionally paused.', aliases: [], order: 5, active: true },
  { status: 'Under Approval', category: 'Approval', countsComplete: false, color: '#7060e4', definition: 'The deliverable is awaiting a formal approval decision.', aliases: [], order: 6, active: true },
  { status: 'Approval', category: 'Approval', countsComplete: false, color: '#0095b3', definition: 'The approval stage has been recorded. The actual decision is captured in "Client Approval Status"; this status does NOT mean the deliverable is complete.', aliases: [], order: 7, active: true },
  { status: 'Pending', category: 'Waiting', countsComplete: false, color: '#d26c95', definition: 'Awaiting an outstanding input, decision or dependency.', aliases: [], order: 8, active: true },
];

export const CATEGORY_COLOR: Record<StatusCategory, string> = {
  'Not started': '#8a8983',
  Unassigned: '#bf8400',
  Active: '#2a78d6',
  Review: '#1baf7a',
  Approval: '#7060e4',
  Waiting: '#d26c95',
  Blocked: '#e34948',
  Completed: '#008300',
  Unmapped: '#6b7280',
};

export const COMPLETE_COLOR = '#008300';

/** Fixed order of statuses in stacked charts (the validated adjacency); completion first. */
export const CHART_ORDER = ['Approval', 'Under Approval', 'In Review', 'Yet to Assign', 'Pending', 'In Progress', 'On Hold', 'Yet to Start'];

export class StatusMap {
  private byName = new Map<string, StatusDef>();
  readonly list: StatusDef[];

  constructor(defs: StatusDef[]) {
    this.list = [...defs].sort((a, b) => a.order - b.order);
    for (const d of this.list) {
      this.byName.set(norm(d.status), d);
      for (const a of d.aliases) if (!this.byName.has(norm(a))) this.byName.set(norm(a), d);
    }
  }

  static fromRecords(records: Record<string, unknown>[] | undefined): StatusMap {
    if (!records || records.length === 0) return new StatusMap(DEFAULT_STATUSES);
    const defs: StatusDef[] = records
      .filter(r => r.status)
      .map((r, i) => {
        const category = (STATUS_CATEGORIES as readonly string[]).includes(String(r.category)) ? (r.category as StatusCategory) : 'Unmapped';
        return {
          status: String(r.status),
          category,
          countsComplete: norm(r.countsComplete) === 'yes',
          color: r.color ? String(r.color) : CATEGORY_COLOR[category],
          definition: String(r.definition ?? ''),
          aliases: String(r.aliases ?? '').split(',').map(x => x.trim()).filter(Boolean),
          order: typeof r.order === 'number' ? r.order : 100 + i,
          active: norm(r.active) !== 'no',
        };
      });
    return new StatusMap(defs);
  }

  get(status: unknown): StatusDef | undefined {
    return this.byName.get(norm(status));
  }

  /** The configured label for a value typed with different spelling or capitalisation. */
  canonical(status: unknown): string {
    return this.get(status)?.status ?? String(status ?? '');
  }

  category(status: unknown): StatusCategory {
    return this.get(status)?.category ?? 'Unmapped';
  }

  isComplete(status: unknown): boolean {
    return this.get(status)?.countsComplete ?? false;
  }

  color(status: unknown): string {
    return this.get(status)?.color ?? CATEGORY_COLOR.Unmapped;
  }

  activeNames(): string[] {
    return this.list.filter(d => d.active).map(d => d.status);
  }
}
