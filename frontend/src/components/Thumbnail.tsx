import React, { useState } from 'react';
import { Box, Chip, CircularProgress, Dialog, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { mediaUrl } from '../api/client';
import type { FileType } from '../types';

export function FullscreenDialog({ fileId, fileType, title, onClose }: {
  fileId: number;
  fileType: FileType;
  title: string;
  onClose: () => void;
}) {
  const src = mediaUrl.file(fileId);
  return (
    <Dialog open fullScreen onClose={onClose} PaperProps={{ sx: { background: '#000', color: '#fff' } }}>
      <IconButton onClick={onClose} sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', zIndex: 2 }}>
        <CloseIcon />
      </IconButton>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 1 }}>
        {fileType === 'video' ? (
          <video src={src} controls autoPlay style={{ maxWidth: '100%', maxHeight: '88vh' }} />
        ) : (
          <img src={src} alt={title} style={{ maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain' }} />
        )}
        <Typography variant="caption">{title}</Typography>
      </Box>
    </Dialog>
  );
}

/** Clickable thumbnail; opens the media fullscreen on click. */
export function Thumbnail({ fileId, fileType, size = 56, noDialog = false }: { fileId: number; fileType: FileType; size?: number; noDialog?: boolean }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  if (fileType === 'other') {
    return <Chip label="–" size="small" sx={{ width: size, height: size }} />;
  }

  return (
    <>
      <Box
        onClick={() => { if (!noDialog) setOpen(true); }}
        sx={{
          width: size,
          height: size,
          borderRadius: 1,
          overflow: 'hidden',
          cursor: 'zoom-in',
          bgcolor: '#e3e8ee',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {loading && !failed && <CircularProgress size={18} />}
        <img
          src={mediaUrl.thumbnail(fileId)}
          alt=""
          loading="lazy"
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true); }}
          style={{
            width: size,
            height: size,
            objectFit: 'cover',
            opacity: loading || failed ? 0 : 1,
            transition: 'opacity 0.15s ease-in',
          }}
        />
        {failed && fileType === 'video' && (
          <Typography variant="caption" color="text.secondary">VIDEO</Typography>
        )}
      </Box>
      {open && <FullscreenDialog fileId={fileId} fileType={fileType} title={''} onClose={() => setOpen(false)} />}
    </>
  );
}