import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Chip,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import BoltIcon from '@mui/icons-material/Bolt';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import DevicesIcon from '@mui/icons-material/Devices';
import SettingsIcon from '@mui/icons-material/Settings';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import ArticleIcon from '@mui/icons-material/Article';
import UploadIcon from '@mui/icons-material/Upload';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';

export type PageKey = 'dashboard' | 'upload' | 'actions' | 'problems' | 'devices' | 'settings' | 'library' | 'logs' | 'devtools';

const NAV: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { key: 'library', label: 'Bibliothek', icon: <PhotoLibraryIcon /> },
  { key: 'upload', label: 'Upload', icon: <UploadIcon /> },
  { key: 'actions', label: 'Aktionen', icon: <BoltIcon /> },
  { key: 'problems', label: 'Probleme', icon: <ErrorOutlineIcon /> },
  { key: 'devices', label: 'Geräte', icon: <DevicesIcon /> },
  { key: 'settings', label: 'Einstellungen', icon: <SettingsIcon /> },
  { key: 'logs', label: 'Logs', icon: <ArticleIcon /> },
  { key: 'devtools', label: 'Entwickler', icon: <DeveloperModeIcon /> },
];

export function Layout({ page, onNavigate, children }: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  children: React.ReactNode;
}) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(d => setVersion(d.version))
      .catch(() => {});
  }, []);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            MediaManager
          </Typography>
          {version && (
            <Chip label={`v${version}`} size="small" sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.5)' }} variant="outlined" />
          )}
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{
        width: 240,
        flexShrink: 0,
        '& .MuiDrawer-paper': { width: 240, boxSizing: 'border-box', mt: 8 },
      }}>
        <List sx={{ pt: 1 }}>
          {NAV.map((item) => (
            <ListItemButton key={item.key} selected={page === item.key} onClick={() => onNavigate(item.key)}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3, mt: 8 }}>
        {children}
      </Box>
    </Box>
  );
}