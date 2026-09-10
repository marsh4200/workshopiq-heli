import { useEffect, useState } from 'react';
import { Box, Chip, Dialog, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { fetchFileBlob } from '../api/client';
import { fmtDate } from './common';
import type { Photo } from '../types';

function AuthImage({
  jobId,
  filename,
  onClick,
  style,
}: {
  jobId: number;
  filename: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    let active = true;
    let created = '';
    fetchFileBlob(jobId, filename).then((u) => {
      if (active) {
        created = u;
        setUrl(u);
      }
    });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [jobId, filename]);
  if (!url)
    return <Box sx={{ ...style, bgcolor: '#1b2542', display: 'grid', placeItems: 'center' }} onClick={onClick} />;
  return <img src={url} onClick={onClick} style={style} alt={filename} />;
}

export default function PhotoGallery({
  jobId,
  photos,
  canDelete,
  onDelete,
}: {
  jobId: number;
  photos: Photo[];
  canDelete?: boolean;
  onDelete?: (id: number) => void;
}) {
  const [viewer, setViewer] = useState<number | null>(null);

  if (!photos.length)
    return (
      <Typography variant="body2" color="text.secondary">
        No photos uploaded yet.
      </Typography>
    );

  const close = () => setViewer(null);
  const go = (dir: number) =>
    setViewer((v) => (v === null ? null : (v + dir + photos.length) % photos.length));

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 1.5 }}>
        {photos.map((p, i) => (
          <Box
            key={p.id}
            sx={{
              position: 'relative',
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid rgba(148,163,184,0.15)',
              aspectRatio: '4/3',
              '&:hover .ph-overlay': { opacity: 1 },
            }}
          >
            <AuthImage
              jobId={jobId}
              filename={p.filename}
              onClick={() => setViewer(i)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
            />
            {p.category !== 'general' && (
              <Chip
                label={p.category}
                size="small"
                sx={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  textTransform: 'capitalize',
                  bgcolor: p.category === 'before' ? '#f59e0bcc' : '#22c55ecc',
                  color: '#06121f',
                  fontWeight: 700,
                  height: 22,
                }}
              />
            )}
            {canDelete && (
              <Box className="ph-overlay" sx={{ position: 'absolute', top: 4, right: 4, opacity: 0, transition: '0.2s' }}>
                <IconButton
                  size="small"
                  onClick={() => onDelete?.(p.id)}
                  sx={{ bgcolor: '#000a', '&:hover': { bgcolor: '#c00' } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Dialog open={viewer !== null} onClose={close} maxWidth="lg" fullWidth>
        {viewer !== null && (
          <Box sx={{ position: 'relative', bgcolor: '#05080f' }}>
            <IconButton onClick={close} sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2, bgcolor: '#000a' }}>
              <CloseIcon />
            </IconButton>
            {photos.length > 1 && (
              <>
                <IconButton onClick={() => go(-1)} sx={{ position: 'absolute', left: 8, top: '50%', zIndex: 2, bgcolor: '#000a' }}>
                  <ChevronLeft />
                </IconButton>
                <IconButton onClick={() => go(1)} sx={{ position: 'absolute', right: 8, top: '50%', zIndex: 2, bgcolor: '#000a' }}>
                  <ChevronRight />
                </IconButton>
              </>
            )}
            <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh', p: 2 }}>
              <AuthImage
                jobId={jobId}
                filename={photos[viewer].filename}
                style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
              />
            </Box>
            <Box sx={{ p: 2, borderTop: '1px solid #1b2542' }}>
              <Typography variant="body2">
                {photos[viewer].caption || photos[viewer].original_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {photos[viewer].category} · {fmtDate(photos[viewer].created_at)}
              </Typography>
            </Box>
          </Box>
        )}
      </Dialog>
    </>
  );
}
