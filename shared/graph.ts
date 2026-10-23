// Dependency graph: validation, critical path and slip-impact analysis.
// Dependencies are finish-to-start. Nothing here invents links: with no recorded
// predecessors, there is no critical path and the UI says so.
import { addWorkingDays, ISODate, maxDate, WorkCalendar, workingDayDiff, workingDaysInclusive } from './dates';
import { splitIds } from './model';

export interface GraphTask {
  id: string;
  start: ISODate | null;
  end: ISODate | null;
  predecessors: string[];
  complete: boolean;
}

export interface GraphResult {
  successors: Map<string, string[]>;
  unknownRefs: { id: string; ref: string }[];
  selfRefs: string[];
  cycles: string[][];
  linkCount: number;
  /** IDs on the critical path (zero float, connected by dependencies). Empty if not computable. */
  critical: Set<string>;
  /** Total float in working days per task (only for tasks in the dependency network). */
  float: Map<string, number>;
  /** Successor starts before or on predecessor finish. */
  conflicts: { pred: string; succ: string; overlapWd: number }[];
}

export function toGraphTasks(rows: { id: string; start: ISODate | null; end: ISODate | null; predecessors: string | null | undefined; complete: boolean }[]): GraphTask[] {
  return rows.map(r => ({ id: r.id, start: r.start, end: r.end, predecessors: splitIds(r.predecessors), complete: r.complete }));
}

export function findCycles(tasks: GraphTask[]): string[][] {
  const ids = new Set(tasks.map(t => t.id));
  const preds = new Map(tasks.map(t => [t.id, t.predecessors.filter(p => ids.has(p) && p !== t.id)]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const p of preds.get(id) ?? []) {
      if (state.get(p) === 1) {
        const cyc = stack.slice(stack.indexOf(p));
        const sig = [...cyc].sort().join('>');
        if (!seen.has(sig)) {
          seen.add(sig);
          cycles.push(cyc);
        }
      } else if (!state.get(p)) visit(p);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.get(t.id)) visit(t.id);
  return cycles;
}

/** Would setting `id`'s predecessors to `preds` create a cycle? */
export function wouldCreateCycle(tasks: GraphTask[], id: string, preds: string[]): string[] | null {
  const next = tasks.map(t => (t.id === id ? { ...t, predecessors: preds } : t));
  const cyc = findCycles(next).find(c => c.includes(id));
  return cyc ?? (preds.includes(id) ? [id] : null);
}

export function analyseGraph(tasks: GraphTask[], cal: WorkCalendar): GraphResult {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const successors = new Map<string, string[]>();
  const unknownRefs: { id: string; ref: string }[] = [];
  const selfRefs: string[] = [];
  let linkCount = 0;
  for (const t of tasks) {
    for (const p of t.predecessors) {
      if (p === t.id) {
        selfRefs.push(t.id);
        continue;
      }
      if (!byId.has(p)) {
        unknownRefs.push({ id: t.id, ref: p });
        continue;
      }
      linkCount++;
      if (!successors.has(p)) successors.set(p, []);
      successors.get(p)!.push(t.id);
    }
  }
  const cycles = findCycles(tasks);
  const conflicts: GraphResult['conflicts'] = [];
  for (const t of tasks) {
    for (const p of t.predecessors) {
      const pt = byId.get(p);
      if (!pt || p === t.id || !pt.end || !t.start) continue;
      if (t.start <= pt.end) conflicts.push({ pred: p, succ: t.id, overlapWd: workingDaysInclusive(t.start, pt.end, cal) });
    }
  }

  const critical = new Set<string>();
  const float = new Map<string, number>();
  if (linkCount > 0 && cycles.length === 0) {
    // Backward pass over the dependency network using planned dates.
    const inNetwork = tasks.filter(t => t.start && t.end && (successors.has(t.id) || t.predecessors.some(p => byId.has(p))));
    const projectEnd = maxDate(inNetwork.map(t => t.end));
    const lateFinish = new Map<string, ISODate>();
    const order = topoOrder(inNetwork, successors).reverse();
    for (const t of order) {
      const succ = (successors.get(t.id) ?? []).map(s => byId.get(s)!).filter(s => s.start && s.end);
      let lf: ISODate = projectEnd!;
      for (const s of succ) {
        const sLf = lateFinish.get(s.id) ?? s.end!;
        const sDur = workingDaysInclusive(s.start!, s.end!, cal);
        const sLs = addWorkingDays(sLf, -(Math.max(sDur, 1) - 1), cal);
        const candidate = addWorkingDays(sLs, -1, cal);
        if (candidate < lf) lf = candidate;
      }
      lateFinish.set(t.id, lf);
      const f = workingDayDiff(t.end!, lf, cal);
      float.set(t.id, f);
      if (f <= 0 && !t.complete) critical.add(t.id);
    }
  }
  return { successors, unknownRefs, selfRefs, cycles, linkCount, critical, float, conflicts };
}

function topoOrder(tasks: GraphTask[], successors: Map<string, string[]>): GraphTask[] {
  const ids = new Set(tasks.map(t => t.id));
  const indeg = new Map(tasks.map(t => [t.id, t.predecessors.filter(p => ids.has(p)).length]));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const queue = tasks.filter(t => indeg.get(t.id) === 0).map(t => t.id);
  const out: GraphTask[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const s of successors.get(id) ?? []) {
      if (!indeg.has(s)) continue;
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  return out;
}

export interface SlipImpact {
  id: string;
  oldStart: ISODate;
  oldEnd: ISODate;
  newStart: ISODate;
  newEnd: ISODate;
  slipWd: number;
}

/**
 * If `id` finishes `slipWd` working days later than planned, which downstream
 * deliverables must move, and by how much? Successors keep their duration and start
 * the working day after their latest predecessor finishes (if that is later than now).
 */
export function slipImpact(tasks: GraphTask[], id: string, slipWd: number, cal: WorkCalendar): SlipImpact[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const g = analyseGraph(tasks, cal);
  if (g.cycles.length) return [];
  const newEnd = new Map<string, ISODate>();
  const root = byId.get(id);
  if (!root?.end) return [];
  newEnd.set(id, addWorkingDays(root.end, slipWd, cal));
  const out: SlipImpact[] = [];
  const queue = [...(g.successors.get(id) ?? [])];
  const visited = new Set<string>();
  while (queue.length) {
    const sid = queue.shift()!;
    const s = byId.get(sid);
    if (!s?.start || !s.end) continue;
    // Process only once all of its moved predecessors are known.
    const predEnds = s.predecessors.map(p => newEnd.get(p) ?? byId.get(p)?.end ?? null);
    const latest = maxDate(predEnds);
    if (!latest) continue;
    const earliestStart = addWorkingDays(latest, 1, cal);
    if (earliestStart > s.start) {
      const dur = Math.max(workingDaysInclusive(s.start, s.end, cal), 1);
      const ns = earliestStart;
      const ne = addWorkingDays(ns, dur - 1, cal);
      newEnd.set(sid, ne);
      const prev = out.findIndex(o => o.id === sid);
      const entry = { id: sid, oldStart: s.start, oldEnd: s.end, newStart: ns, newEnd: ne, slipWd: workingDayDiff(s.end, ne, cal) };
      if (prev >= 0) out[prev] = entry;
      else out.push(entry);
      for (const n of g.successors.get(sid) ?? []) queue.push(n);
    } else if (!visited.has(sid)) {
      visited.add(sid);
    }
  }
  return out;
}
