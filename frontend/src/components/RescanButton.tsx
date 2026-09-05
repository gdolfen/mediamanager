import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * Scan-Symbol für erneutes Scannen einer Datei oder aller Dateien einer Kachel.
 * Kompakt (ca. 24px), damit es sich optisch den Status-Icons angleicht.
 */
export function RescanButton({ title, onRescan, disabled }: {
  title: string;
  onRescan: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>
        <IconButton
          size="small"
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onRescan(); }}
          sx={{ padding: '3px', bgcolor: 'rgba(0,0,0,0.5)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }, '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.25)', color: 'rgba(255,255,255,0.4)' } }}
        >
          <RefreshIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </span>
    </Tooltip>
  );
}
