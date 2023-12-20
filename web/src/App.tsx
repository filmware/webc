import { ConfigProvider, theme } from 'antd';
import { useObservable } from 'micro-observables';

import AppRouter from '@/routes/AppRouter';
import themeStore from '@/stores/theme';

import useTheme from './hooks/useTheme';

function App() {
  const isDarkMode = useObservable(themeStore.isDarkMode);

  useTheme();

  return (
    <ConfigProvider
      theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
      <AppRouter />
    </ConfigProvider>
  );
}

export default App;
