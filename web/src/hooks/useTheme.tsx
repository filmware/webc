import { theme } from 'antd';
import { useCallback, useEffect } from 'react';

import themeStore, { MATCH_MEDIA_SCHEME_DARK, MATCH_MEDIA_SCHEME_LIGHT } from '@/stores/theme';
import { camelToKebab } from '@/utils/string';

function useTheme() {
  const { theme: appliedTheme, token } = theme.useToken();

  const handleSchemeChange = useCallback((event: MediaQueryListEvent) => {
    if (!event.matches) themeStore.updateSystemMode();
  }, []);

  // Detect browser/OS level dark/light mode changes.
  useEffect(() => {
    matchMedia?.(MATCH_MEDIA_SCHEME_DARK).addEventListener('change', handleSchemeChange);
    matchMedia?.(MATCH_MEDIA_SCHEME_LIGHT).addEventListener('change', handleSchemeChange);
    themeStore.updateSystemMode();

    return () => {
      matchMedia?.(MATCH_MEDIA_SCHEME_DARK).removeEventListener('change', handleSchemeChange);
      matchMedia?.(MATCH_MEDIA_SCHEME_LIGHT).removeEventListener('change', handleSchemeChange);
    };
  }, [handleSchemeChange]);

  // Update CSS variables when AntDesign theme changes.
  useEffect(() => {
    for (const key in token) {
      // Convert key to kebab for CSS variable naming standard.
      const cssVarKey = `--${camelToKebab(key)}`;

      // Get AntDesign token value.
      let value = token[key as keyof typeof token];

      // Numeric types are designed for CSS-in-JS, so numbers do not have a `px` suffix for size.
      if (typeof value === 'number') value = `${value}px`;

      // Write token value out to CSS variables so our theme can use them directly in our CSS modules.
      if (value) document.documentElement.style.setProperty(cssVarKey, value.toString());
    }
  }, [token, appliedTheme.id]);
}

export default useTheme;
