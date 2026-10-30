import { get, put } from "@vercel/blob";

/** Contas criadas pelo cadastro: usuário → hash da senha. */
export interface UserStore {
  getHash(username: string): Promise<string | null>;
  /** Cria a conta; devolve false se o usuário já existir. */
  create(username: string, hash: string): Promise<boolean>;
}

/** Vercel Blob privado: um arquivo por conta em users/<usuario>.json. */
class BlobUserStore implements UserStore {
  private path = (u: string) => `users/${u}.json`;

  async getHash(username: string) {
    const r = await get(this.path(username), { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    const { hash } = (await new Response(r.stream).json()) as { hash: string };
    return hash;
  }

  async create(username: string, hash: string) {
    if (await this.getHash(username)) return false;
    try {
      await put(this.path(username), JSON.stringify({ hash, createdAt: new Date().toISOString() }), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return true;
    } catch (err) {
      // allowOverwrite: false faz o put falhar se outra pessoa criou a mesma conta ao mesmo tempo.
      if (await this.getHash(username)) return false;
      throw err;
    }
  }
}

/** Em memória: para testes e uso local sem Blob (as contas somem ao reiniciar). */
class MemoryUserStore implements UserStore {
  private users = new Map<string, string>();
  async getHash(username: string) {
    return this.users.get(username) ?? null;
  }
  async create(username: string, hash: string) {
    if (this.users.has(username)) return false;
    this.users.set(username, hash);
    return true;
  }
}

let store: UserStore | null | undefined;

/** Armazenamento do cadastro, ou null se o cadastro estiver desligado. */
export function userStore(): UserStore | null {
  if (store !== undefined) return store;
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) store = new BlobUserStore();
  else if (process.env.AUTH_SIGNUP === "memory") store = new MemoryUserStore();
  else store = null;
  return store;
}
