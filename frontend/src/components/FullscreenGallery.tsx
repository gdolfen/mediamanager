import React, { useCallback, useEffect } from 'react';
import { Box, Dialog, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { mediaUrl } from '../api/client';
import type { FileRecord } from '../types';

export function FullscreenGallery({ files, index, onIndexChange, onClose, onOpenDetails }: {
  files: FileRecord[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onOpenDetails?: (fileId: number) => void;
}) {
  const file = files[index];

  const prev = useCallback(() => {
    if (files.length > 0) onIndexChange((index - 1 + files.length) % files.length);
  }, [files.length, index, onIndexChange]);

  const next = useCallback(() => {
    if (files.length > 0) onIndexChange((index + 1) % files.length);
  }, [files.length, index, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  return (
    <Dialog open fullScreen onClose={onClose} PaperProps={{ sx: { background: '#000', color: '#fff' } }}>
      <IconButton onClick={onClose} sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', zIndex: 2 }}>
        <CloseIcon />
      </IconButton>
      {onOpenDetails && file && (
        <IconButton
          onClick={() => onOpenDetails(file.id)}
          sx={{ position: 'absolute', top: 8, left: 8, color: '#fff', zIndex: 2, bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
          title="Details anzeigen"
        >
          <InfoOutlinedIcon />
        </IconButton>
      )}
      <Box sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
        <Typography variant="body2" sx={{ color: '#fff', bgcolor: 'rgba(0,0,0,0.5)', px: 1.5, py: 0.5, borderRadius: 2 }}>
          {index + 1} / {files.length}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 1 }}>
        {file?.fileType === 'video' ? (
          <video key={file.id} src={mediaUrl.file(file.id)} controls autoPlay style={{ maxWidth: '100%', maxHeight: '88vh' }} />
        ) : (
          <img key={file?.id} src={mediaUrl.file(file?.id ?? 0)} alt="" style={{ maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain' }} />
        )}
        {file && (
          <Typography variant="caption" sx={{ color: '#fff', px: 2, textAlign: 'center' }}>
            {file.originalName}
            {file.takenAt ? ` · ${new Date(file.takenAt).toLocaleString('de-DE')}` : ''}
          </Typography>
        )}
      </Box>

      <IconButton
        onClick={prev}
        disabled={files.length < 2}
        sx={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
      >
        <ChevronLeftIcon fontSize="large" />
      </IconButton>
      <IconButton
        onClick={next}
        disabled={files.length < 2}
        sx={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,0.4)', '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' } }}
      >
        <ChevronRightIcon fontSize="large" />
      </IconButton>
      <Stack direction="row" spacing={1} sx={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
        {files.map((f, i) => (
          <Box
            key={f.id}
            onClick={() => onIndexChange(i)}
            sx={{
              width: 8, height: 8, borderRadius: '50%', cursor: 'pointer',
              bgcolor: i === index ? '#fff' : 'rgba(255,255,255,0.35)',
            }}
          />
        ))}
      </Stack>
    </Dialog>
  );
}