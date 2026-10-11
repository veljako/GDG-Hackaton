import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Bucket } from "@google-cloud/storage";

export interface CvStorage {
  save(uid: string, bytes: Buffer): Promise<string>;
  read(uid: string, path: string): Promise<Buffer>;
  remove(uid: string, path: string): Promise<void>;
}
const owner = (uid: string) => createHash("sha256").update(uid).digest("hex");
const key = (uid: string) => `cvs/${owner(uid)}/${randomUUID()}.pdf`;
function ownedPath(uid: string, path: string) {
  if (!new RegExp(`^cvs/${owner(uid)}/[a-f0-9-]{36}\\.pdf$`).test(path))
    throw Error("Invalid CV storage path.");
  return path;
}
export class FileCvStorage implements CvStorage {
  constructor(private directory: string) {}
  async save(uid: string, bytes: Buffer) {
    const path = key(uid);
    const file = join(this.directory, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    return path;
  }
  async read(uid: string, path: string) {
    return readFile(join(this.directory, ownedPath(uid, path)));
  }
  async remove(uid: string, path: string) {
    try {
      await unlink(join(this.directory, ownedPath(uid, path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export class CloudCvStorage implements CvStorage {
  constructor(private bucket: Bucket) {}
  async save(uid: string, bytes: Buffer) {
    const path = key(uid);
    await this.bucket.file(path).save(bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
      },
    });
    return path;
  }
  async read(uid: string, path: string) {
    return (await this.bucket.file(ownedPath(uid, path)).download())[0];
  }
  async remove(uid: string, path: string) {
    await this.bucket
      .file(ownedPath(uid, path))
      .delete({ ignoreNotFound: true });
  }
}
