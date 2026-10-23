// Single definition of every tab in the live tracker sheet. The server uses it to read,
// validate and write; the client uses it to render forms and enforce UI-level
// editability (the server re-checks every permission).
//
// Columns are matched by HEADER TEXT, not position, so the project team can reorder
// or insert columns in the Google Sheet without breaking the dashboard.

export type Role = 'admin' | 'editor' | 'client';
export const ROLES: Role[] = ['admin', 'editor', 'client'];
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Project Manager (admin)',
  editor: 'OneAlphaMed team (editor)',
  client: 'Sun Pharma (read-only)',
};

export type ColType = 'id' | 'text' | 'longtext' | 'date' | 'datetime' | 'number' | 'enum' | 'idlist';

export interface ColumnSpec {
  key: string;
  header: string;
  type: ColType;
  /** Fixed option list (enum). Status options come from the Status Config tab instead. */
  options?: string[];
  optionsFrom?: 'statuses';
  required?: boolean;
  /** Hidden from the client role. Stripped server-side, never sent to the browser. */
  internal?: boolean;
  /** Lowest role allowed to edit through the dashboard. 'none' = system-managed. */
  edit?: 'editor' | 'admin' | 'none';
  /** Header aliases accepted when reading (e.g. original checklist names). */
  aliases?: string[];
  help?: string;
}

export type TableKey =
  | 'deliverables' | 'statuses' | 'settings' | 'holidays' | 'phases'
  | 'raid' | 'decisions' | 'meetings' | 'actions' | 'comments' | 'audit';

export interface TableSpec {
  key: TableKey;
  /** Tab name in the source sheet. */
  tab: string;
  label: string;
  idKey: string;
  idPrefix: string;
  columns: ColumnSpec[];
  /** Whole tab is internal (never sent to client role). */
  internalOnly?: boolean;
  /** Row-level client visibility rule. */
  clientRows?: { key: string; hiddenValues: string[] };
  /** Lowest role that may add rows. */
  create?: 'editor' | 'admin' | 'none';
  /** Archive (soft delete) column, if supported. */
  archiveKey?: string;
}

const YES_NO = ['Yes', 'No'];
/** Lead values used in the Readiness Checklist. */
export const LEADS = ['OAM', 'Sun', 'Joint', 'Vendor'];
export const ORGS = ['OneAlphaMed', 'Sun Pharma', 'Joint', 'Vendor'];
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
/** Types used in the Readiness Checklist. */
export const DELIVERABLE_TYPES = ['Task', 'Client Input', 'Approval Gate', 'Milestone'];
/** Approval decision, kept separate from the workflow Status (brief §E). */
export const APPROVAL_DECISIONS = ['Not Required', 'Not Submitted', 'Pending Approval', 'Approved', 'Rejected'];
export const SCHEDULE_FLAGS = ['Upcoming', 'On Track', 'At Risk', 'Overdue', 'Completed'] as const;
export type ScheduleFlag = (typeof SCHEDULE_FLAGS)[number];
export const VISIBILITY = ['Client', 'Internal'];
export const PHASE_NUMBERS = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5'];
export const STATUS_CATEGORIES = ['Not started', 'Unassigned', 'Active', 'Review', 'Approval', 'Waiting', 'Blocked', 'Completed'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number] | 'Unmapped';

const audit: ColumnSpec[] = [
  { key: 'lastUpdated', header: 'Last Updated', type: 'datetime', edit: 'none' },
  { key: 'updatedBy', header: 'Updated By', type: 'text', edit: 'none', internal: true },
];

export const TABLES: Record<TableKey, TableSpec> = {
  deliverables: {
    key: 'deliverables', tab: 'Deliverables', label: 'Deliverables', idKey: 'id', idPrefix: 'PN-',
    create: 'editor', archiveKey: 'archived',
    clientRows: { key: 'clientVisible', hiddenValues: ['No'] },
    columns: [
      { key: 'id', header: 'Deliverable ID', type: 'id', required: true, edit: 'none' },
      { key: 'phase', header: 'Phase', type: 'enum', options: PHASE_NUMBERS, required: true, edit: 'admin' },
      { key: 'wsCode', header: 'Workstream Code', type: 'text', edit: 'admin', help: 'Section number from the Readiness Checklist, e.g. 3.1' },
      { key: 'workstream', header: 'Workstream', type: 'text', required: true, edit: 'admin' },
      { key: 'name', header: 'Task / Activity', type: 'text', required: true, edit: 'editor' },
      { key: 'description', header: 'Description & Key Deliverables', type: 'longtext', edit: 'editor' },
      { key: 'type', header: 'Type', type: 'enum', options: DELIVERABLE_TYPES, edit: 'editor' },
      { key: 'lead', header: 'Lead', type: 'enum', options: LEADS, edit: 'editor', help: 'OAM = OneAlphaMed, Sun = Sun Pharma, Joint, Vendor' },
      { key: 'leadFunction', header: 'Lead Function', type: 'text', edit: 'editor' },
      { key: 'oamOwner', header: 'OneAlphaMed Owner', type: 'text', edit: 'editor', aliases: ['OAM Owner'] },
      { key: 'sunOwner', header: 'Sun Pharma Owner', type: 'text', edit: 'editor', aliases: ['Sun Owner'] },
      { key: 'plannedStart', header: 'Planned Start Date', type: 'date', edit: 'editor', aliases: ['Planned Start', 'Start Date'], help: 'Leave blank until confirmed — the dashboard shows "Date not confirmed".' },
      { key: 'plannedEnd', header: 'Planned End Date', type: 'date', edit: 'editor', aliases: ['Planned End', 'End Date'] },
      { key: 'durationWd', header: 'Duration (Working Days)', type: 'number', edit: 'editor', aliases: ['Duration (WD)'], help: 'Planned effort in working days (from the checklist). Working days, not calendar days.' },
      { key: 'baselineStart', header: 'Baseline Start', type: 'date', edit: 'admin', help: 'Captured automatically the first time planned dates are saved. Only the PM can re-baseline.' },
      { key: 'baselineEnd', header: 'Baseline End', type: 'date', edit: 'admin' },
      { key: 'actualStart', header: 'Actual Start Date', type: 'date', edit: 'editor' },
      { key: 'actualEnd', header: 'Actual Completion Date', type: 'date', edit: 'editor' },
      { key: 'status', header: 'Status', type: 'enum', optionsFrom: 'statuses', required: true, edit: 'editor' },
      { key: 'completionConfirmed', header: 'Completion Confirmed', type: 'enum', options: YES_NO, edit: 'editor', help: 'The ONLY completion rule: a deliverable counts as complete when this is "Yes". No status (including "Approval") implies completion.' },
      { key: 'priority', header: 'Priority', type: 'enum', options: PRIORITIES, edit: 'editor' },
      { key: 'predecessors', header: 'Dependency', type: 'idlist', edit: 'editor', aliases: ['Dependencies', 'Predecessors'], help: 'Prerequisite deliverable IDs (finish-to-start), comma separated' },
      { key: 'keyMilestone', header: 'Key Milestone', type: 'enum', options: YES_NO, edit: 'admin', help: 'Show on the milestone view even if Type is not "Milestone"' },
      { key: 'scheduleFlagSource', header: 'Schedule Flag (Checklist)', type: 'text', edit: 'none', help: 'Value imported from the checklist, kept for traceability. The live Schedule Flag is calculated.' },
      { key: 'statusOriginal', header: 'Original Status (Checklist)', type: 'text', edit: 'none', internal: true },
      { key: 'risk', header: 'Risk / Blocker', type: 'longtext', edit: 'editor' },
      { key: 'remarks', header: 'Remarks', type: 'longtext', edit: 'editor' },
      { key: 'nextAction', header: 'Next Action', type: 'text', edit: 'editor' },
      { key: 'actionOwner', header: 'Action Owner', type: 'text', edit: 'editor' },
      { key: 'targetDate', header: 'Target Date', type: 'date', edit: 'editor', help: 'Deadline for the next action' },
      { key: 'approvalStatus', header: 'Client Approval Status', type: 'enum', options: APPROVAL_DECISIONS, edit: 'editor', help: 'The approval decision — separate from the workflow Status' },
      { key: 'clientApprover', header: 'Client Approver', type: 'text', edit: 'editor' },
      { key: 'dateSubmitted', header: 'Submission Date', type: 'date', edit: 'editor' },
      { key: 'reviewTurnaroundWd', header: 'Review Turnaround (WD)', type: 'number', edit: 'editor', help: 'Leave blank to use the project default from Settings' },
      { key: 'approvalDue', header: 'Approval Due Date', type: 'date', edit: 'editor', help: 'Leave blank to calculate from Submission Date + review turnaround' },
      { key: 'approvalFeedback', header: 'Feedback Received', type: 'longtext', edit: 'editor' },
      { key: 'lastFollowUp', header: 'Latest Follow-up Date', type: 'date', edit: 'editor' },
      { key: 'nextFollowUp', header: 'Next Follow-up Action', type: 'text', edit: 'editor' },
      { key: 'internalNotes', header: 'Internal Notes', type: 'longtext', edit: 'editor', internal: true, help: 'OneAlphaMed only — never shown to Sun Pharma' },
      { key: 'clientVisible', header: 'Client Visible', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      { key: 'archived', header: 'Archived', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      { key: 'sortOrder', header: 'Sort Order', type: 'number', edit: 'admin', internal: true },
      { key: 'sourceRow', header: 'Checklist Row', type: 'number', edit: 'none', internal: true, help: 'Row number in the Readiness Checklist worksheet this item was imported from' },
      ...audit,
    ],
  },
  statuses: {
    key: 'statuses', tab: 'Status Config', label: 'Status configuration', idKey: 'status', idPrefix: '', create: 'admin',
    columns: [
      { key: 'status', header: 'Status', type: 'text', required: true, edit: 'admin' },
      { key: 'category', header: 'Category', type: 'enum', options: [...STATUS_CATEGORIES], required: true, edit: 'admin' },
      { key: 'countsComplete', header: 'Counts as Complete', type: 'enum', options: YES_NO, required: true, edit: 'admin', help: 'Default No for all eight statuses. Completion is recorded with "Completion Confirmed".' },
      { key: 'color', header: 'Colour', type: 'text', edit: 'admin' },
      { key: 'definition', header: 'Definition', type: 'longtext', edit: 'admin' },
      { key: 'aliases', header: 'Accepted Spellings', type: 'text', edit: 'admin', help: 'Other spellings mapped to this status, comma separated' },
      { key: 'order', header: 'Sort Order', type: 'number', edit: 'admin' },
      { key: 'active', header: 'Active', type: 'enum', options: YES_NO, edit: 'admin' },
    ],
  },
  settings: {
    key: 'settings', tab: 'Settings', label: 'Project settings', idKey: 'key', idPrefix: '', create: 'admin',
    clientRows: { key: 'visibility', hiddenValues: ['Internal'] },
    columns: [
      { key: 'key', header: 'Key', type: 'text', required: true, edit: 'admin' },
      { key: 'value', header: 'Value', type: 'longtext', edit: 'admin' },
      { key: 'notes', header: 'Notes', type: 'longtext', edit: 'admin', internal: true },
      { key: 'visibility', header: 'Visibility', type: 'enum', options: VISIBILITY, edit: 'admin', internal: true },
    ],
  },
  holidays: {
    key: 'holidays', tab: 'Holidays', label: 'Holidays', idKey: 'date', idPrefix: '', create: 'admin',
    columns: [
      { key: 'date', header: 'Date', type: 'date', required: true, edit: 'admin' },
      { key: 'name', header: 'Holiday', type: 'text', edit: 'admin' },
      { key: 'region', header: 'Applies To', type: 'text', edit: 'admin' },
    ],
  },
  phases: {
    key: 'phases', tab: 'Phases', label: 'Phases', idKey: 'phase', idPrefix: '', create: 'admin',
    columns: [
      { key: 'phase', header: 'Phase', type: 'text', required: true, edit: 'none' },
      { key: 'name', header: 'Phase Name', type: 'text', edit: 'admin' },
      { key: 'summary', header: 'Objective & Scope', type: 'longtext', edit: 'admin' },
      { key: 'order', header: 'Sort Order', type: 'number', edit: 'admin' },
    ],
  },
  raid: {
    key: 'raid', tab: 'Risks & Issues', label: 'Risk & issue log', idKey: 'id', idPrefix: 'RSK-', create: 'editor', archiveKey: 'archived',
    clientRows: { key: 'visibility', hiddenValues: ['Internal'] },
    columns: [
      { key: 'id', header: 'Risk / Issue ID', type: 'id', required: true, edit: 'none' },
      { key: 'category', header: 'Category', type: 'enum', options: ['Risk', 'Issue', 'Dependency', 'Assumption'], required: true, edit: 'editor' },
      { key: 'title', header: 'Description', type: 'text', required: true, edit: 'editor' },
      { key: 'details', header: 'Details', type: 'longtext', edit: 'editor' },
      { key: 'phase', header: 'Related Phase', type: 'enum', options: PHASE_NUMBERS, edit: 'editor' },
      { key: 'related', header: 'Related Deliverable', type: 'idlist', edit: 'editor' },
      { key: 'impact', header: 'Impact', type: 'enum', options: ['High', 'Medium', 'Low'], edit: 'editor' },
      { key: 'likelihood', header: 'Likelihood', type: 'enum', options: ['High', 'Medium', 'Low'], edit: 'editor' },
      { key: 'severity', header: 'Severity', type: 'enum', options: PRIORITIES, edit: 'editor', help: 'Leave blank to derive from Impact × Likelihood' },
      { key: 'mitigation', header: 'Mitigation / Resolution Plan', type: 'longtext', edit: 'editor' },
      { key: 'owner', header: 'Owner', type: 'text', edit: 'editor' },
      { key: 'ownerOrg', header: 'Owner Organisation', type: 'enum', options: ORGS, edit: 'editor' },
      { key: 'dateRaised', header: 'Raised Date', type: 'date', edit: 'editor' },
      { key: 'targetDate', header: 'Target Resolution Date', type: 'date', edit: 'editor' },
      { key: 'status', header: 'Status', type: 'enum', options: ['Open', 'Monitoring', 'Escalated', 'Mitigated', 'Resolved', 'Closed'], required: true, edit: 'editor' },
      { key: 'clientDecision', header: 'Client Decision Required', type: 'enum', options: YES_NO, edit: 'editor' },
      { key: 'latestUpdate', header: 'Latest Update', type: 'longtext', edit: 'editor' },
      { key: 'escalation', header: 'Internal Escalation Notes', type: 'longtext', edit: 'editor', internal: true },
      { key: 'visibility', header: 'Visibility', type: 'enum', options: VISIBILITY, required: true, edit: 'editor' },
      { key: 'archived', header: 'Archived', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      ...audit,
    ],
  },
  decisions: {
    key: 'decisions', tab: 'Decision Log', label: 'Decision log', idKey: 'id', idPrefix: 'DEC-', create: 'editor', archiveKey: 'archived',
    clientRows: { key: 'visibility', hiddenValues: ['Internal'] },
    columns: [
      { key: 'id', header: 'Decision ID', type: 'id', required: true, edit: 'none' },
      { key: 'decision', header: 'Decision Required', type: 'text', required: true, edit: 'editor' },
      { key: 'context', header: 'Context', type: 'longtext', edit: 'editor' },
      { key: 'owner', header: 'Decision Owner', type: 'text', edit: 'editor' },
      { key: 'ownerOrg', header: 'Owner Organisation', type: 'enum', options: ORGS, edit: 'editor' },
      { key: 'dueDate', header: 'Due Date', type: 'date', edit: 'editor' },
      { key: 'status', header: 'Status', type: 'enum', options: ['Open', 'Decided', 'Deferred', 'Withdrawn'], required: true, edit: 'editor' },
      { key: 'finalDecision', header: 'Decision Made', type: 'longtext', edit: 'editor' },
      { key: 'dateRecorded', header: 'Date Recorded', type: 'date', edit: 'editor' },
      { key: 'phase', header: 'Related Phase', type: 'enum', options: PHASE_NUMBERS, edit: 'editor' },
      { key: 'related', header: 'Related Deliverable', type: 'idlist', edit: 'editor' },
      { key: 'meetingId', header: 'Source Meeting', type: 'text', edit: 'editor' },
      { key: 'visibility', header: 'Visibility', type: 'enum', options: VISIBILITY, required: true, edit: 'editor' },
      { key: 'archived', header: 'Archived', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      ...audit,
    ],
  },
  meetings: {
    key: 'meetings', tab: 'Meetings', label: 'Meeting minutes', idKey: 'id', idPrefix: 'MTG-', create: 'editor', archiveKey: 'archived',
    clientRows: { key: 'visibility', hiddenValues: ['Internal'] },
    columns: [
      { key: 'id', header: 'Meeting ID', type: 'id', required: true, edit: 'none' },
      { key: 'title', header: 'Meeting Title', type: 'text', required: true, edit: 'editor' },
      { key: 'phase', header: 'Project Phase', type: 'enum', options: [...PHASE_NUMBERS, 'All phases'], edit: 'editor' },
      { key: 'date', header: 'Meeting Date', type: 'date', required: true, edit: 'editor' },
      { key: 'startTime', header: 'Start Time', type: 'text', edit: 'editor', help: 'e.g. 10:30' },
      { key: 'endTime', header: 'End Time', type: 'text', edit: 'editor' },
      { key: 'type', header: 'Meeting Type', type: 'enum', options: ['Kick-off', 'Status review', 'Client review', 'Content review', 'Steering committee', 'Internal', 'Board debrief', 'Other'], edit: 'editor' },
      { key: 'organiser', header: 'Meeting Organiser', type: 'text', edit: 'editor' },
      { key: 'clientParticipants', header: 'Client Participants', type: 'longtext', edit: 'editor' },
      { key: 'oamParticipants', header: 'OneAlphaMed Participants', type: 'longtext', edit: 'editor' },
      { key: 'attendees', header: 'Other Attendees', type: 'longtext', edit: 'editor' },
      { key: 'objective', header: 'Meeting Objective', type: 'longtext', edit: 'editor' },
      { key: 'agenda', header: 'Agenda', type: 'longtext', edit: 'editor' },
      { key: 'summary', header: 'Executive Summary', type: 'longtext', edit: 'editor' },
      { key: 'discussion', header: 'Key Discussion Points', type: 'longtext', edit: 'editor' },
      { key: 'decisions', header: 'Decisions Made', type: 'longtext', edit: 'editor', help: 'One decision per line — each line can be converted into an action item or a decision-log entry' },
      { key: 'openQuestions', header: 'Open Questions', type: 'longtext', edit: 'editor' },
      { key: 'risks', header: 'Risks or Concerns Raised', type: 'longtext', edit: 'editor' },
      { key: 'clientFeedback', header: 'Client Feedback', type: 'longtext', edit: 'editor' },
      { key: 'clarifications', header: 'Pending Clarifications', type: 'longtext', edit: 'editor' },
      { key: 'nextMeeting', header: 'Next Meeting Date', type: 'date', edit: 'editor' },
      { key: 'nextAgenda', header: 'Next Meeting Agenda', type: 'longtext', edit: 'editor' },
      { key: 'followUp', header: 'Follow-up Communication Notes', type: 'longtext', edit: 'editor' },
      { key: 'links', header: 'Attachments / Reference Links', type: 'longtext', edit: 'editor', help: 'One link per line (SharePoint, Drive, email reference…)' },
      { key: 'internalNotes', header: 'Internal Notes', type: 'longtext', edit: 'editor', internal: true },
      { key: 'visibility', header: 'Visibility', type: 'enum', options: VISIBILITY, required: true, edit: 'editor' },
      { key: 'archived', header: 'Archived', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      ...audit,
    ],
  },
  actions: {
    key: 'actions', tab: 'Action Items', label: 'Action items', idKey: 'id', idPrefix: 'ACT-', create: 'editor', archiveKey: 'archived',
    clientRows: { key: 'visibility', hiddenValues: ['Internal'] },
    columns: [
      { key: 'id', header: 'Action ID', type: 'id', required: true, edit: 'none' },
      { key: 'action', header: 'Action Item', type: 'text', required: true, edit: 'editor' },
      { key: 'meetingId', header: 'Meeting ID', type: 'text', edit: 'editor' },
      { key: 'related', header: 'Linked Deliverable', type: 'text', edit: 'editor', help: 'A deliverable ID, e.g. PN-2.3.01' },
      { key: 'owner', header: 'Responsible Owner', type: 'text', edit: 'editor' },
      { key: 'ownerOrg', header: 'Organisation', type: 'enum', options: ORGS, edit: 'editor' },
      { key: 'function', header: 'Function', type: 'text', edit: 'editor' },
      { key: 'dueDate', header: 'Target Completion Date', type: 'date', edit: 'editor' },
      { key: 'priority', header: 'Priority', type: 'enum', options: PRIORITIES, edit: 'editor' },
      { key: 'status', header: 'Status', type: 'enum', options: ['Open', 'In Progress', 'On Hold', 'Done', 'Cancelled'], required: true, edit: 'editor' },
      { key: 'latestUpdate', header: 'Latest Update', type: 'longtext', edit: 'editor' },
      { key: 'dateClosed', header: 'Date Closed', type: 'date', edit: 'editor' },
      { key: 'visibility', header: 'Visibility', type: 'enum', options: VISIBILITY, required: true, edit: 'editor' },
      { key: 'archived', header: 'Archived', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      ...audit,
    ],
  },
  comments: {
    key: 'comments', tab: 'Comments', label: 'Comments & updates', idKey: 'id', idPrefix: 'CMT-', create: 'editor', archiveKey: 'archived',
    clientRows: { key: 'visibility', hiddenValues: ['Internal'] },
    columns: [
      { key: 'id', header: 'Comment ID', type: 'id', required: true, edit: 'none' },
      { key: 'deliverableId', header: 'Deliverable ID', type: 'text', required: true, edit: 'editor' },
      { key: 'comment', header: 'Comment', type: 'longtext', required: true, edit: 'editor' },
      { key: 'author', header: 'Author', type: 'text', edit: 'none' },
      { key: 'postedAt', header: 'Posted At', type: 'datetime', edit: 'none' },
      { key: 'visibility', header: 'Visibility', type: 'enum', options: VISIBILITY, required: true, edit: 'editor' },
      { key: 'archived', header: 'Archived', type: 'enum', options: YES_NO, edit: 'admin', internal: true },
      ...audit,
    ],
  },
  audit: {
    key: 'audit', tab: 'Audit Log', label: 'Audit log', idKey: 'timestamp', idPrefix: '', internalOnly: true, create: 'none',
    columns: [
      { key: 'timestamp', header: 'Timestamp', type: 'datetime', edit: 'none' },
      { key: 'user', header: 'User', type: 'text', edit: 'none' },
      { key: 'role', header: 'Role', type: 'text', edit: 'none' },
      { key: 'table', header: 'Table', type: 'text', edit: 'none' },
      { key: 'recordId', header: 'Record ID', type: 'text', edit: 'none' },
      { key: 'action', header: 'Action', type: 'text', edit: 'none' },
      { key: 'field', header: 'Field', type: 'text', edit: 'none' },
      { key: 'oldValue', header: 'Old Value', type: 'longtext', edit: 'none' },
      { key: 'newValue', header: 'New Value', type: 'longtext', edit: 'none' },
      { key: 'source', header: 'Source', type: 'text', edit: 'none' },
    ],
  },
};

export const TABLE_KEYS = Object.keys(TABLES) as TableKey[];

export function column(table: TableKey, key: string): ColumnSpec | undefined {
  return TABLES[table].columns.find(c => c.key === key);
}

const RANK: Record<Role, number> = { client: 0, editor: 1, admin: 2 };

export function roleAtLeast(role: Role, min: 'editor' | 'admin' | 'none' | undefined): boolean {
  if (!min || min === 'none') return false;
  return RANK[role] >= RANK[min];
}

export function canEditField(role: Role, table: TableKey, key: string): boolean {
  const col = column(table, key);
  return !!col && roleAtLeast(role, col.edit);
}

export function canCreate(role: Role, table: TableKey): boolean {
  return roleAtLeast(role, TABLES[table].create);
}

export function isInternalRole(role: Role): boolean {
  return role === 'admin' || role === 'editor';
}

/** A record as stored in a tab: typed values keyed by column key. */
export type Value = string | number | null;
export interface RecordRow {
  [key: string]: Value | undefined;
}
