import type { ProblemType } from '../types.js';

export interface ProblemActionDef {
  id: string;
  label: string;
}

export interface ProblemTypeDef {
  type: ProblemType;
  severity: 'info' | 'warning' | 'error';
  label: string;
  actions: ProblemActionDef[];
}

export const PROBLEM_CATALOG: Record<ProblemType, ProblemTypeDef> = {
  UNKNOWN_DEVICE: {
    type: 'UNKNOWN_DEVICE',
    severity: 'error',
    label: 'Unbekanntes Gerät',
    actions: [{ id: 'create_device', label: 'Gerät anlegen / zuordnen' }],
  },
  NO_META_DATE: {
    type: 'NO_META_DATE',
    severity: 'warning',
    label: 'Keine Metadaten (Datum aus Datei)',
    actions: [{ id: 'accept_file_date', label: 'Dateizeit übernehmen' }],
  },
  DATE_MISMATCH_META: {
    type: 'DATE_MISMATCH_META',
    severity: 'warning',
    label: 'Meta-Datum weicht von Dateizeit ab',
    actions: [
      { id: 'accept_meta_date', label: 'Meta-Datum akzeptieren' },
      { id: 'accept_file_date', label: 'Dateizeit übernehmen' },
    ],
  },
  DATE_MISMATCH_FILENAME: {
    type: 'DATE_MISMATCH_FILENAME',
    severity: 'error',
    label: 'Datum im Dateinamen weicht ab',
    actions: [
      { id: 'accept_meta_date', label: 'Meta/Dateizeit akzeptieren' },
      { id: 'accept_filename_date', label: 'Dateinamen-Datum übernehmen' },
    ],
  },
  TARGET_EXISTS: {
    type: 'TARGET_EXISTS',
    severity: 'error',
    label: 'Zieldatei existiert bereits',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  UNSUPPORTED_FORMAT: {
    type: 'UNSUPPORTED_FORMAT',
    severity: 'warning',
    label: 'Nicht unterstütztes Format',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  READ_ERROR: {
    type: 'READ_ERROR',
    severity: 'error',
    label: 'Datei nicht lesbar',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  DEVICE_PERIOD_DEVIATION: {
    type: 'DEVICE_PERIOD_DEVIATION',
    severity: 'info',
    label: 'Datum außerhalb bekannter Geräte-Nutzung',
    actions: [{ id: 'ignore', label: 'OK / Ignorieren' }],
  },
  FILE_MTIME_BEFORE_BIRTHTIME: {
    type: 'FILE_MTIME_BEFORE_BIRTHTIME',
    severity: 'info',
    label: 'Änderungszeit vor Erstellzeit',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  LIBRARY_META_FILENAME_MISMATCH: {
    type: 'LIBRARY_META_FILENAME_MISMATCH',
    severity: 'info',
    label: 'Meta-Datum weicht vom Dateinamen ab',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  LIBRARY_META_FILETIME_MISMATCH: {
    type: 'LIBRARY_META_FILETIME_MISMATCH',
    severity: 'info',
    label: 'Meta-Datum weicht von Dateizeit ab',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  LIBRARY_FILENAME_FILETIME_MISMATCH: {
    type: 'LIBRARY_FILENAME_FILETIME_MISMATCH',
    severity: 'warning',
    label: 'Dateiname weicht von Dateizeit ab',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
  LIBRARY_PATH_MISMATCH: {
    type: 'LIBRARY_PATH_MISMATCH',
    severity: 'warning',
    label: 'Zielordner-Pfad passt nicht zum Datum',
    actions: [{ id: 'ignore', label: 'Ignorieren' }],
  },
};

export function problemTypeDef(type: ProblemType): ProblemTypeDef {
  return PROBLEM_CATALOG[type];
}