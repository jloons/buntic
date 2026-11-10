import { join, dirname } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";

export class AssetCache {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  public getCachePath(namespace: string, hash: string, ext = "webp"): string {
    return join(this.cacheDir, namespace, `${hash}.${ext}`);
  }

  public computeHash(parts: (string | number | undefined | null)[]): string {
    const hasher = new Bun.CryptoHasher("sha256");
    for (const part of parts) {
      hasher.update(String(part ?? ""));
      hasher.update("::");
    }
    return hasher.digest("hex").slice(0, 24);
  }

  public has(namespace: string, hash: string, ext = "webp"): boolean {
    const filePath = this.getCachePath(namespace, hash, ext);
    return existsSync(filePath);
  }

  public async get(namespace: string, hash: string, ext = "webp"): Promise<Uint8Array | null> {
    const filePath = this.getCachePath(namespace, hash, ext);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const file = Bun.file(filePath);
      return await file.bytes();
    } catch {
      return null;
    }
  }

  public async set(namespace: string, hash: string, bytes: Uint8Array, ext = "webp"): Promise<string> {
    const filePath = this.getCachePath(namespace, hash, ext);
    mkdirSync(dirname(filePath), { recursive: true });
    await Bun.write(filePath, bytes);
    return filePath;
  }

  public async clean(): Promise<void> {
    if (existsSync(this.cacheDir)) {
      rmSync(this.cacheDir, { recursive: true, force: true });
    }
  }
}
