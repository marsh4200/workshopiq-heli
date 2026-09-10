import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

export default function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Give the canvas real pixel dimensions matching its CSS size (accounting
  // for device pixel ratio) so strokes stay crisp on high-DPI tablets/phones.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1f6feb';
    }
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
    setEmpty(false);
  };

  const end = () => {
    drawing.current = false;
    if (hasInk.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  };

  return (
    <Box>
      <Box
        sx={{
          position: 'relative',
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
        }}
      >
        {empty && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            Sign here
          </Typography>
        )}
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 140, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 0.5 }}>
        <Button size="small" startIcon={<ClearIcon fontSize="small" />} onClick={clear} disabled={empty}>
          Clear
        </Button>
      </Stack>
    </Box>
  );
}
