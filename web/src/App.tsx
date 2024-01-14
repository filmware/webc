import { ConfigProvider, theme } from 'antd';
import { useObservable } from 'micro-observables';
import { KeyboardEvent, useCallback, useEffect, useMemo } from 'react';

import ConnectionStatus from '@/components/ConnectionStatus';
import useKeyEvents, { keyEmitter, KeyEventType } from '@/hooks/useKeyEvents';
import useModal from '@/hooks/useModal';
import useTheme from '@/hooks/useTheme';
import ModalCssVarsComponent from '@/modals/ModalCssVars';
import AppRouter from '@/routes/AppRouter';
import themeStore from '@/stores/theme';

import css from './App.module.scss';

/**
 * Context providers and main app component are separated out to ensure
 * changes in the context are picked up by main app.
 */
function AppMain() {
  const ModalCssVars = useModal(ModalCssVarsComponent);

  useTheme();
  useKeyEvents();

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c') ModalCssVars.open();
    },
    [ModalCssVars],
  );

  useEffect(() => {
    keyEmitter.addListener(KeyEventType.KeyUp, handleKeyUp);

    return () => {
      keyEmitter.removeListener(KeyEventType.KeyUp, handleKeyUp);
    };
  }, [handleKeyUp]);

  return (
    <div className={css.base}>
      <AppRouter />
      <ConnectionStatus />
      <ModalCssVars.Component />
    </div>
  );
}

function App() {
  const isDarkMode = useObservable(themeStore.isDarkMode);

  const token = useMemo(() => {
    const baseComponents = {
      Menu: {
        itemBg: 'transparent',
      },
      Typography: {
        titleMarginTop: 0,
        titleMarginBottom: 0,
      },
    };
    const baseToken = {
      borderRadius: 4,
      borderRadiusSM: 2,
      borderRadiusLG: 6,
      fontFamily: 'Roboto, system-ui, sans-serif',
      fontSizeHeading1: 28,
      fontSizeHeading2: 24,
      fontSizeHeading3: 22,
      fontSizeHeading4: 20,
      fontSizeHeading5: 18,
      lineHeightHeading1: 1.7142857143,
      lineHeightHeading2: 1.8333333333,
      lineHeightHeading3: 1.8181818182,
      lineHeightHeading4: 1.8,
      lineHeightHeading5: 1.7777777778,
    };
    return isDarkMode
      ? {
          ...baseComponents,
          ...baseToken,
          colorPrimary: '#763cfe',
          colorInfo: '#763cfe',
        }
      : {
          ...baseComponents,
          ...baseToken,
          colorPrimary: '#763cfe',
          colorInfo: '#763cfe',
        };
  }, [isDarkMode]);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token,
      }}>
      <AppMain />
    </ConfigProvider>
  );
}

export default App;
