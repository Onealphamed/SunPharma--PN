import type { RawTable } from '../../../shared/model';

export type CellOut = string | number;

export interface CellUpdate {
  /** 1-based sheet row. */
  row: number;
  /** 0-based column index. */
  col: number;
  value: CellOut;
}

/**
 * Minimal tabular storage contract. Implemented by the Google Sheets store (production
 * source of truth) and a JSON file store (local development / offline demo).
 */
export interface TableStore {
  readonly kind: 'google' | 'local';
  readonly description: string;
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
