import { STORES, type StorageBackend, type StoreName } from './storage';

const DB_NAME = 'lttv';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Transaction aborted'));
  });
}

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database is blocked by another open tab of this app.'));
  });
}

/** IndexedDB implementation (browser main thread, Web Workers, Android WebView). */
export class IdbBackend implements StorageBackend {
  private dbp: Promise<IDBDatabase>;
  constructor(name = DB_NAME) {
    this.dbp = openDb(name);
  }
  private async store(s: StoreName, mode: IDBTransactionMode) {
    const db = await this.dbp;
    const tx = db.transaction(s, mode);
    return { tx, os: tx.objectStore(s) };
  }
  async get<T>(s: StoreName, key: string) {
    const { os } = await this.store(s, 'readonly');
    return (await req(os.get(key))) as T | undefined;
  }
  async getMany<T>(s: StoreName, keys: string[]) {
    if (!keys.length) return [];
    const { os } = await this.store(s, 'readonly');
    return Promise.all(keys.map((k) => req(os.get(k)) as Promise<T | undefined>));
  }
  async getAll<T>(s: StoreName) {
    const { os } = await this.store(s, 'readonly');
    return (await req(os.getAll())) as T[];
  }
  async keys(s: StoreName) {
    const { os } = await this.store(s, 'readonly');
    return ((await req(os.getAllKeys())) as IDBValidKey[]).map(String);
  }
  async put(s: StoreName, key: string, value: unknown) {
    const { tx, os } = await this.store(s, 'readwrite');
    os.put(value, key);
    await done(tx);
  }
  async putMany(s: StoreName, entries: [string, unknown][]) {
    if (!entries.length) return;
    const { tx, os } = await this.store(s, 'readwrite');
    for (const [k, v] of entries) os.put(v, k);
    await done(tx);
  }
  async delete(s: StoreName, key: string) {
    const { tx, os } = await this.store(s, 'readwrite');
    os.delete(key);
    await done(tx);
  }
  async deleteMany(s: StoreName, keys: string[]) {
    if (!keys.length) return;
    const { tx, os } = await this.store(s, 'readwrite');
    for (const k of keys) os.delete(k);
    await done(tx);
  }
  async clear(s: StoreName) {
    const { tx, os } = await this.store(s, 'readwrite');
    os.clear();
    await done(tx);
  }
}
