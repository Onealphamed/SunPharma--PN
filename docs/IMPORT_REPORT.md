# Readiness Checklist import report

Source: `OneAlphaMed_SunPharma_PN0510_AdBoard_Readiness_Checklist_v1.0.xlsx` › worksheet **Readiness Checklist** only · Imported: 2026-10-23T09:13:22Z

Worksheets present but **not read** (per the brief): `Overview`, `Gantt Timeline`, `KOL Tracker`, `Board Tracker`, `Reference`.
Source SHA-256: `2dc0f86cf807a27c8a11b74e7d4ee9970ac9b180cf1d3bc0d9a1f88a0cdb396f`. The source workbook was opened read-only and was not modified.

## 1. Summary

| Item | Count |
|---|---|
| Deliverables imported (one per task row) | 114 |
| Phase headings (organisational, not deliverables) | 5 |
| Workstream headings (organisational, not deliverables) | 14 |
| Types: Task / Client Input / Approval Gate / Milestone / blank | 75 / 16 / 15 / 7 / 1 |
| Findings: errors / warnings / info | 0 / 3 / 5 |

## 2. Phases and workstreams

| Phase | Workstreams | Deliverables | Workstream sections |
|---|---|---|---|
| Phase 1: Mobilisation & Client Inputs | 3 | 14 | 1.2 Objectives & Programme Direction; 1.3 KOLs, Dates & Cities; 1.4 Logistics, Honoraria & Documentation Scope |
| Phase 2: Scientific Content & Approvals | 3 | 14 | 2.1 Scientific Framework; 2.2 Board Materials; 2.3 Sun Review & Approval |
| Phase 3: Regional Advisory Boards (AB-1 to AB-4) | 4 | 60 | 3.1 AB-1 North – New Delhi; 3.2 AB-2 West – Mumbai / Ahmedabad; 3.3 AB-3 South – Chennai / Bengaluru / Hyderabad; 3.4 AB-4 East – Kolkata |
| Phase 4: National Consensus Advisory Board (NAB-5) | 3 | 21 | 4.1 Regional Synthesis & National Content; 4.2 NAB-5 Logistics & Travel; 4.3 NAB-5 Execution & Reporting |
| Phase 5: Consolidation, Final Deliverables & Close-out | 1 | 5 | 5.1 Consolidated Reports |

## 3. Identifiers

Deliverable IDs follow `PN-<section>.<sequence>`, e.g. `PN-1.2.01` is the first task under section 1.2 *Objectives & Programme Direction*. IDs are written into the sheet once and **never renumbered**: new deliverables get the next free number in their section, and the dashboard uses the ID (not the row number) for every edit. Each row also records its source row (`Checklist Row`) for traceability.

## 4. Field mapping

| Checklist column | Live tracker column | Rule |
|---|---|---|
| Phase | Phase | Copied as-is (trimmed) |
| Workstream | Workstream | Copied as-is (trimmed) |
| Task / Activity | Task / Activity | Copied as-is (trimmed) |
| Description & Key Deliverables | Description & Key Deliverables | Copied as-is (trimmed) |
| Type | Type | Copied as-is (trimmed) |
| Lead | Lead | Copied as-is (trimmed) |
| Lead Function | Lead Function | Copied as-is (trimmed) |
| OAM Owner | OneAlphaMed Owner | Copied as-is (trimmed) |
| Sun Owner | Sun Pharma Owner | Copied as-is (trimmed) |
| Duration (WD) | Duration (Working Days) | Copied as-is (trimmed) |
| Status | Status | Mapped to the configured spelling; original kept in *Original Status (Checklist)* |
| Schedule Flag | Schedule Flag (Checklist) | Kept for traceability; the live Schedule Flag is calculated |
| Remarks | Remarks | Copied as-is (trimmed) |

New tracking fields (Planned/Actual dates, Priority, Dependency, Next Action, Action Owner, Target Date, approval fields, Comments) start **blank**. Exceptions, all derived by a stated rule:
- **Completion Confirmed** = "No" for every row (the checklist records no completed items).
- **Client Approval Status** = "Not Submitted" for the 15 *Approval Gate* rows (all are "Yet to start" in the checklist).
- **Client Visible** = "Yes", **Archived** = "No", **Sort Order** = checklist order.

## 5. Status mapping

Statuses found: "Yet to start" × 113, "(blank)" × 1.

| Status | Category | Counts as complete |
|---|---|---|
| In Progress | Active | No |
| In Review | Review | No |
| Yet to Start | Not started | No |
| Yet to Assign | Unassigned | No |
| On Hold | Blocked | No |
| Under Approval | Approval | No |
| Approval | Approval | No |
| Pending | Waiting | No |

Completion is recorded separately with **Completion Confirmed**, so no status, including "Approval", is treated as complete.

## 6. Gaps in the source (not filled in)

- **Dates:** the checklist has durations (working days) but no start or end dates. All items are "Date not confirmed" until the PM enters dates.
- **Dependencies:** none recorded as structured data. 12 dependency suggestion(s) were read from the *Remarks* column and are listed below for the PM to apply or ignore.
- **Priority, actual dates, approval submission data, next actions:** not present.
- **Project dates, PM name, project leads:** not in this worksheet (other worksheets were not read, per the brief).
- **Holidays:** none in this worksheet.

## 7. Dependency suggestions from checklist remarks (not applied)

| Deliverable | Should wait for | Basis |
|---|---|---|
| PN-3.1.05 AB-1: outstation travel and stay (only if requested) | PN-1.4.01 Outstation travel and stay: scope and billing route | PN-1.4.01 remark: "Confirm in writing before any booking" |
| PN-3.2.05 AB-2: outstation travel and stay (only if requested) | PN-1.4.01 Outstation travel and stay: scope and billing route | PN-1.4.01 remark: "Confirm in writing before any booking" |
| PN-3.3.05 AB-3: outstation travel and stay (only if requested) | PN-1.4.01 Outstation travel and stay: scope and billing route | PN-1.4.01 remark: "Confirm in writing before any booking" |
| PN-3.4.05 AB-4: outstation travel and stay (only if requested) | PN-1.4.01 Outstation travel and stay: scope and billing route | PN-1.4.01 remark: "Confirm in writing before any booking" |
| PN-4.2.06 NAB-5: air travel, hotel and transfers booked | PN-1.4.01 Outstation travel and stay: scope and billing route | PN-1.4.01 remark: "Confirm in writing before any booking" |
| PN-3.1.02 AB-1: invitations sent with approved agenda | PN-2.3.03 Content pack approved – invitations can go out | PN-2.3.03 remark: "Gate for all KOL invitations" |
| PN-3.2.02 AB-2: invitations sent with approved agenda | PN-2.3.03 Content pack approved – invitations can go out | PN-2.3.03 remark: "Gate for all KOL invitations" |
| PN-3.3.02 AB-3: invitations sent with approved agenda | PN-2.3.03 Content pack approved – invitations can go out | PN-2.3.03 remark: "Gate for all KOL invitations" |
| PN-3.4.02 AB-4: invitations sent with approved agenda | PN-2.3.03 Content pack approved – invitations can go out | PN-2.3.03 remark: "Gate for all KOL invitations" |
| PN-4.2.03 NAB-5: invitations sent with approved agenda | PN-2.3.03 Content pack approved – invitations can go out | PN-2.3.03 remark: "Gate for all KOL invitations" |
| PN-4.3.02 NAB-5: pre-read sent | PN-4.1.03 Sun approval of national content | PN-4.1.03 remark: "Gate for NAB-5 pre-read" |
| PN-4.2.06 NAB-5: air travel, hotel and transfers booked | PN-4.2.05 NAB-5: outstation travel and stay approved by Sun | PN-4.2.05 remark: "Required before booking" |

## 8. All findings

| Severity | Area | Finding |
|---|---|---|
| info | Scope | Read worksheet "Readiness Checklist" only. Not read: Overview, Gantt Timeline, KOL Tracker, Board Tracker, Reference. |
| info | Content | PN-1.3.05 (row 13) refers to the Overview tab, which is not read by this import. The text is kept as-is. |
| warning | Incomplete row | PN-1.3.06 "Sending reminders & thank you mailer to doctors" (row 14) has no Type, Lead, Sun Owner, Duration (WD), Status, Schedule Flag in the checklist — left blank, not filled in. |
| warning | Status | PN-2.3.03 (row 36) refers to a status "Second review", which is not one of the eight configured statuses. Use "In Review" (or add it in Status Config if Sun Pharma needs it). |
| warning | Content | PN-3.4.11 (row 98): description "ssss" looks like placeholder text — kept as-is for the PM to correct. |
| info | Workstreams | Phase 1 starts at section 1.2 in the checklist (there is no section 1.1); numbering is kept as in the source. |
| info | Holidays | The Readiness Checklist has no holiday calendar; working days are Mon–Fri until holidays are added in Settings › Calendar. |
| info | Dates | The Readiness Checklist contains working-day durations but no start or end dates. All 114 deliverables are imported as "Date not confirmed". |
