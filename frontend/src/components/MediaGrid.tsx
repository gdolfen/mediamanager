import React from 'react';
import { MediaGallery, FileInfoCard, deviceName } from './MediaGallery';
import type { FileRecord } from '../types';

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
}) {
  return <MediaGallery {...props} />;
}