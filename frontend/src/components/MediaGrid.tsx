import React from 'react';
import { MediaGallery, FileInfoCard, deviceName } from './MediaGallery';
import type { FileRecord } from '../types';
import type { SortKey, SortDir } from './MediaGallery';

export { FileInfoCard, deviceName };
export type { SortKey, SortDir } from './MediaGallery';

/** @deprecated Use MediaGallery (grid/list toggle + sorting). Kept for backward compatibility. */
export function MediaGrid(props: {
  files: FileRecord[];
  total?: number;
  page?: number;
  onPage?: (p: number) => void;
  onOpenImage: (id: number) => void;
  onOpenDevice?: (id: number) => void;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSortChange?: (key: SortKey, dir: SortDir) => void;
  renderAction?: (file: FileRecord) => React.ReactNode;
  disableHoverPreview?: boolean;
}) {
  return <MediaGallery {...props} />;
}