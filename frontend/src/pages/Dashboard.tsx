import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Grid, LinearProgress, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../api/client';
import type { Stats } from '../types';

export function Dashboard({ onStartTransfer, onNavigate }: { onStartTransfer: () => Promise<boolean>; onNavigate: (p: 'actions' | 'problems') => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setStats(await api.stats());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="h4" gutterBottom>Dashboard</Typography>
      </Grid>

      {error && (
        <Grid item xs={12}>
          <Alert severity="error">{error}</Alert>
        </Grid>
      )}

      <Grid item xs={12}>
        <Card>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<PlayArrowIcon />}
              onClick={async () => { if (await onStartTransfer()) onNavigate('actions'); }}
            >
              Übertragung starten
            </Button>
            <Typography variant="body2" color="text.secondary">
              Scannt das Upload-Verzeichnis und sortiert Fotos & Videos in die Zielordner.
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} sm={6} md={3}>
        <StatCard label="Übertragen" value={stats?.counts.transferred ?? '–'} color="#2e7d32" />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard label="Bereit (pending)" value={stats?.counts.pending ?? '–'} color="#1565c0" />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard label="Offene Probleme" value={stats?.openProblems ?? '–'} color={stats?.openProblems ? '#c62828' : '#2e7d32'} clickable onClick={() => onNavigate('problems')} />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard label="Geräte" value={stats?.devices ?? '–'} color="#6a1b9a" />
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Verzeichnisse</Typography>
            {stats && (
              <Grid container spacing={1}>
                <PathRow label="Upload (read-only)" path={stats.paths.upload} />
                <PathRow label="Fotos" path={stats.paths.fotos} />
                <PathRow label="Videos" path={stats.paths.videos} />
              </Grid>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

function StatCard({ label, value, color, clickable, onClick }: { label: string; value: string | number; color: string; clickable?: boolean; onClick?: () => void }) {
  return (
    <Card onClick={onClick} sx={{ cursor: clickable ? 'pointer' : 'default' }}>
      <CardContent>
        <Typography variant="h3" sx={{ color, fontWeight: 700 }}>{value}</Typography>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </CardContent>
    </Card>
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  return (
    <Grid item xs={12} sm={4}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>{path}</Typography>
    </Grid>
  );
}

export function TransferProgressInline({ running }: { running: boolean }) {
  return <>{running && <LinearProgress sx={{ mt: 2 }} />}</>;
}