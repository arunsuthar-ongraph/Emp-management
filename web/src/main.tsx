import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import enIN from 'antd/locale/en_GB';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { BASENAME } from './tenant';
import App from './App';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={enIN}>
      <ThemeProvider>
        <AntApp>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter basename={BASENAME}>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </AntApp>
      </ThemeProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
