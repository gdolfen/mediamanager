import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    secondary: { main: '#00838f' },
    background: { default: '#f5f7fa' },
  },
  typography: {
    fontFamily: ['Roboto', 'Segoe UI', 'Arial', 'sans-serif'].join(','),
  },
  components: {
    MuiCard: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiButton: { styleOverrides: { root: { textTransform: 'none' } } },
  },
});