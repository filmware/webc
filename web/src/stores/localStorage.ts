import { Mixed } from 'io-ts';

import { decode, encode } from '@/utils/io';

export class LocalStorageStore {
  public getPath<T>(path: string | string[], io: Mixed): T | undefined {
    try {
      const key = this.pathToKey(path);
      return this.decode<T>(io, localStorage.getItem(key)) ?? undefined;
    } catch {
      console.error(`Local Storage: Unable to decode "${path}".`);
      return undefined;
    }
  }

  public setPath(path: string | string[], value: unknown, io: Mixed): void {
    try {
      const key = this.pathToKey(path);
      localStorage.setItem(key, this.encode(io, value));
    } catch {
      console.error(`Local Storage: Unable to encode { "${path}": "${value}" }.`);
    }
  }

  public removePath(path: string | string[]): void {
    const key = this.pathToKey(path);
    localStorage.removeItem(key);
  }

  public clear(): void {
    localStorage.clear();
  }

  public dump(): string {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key == null) continue;
      record[key] = localStorage.getItem(key);
    }
    return JSON.stringify(record);
  }

  protected pathToKey(path: string | string[]): string {
    const paths = Array.isArray(path) ? path : [path];
    return paths.map(this.stripSlash).join('/');
  }

  private stripSlash(str: string): string {
    return str.replace(/^\s*\//g, '').replace(/\/\s*$/g, '');
  }

  private decode<T>(io: Mixed, value: string | null): T | null {
    return value == null ? value : decode<T>(io, JSON.parse(value));
  }

  private encode<T>(io: Mixed, value: unknown): string {
    return JSON.stringify(encode<T>(io, value));
  }
}

export default new LocalStorageStore();
