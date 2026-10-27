import type { RawTable } from '../../../shared/model';

export type CellOut = string | number;

export interface CellUpdate {
  /** 1-based sheet row. */
  row: number;
  /** 0-based column index. */
  col: number;
  value: CellOut;
}

export type StoreKind = 'google' | 'public-sheet' | 'local';

/**
 * Minimal tabular storage contract. Implemented by the Google Sheets store (service account,
 * read/write), the public-link store (view-only link, read-only) and a JSON file store
 * (local development / offline demo).
 */
export interface TableStore {
  readonly kind: StoreKind;
  readonly description: string;
  /** True when the source cannot be written (changes are made in Google Sheets directly). */
  readonly readOnly?: boolean;
  /** Read several tabs in one round trip. Missing tabs are omitted from the result. */
  readTabs(tabs: string[]): Promise<Record<string, RawTable>>;
  updateCells(tab: string, updates: CellUpdate[]): Promise<void>;
  appendRows(tab: string, rows: CellOut[][]): Promise<void>;
  /** Create any missing tabs with the given header rows (used by setup scripts). */
  ensureTabs(tabs: { name: string; header: string[] }[]): Promise<string[]>;
}

export class StoreError extends Error {
  constructor(message: string, readonly status = 502, readonly retryable = false) {
    super(message);
  }
}
