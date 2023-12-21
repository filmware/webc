import { ConfigProvider, theme } from 'antd';
import { useObservable } from 'micro-observables';
import { useMemo } from 'react';

import useTheme from '@/hooks/useTheme';
import AppRouter from '@/routes/AppRouter';
import themeStore from '@/stores/theme';

import css from './App.module.scss';
import ConnectionStatus from './components/ConnectionStatus';

/**
 * Context providers and main app component are separated out to ensure
 * changes in the context are picked up by main app.
 */
function AppMain() {
  useTheme();

  return (
    <div className={css.base}>
      <AppRouter />
      <ConnectionStatus />
    </div>
  );
}

function App() {
  const isDarkMode = useObservable(themeStore.isDarkMode);

  const token = useMemo(() => {
    const baseToken = {
      borderRadius: 4,
      borderRadiusSM: 2,
      borderRadiusLG: 6,
    };
    return isDarkMode
      ? {
          ...baseToken,
          colorPrimary: '#763cfe',
          colorInfo: '#763cfe',
        }
      : {
          ...baseToken,
          colorPrimary: '#763cfe',
          colorInfo: '#763cfe',
        };
  }, [isDarkMode]);

  return (
    <ConfigProvider
      theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm, token }}>
      <AppMain />
    </ConfigProvider>
  );
}

export default App;
