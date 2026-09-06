import React, { useCallback, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { Layout, type PageKey } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ActionsPage } from './pages/ActionsPage';
import { ProblemsPage } from './pages/ProblemsPage';
import { DevicesPage } from './pages/DevicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { LibraryPage } from './pages/LibraryPage';
import { UploadPage } from './pages/UploadPage';
import { LogsPage } from './pages/LogsPage';
import { DevToolsPage } from './pages/DevToolsPage';
import { DevicePage, IdentifierPage, ImagePage, FormatPage } from './pages/DetailPages';
import { api } from './api/client';
import { useHashRoute } from './hooks/useHashRoute';

type Detail =
  | { kind: 'image'; fileId: number }
  | { kind: 'device'; deviceId: number }
  | { kind: 'identifier'; identifierKind: 'exif' | 'path'; identifierValue: string }
  | { kind: 'format'; ext: string }
  | null;

const VALID_PAGES: PageKey[] = ['dashboard', 'upload', 'library', 'actions', 'problems', 'devices', 'settings', 'logs', 'devtools'];

export default function App() {
  const [hashRoute, hashParams, setHashRoute] = useHashRoute();
  const [detail, setDetail] = useState<Detail>(null);
  const [snack, setSnack] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);

  const page: PageKey = (hashRoute as PageKey) || 'dashboard';

  const notify = (text: string, severity: 'success' | 'error' | 'info' = 'info') => setSnack({ severity, text });

  const openImage = useCallback((fileId: number) => setDetail({ kind: 'image', fileId }), []);
  const openDevice = useCallback((deviceId: number) => setDetail({ kind: 'device', deviceId }), []);
  const openIdentifier = useCallback((identifierKind: 'exif' | 'path', identifierValue: string) =>
    setDetail({ kind: 'identifier', identifierKind, identifierValue }), []);
  const openFormat = useCallback((ext: string) => setDetail({ kind: 'format', ext }), []);
  const goBack = useCallback(() => setDetail(null), []);
  const navigate = useCallback((p: PageKey) => { setDetail(null); setHashRoute(p); }, [setHashRoute]);

  const startTransfer = useCallback(async (): Promise<boolean> => {
    try {
      const res = await api.startTransfer();
      if (!res.ok) {
        notify(res.error ?? 'Transfer konnte nicht gestartet werden.', 'error');
        return false;
      }
      notify('Übertragung gestartet.', 'success');
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
      return false;
    }
  }, []);

  return (
    <>
      <Layout page={page} onNavigate={navigate}>
        {detail?.kind === 'image' && <ImagePage fileId={detail.fileId} onBack={goBack} onOpenDevice={openDevice} />}
        {detail?.kind === 'device' && <DevicePage deviceId={detail.deviceId} onBack={goBack} onOpenImage={openImage} />}
        {detail?.kind === 'identifier' && (
          <IdentifierPage identifierKind={detail.identifierKind} identifierValue={detail.identifierValue} onBack={goBack} onOpenImage={openImage} onOpenDevice={openDevice} />
        )}
        {detail?.kind === 'format' && <FormatPage ext={detail.ext} onBack={goBack} onOpenImage={openImage} onOpenDevice={openDevice} onNavigate={navigate} />}
        {!detail && page === 'dashboard' && <Dashboard onStartTransfer={startTransfer} onNavigate={navigate} />}
        {!detail && page === 'library' && <LibraryPage onOpenImage={openImage} onOpenDevice={openDevice} onNavigate={navigate} />}
        {!detail && page === 'upload' && <UploadPage onOpenImage={openImage} onOpenDevice={openDevice} onNavigate={navigate} />}
        {!detail && page === 'actions' && <ActionsPage />}
        {!detail && page === 'problems' && <ProblemsPage onStartTransfer={startTransfer} />}
        {!detail && page === 'devices' && <DevicesPage onOpenImage={openImage} onOpenDevice={openDevice} onOpenIdentifier={openIdentifier} />}
        {!detail && page === 'settings' && <SettingsPage onOpenFormat={openFormat} />}
        {!detail && page === 'logs' && <LogsPage />}
        {!detail && page === 'devtools' && <DevToolsPage />}
      </Layout>
      <Snackbar open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack?.severity ?? 'info'} onClose={() => setSnack(null)} variant="filled">
          {snack?.text}
        </Alert>
      </Snackbar>
    </>
  );
}
