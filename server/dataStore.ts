import { get, put } from "@vercel/blob";

/** Dados financeiros de cada usuário, para acompanharem o login em qualquer aparelho. */
export interface SavedData {
  /** Momento da última alteração no aparelho que salvou (ms). */
  updatedAt: number;
  state: unknown;
}

export interface DataStore {
  load(user: string): Promise<SavedData | null>;
  save(user: string, data: SavedData): Promise<void>;
}

/** Vercel Blob privado: data/<usuario>.json. */
class BlobDataStore implements DataStore {
  private path = (u: string) => `data/${u}.json`;

  async load(user: string) {
    const r = await get(this.path(user), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return (await new Response(r.stream).json()) as SavedData;
  }

  async save(user: string, data: SavedData) {
    await put(this.path(user), JSON.stringify(data), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
}

/** Em memória: para testes e uso local sem Blob. */
class MemoryDataStore implements DataStore {
  private data = new Map<string, SavedData>();
  async load(user: string) {
    return this.data.get(user) ?? null;
  }
  async save(user: string, data: SavedData) {
    this.data.set(user, data);
  }
}

let store: DataStore | null | undefined;

/** Armazenamento dos dados, ou null quando não há onde guardar (os dados ficam só no navegador). */
export function dataStore(): DataStore | null {
  if (store !== undefined) return store;
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) store = new BlobDataStore();
  else if (process.env.AUTH_SIGNUP === "memory") store = new MemoryDataStore();
  else store = null;
  return store;
}
