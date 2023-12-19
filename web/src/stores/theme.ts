import * as io from 'io-ts';
import { Observable, observable, WritableObservable } from 'micro-observables';

import localStorageStore, { LocalStorageStore } from '@/stores/localStorage';

const ioMode = io.keyof({ dark: null, light: null, system: null });

export type Mode = 'dark' | 'light' | 'system';

export const MATCH_MEDIA_SCHEME_DARK = '(prefers-color-scheme: dark)';
export const MATCH_MEDIA_SCHEME_LIGHT = '(prefers-color-scheme: light)';

const STORAGE_KEY_THEME_MODE = 'theme-mode';

class ThemeStore {
  #localStorage: LocalStorageStore;
  #userMode: WritableObservable<Mode> = observable('system');
  #systemMode: WritableObservable<Mode> = observable('system');

  constructor(localStorage: LocalStorageStore) {
    this.#localStorage = localStorage;
    const storedThemeMode = this.#localStorage.getPath<Mode>(STORAGE_KEY_THEME_MODE, ioMode);
    if (storedThemeMode) this.setUserMode(storedThemeMode);
  }

  get isDarkMode(): Observable<boolean> {
    return Observable.select([this.#userMode, this.#systemMode], (user, system) => {
      const resolvedMode = user === 'system' ? (system === 'system' ? 'light' : system) : user;
      return resolvedMode === 'dark';
    });
  }

  public setUserMode(mode: Mode) {
    this.#userMode.set(mode);
    this.#localStorage.setPath(STORAGE_KEY_THEME_MODE, mode, ioMode);
  }

  public updateSystemMode() {
    this.#systemMode.set(this.getSystemMode());
  }

  private getSystemMode(): Mode {
    const isDark = matchMedia?.(MATCH_MEDIA_SCHEME_DARK).matches;
    if (isDark) return 'dark';

    const isLight = matchMedia?.(MATCH_MEDIA_SCHEME_LIGHT).matches;
    if (isLight) return 'light';

    return 'system';
  }
}

export default new ThemeStore(localStorageStore);
