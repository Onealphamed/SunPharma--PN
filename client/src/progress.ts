// Indicative progress per deliverable, by status stage (as in the EAN reference tracker).
// Completion itself still counts only "Completion Confirmed = Yes", shown as 100%.
import { norm } from '../../shared/model';
import { Deliverable } from '../../shared/project';

export const STATUS_PROGRESS: [string, number][] = [
  ['Yet to Start', 0],
  ['Yet to Assign', 0],
  ['Pending', 0],
  ['In Progress', 50],
  ['On Hold', 50],
  ['In Review', 80],
  ['Under Approval', 90],
  ['Approval', 90],
];
const PROGRESS_BY = new Map(STATUS_PROGRESS.map(([s, v]) => [norm(s), v]));

export const progressOf = (d: Deliverable) => (d.complete ? 100 : PROGRESS_BY.get(norm(d.status)) ?? 0);

export const PROGRESS_HELP = `Indicative stage by status: ${STATUS_PROGRESS.map(([s, v]) => `${s} ${v}%`).join(' · ')} · Completion confirmed 100%`;
