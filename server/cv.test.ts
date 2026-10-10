import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApi } from "./http";
import { FileRepository } from "./repository";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "gevents-cv-"));
  dirs.push(dir);
  const repository = new FileRepository(join(dir, "state.json"));
  const { FileCvStorage } = await import("./cv-storage");
  const storage = new FileCvStorage(join(dir, "cvs"));
  const server = createApi({
    repository,
    mode: "demo",
    publicConfig: null,
    cvStorage: storage,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  const login = async (personId: string) =>
    (
      await (
        await fetch(base + "/api/demo-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personId, mode: "attendee" }),
        })
      ).json()
    ).token as string;
  const token = await login("luka");
  const request = (
    path: string,
    method = "GET",
    body?: string | Buffer,
    credential = token,
    contentType = "application/pdf",
  ) =>
    fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": contentType,
      },
      body:
        typeof body === "string" || body === undefined
          ? body
          : new Uint8Array(body),
    });
  return { repository, storage, request, token, login, server };
}
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
it("persists a private CV, downloads the same bytes, replaces it and removes it", async () => {
  const { repository, storage, request } = await setup();
  const upload = await request("/api/cv?filename=Ana%20CV.pdf", "POST", pdf);
  expect(upload.status).toBe(200);
  const result = await upload.json();
  const person = result.state.people.find(
    (p: { id: string }) => p.id === "luka",
  );
  expect(person.cv_document).toMatchObject({
    filename: "Ana CV.pdf",
    content_type: "application/pdf",
    size_bytes: pdf.length,
    extraction_status: "not_started",
    uploaded_at: expect.any(String),
  });
  const firstPath = person.cv_document.storage_path;
  expect(
    (await repository.read()).people.find((p) => p.id === "luka")?.cv_document
      ?.storage_path,
  ).toBe(firstPath);
  const download = await request("/api/cv");
  expect(download.status).toBe(200);
  expect(download.headers.get("content-disposition")).toContain("attachment");
  expect(Buffer.from(await download.arrayBuffer())).toEqual(pdf);
  expect((await request("/api/cv?filename=new.pdf", "POST", pdf)).status).toBe(
    200,
  );
  await expect(storage.read("luka", firstPath)).rejects.toThrow();
  expect(
    (
      await request(
        "/api/cv/remove",
        "POST",
        "{}",
        undefined,
        "application/json",
      )
    ).status,
  ).toBe(200);
  expect((await request("/api/cv")).status).toBe(404);
  expect(
    (await repository.read()).people.find((p) => p.id === "luka")?.cv_document,
  ).toBeNull();
});
it("rejects anonymous, invalid, oversized and cross-user CV access", async () => {
  const { request, login, storage } = await setup();
  expect(
    (await request("/api/cv?filename=cv.pdf", "POST", pdf, "forged")).status,
  ).toBe(401);
  expect(
    (await request("/api/cv?filename=bad.pdf", "POST", "not a pdf")).status,
  ).toBe(400);
  expect((await request("/api/cv?filename=cv.doc", "POST", pdf)).status).toBe(
    400,
  );
  expect(
    (
      await request(
        "/api/cv?filename=cv.pdf",
        "POST",
        pdf,
        undefined,
        "text/plain",
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await request(
        "/api/cv?filename=cv.pdf",
        "POST",
        Buffer.alloc(5 * 1024 * 1024 + 1),
      )
    ).status,
  ).toBe(413);
  const uploaded = await (
    await request("/api/cv?filename=cv.pdf", "POST", pdf)
  ).json();
  const path = uploaded.state.people.find(
    (p: { id: string }) => p.id === "luka",
  ).cv_document.storage_path;
  const other = await login("mila");
  expect(
    (await request("/api/cv?personId=luka", "GET", undefined, other)).status,
  ).toBe(404);
  await expect(storage.read("mila", path)).rejects.toThrow();
  await expect(storage.read("luka", "../../state.json")).rejects.toThrow();
  const state = await (
    await request("/api/state", "GET", undefined, other)
  ).json();
  expect(
    state.state.people.find((p: { id: string }) => p.id === "luka"),
  ).not.toHaveProperty("cv_document");
});
it("keeps the old CV and cleans the new file when a metadata transaction fails", async () => {
  const { repository, storage, request } = await setup();
  expect((await request("/api/cv?filename=old.pdf", "POST", pdf)).status).toBe(
    200,
  );
  const old = (await repository.read()).people.find(
    (p) => p.id === "luka",
  )!.cv_document!;
  let newPath = "";
  const save = storage.save.bind(storage);
  vi.spyOn(storage, "save").mockImplementation(async (uid, bytes) => {
    newPath = await save(uid, bytes);
    return newPath;
  });
  const update = vi
    .spyOn(repository, "update")
    .mockRejectedValueOnce(Error("Test database outage"));
  expect((await request("/api/cv?filename=new.pdf", "POST", pdf)).status).toBe(
    500,
  );
  update.mockRestore();
  expect(
    (await repository.read()).people.find((p) => p.id === "luka")!.cv_document!
      .storage_path,
  ).toBe(old.storage_path);
  expect(await storage.read("luka", old.storage_path)).toEqual(pdf);
  await expect(storage.read("luka", newPath)).rejects.toThrow();
});
it("uses a private immutable Cloud Storage object with the same owner checks", async () => {
  const { CloudCvStorage } = await import("./cv-storage");
  const saved = vi.fn(async () => {});
  const download = vi.fn(async () => [pdf]);
  const deletion = vi.fn(async () => {});
  const file = vi.fn(() => ({ save: saved, download, delete: deletion }));
  const storage = new CloudCvStorage({ file } as never);
  const path = await storage.save("owner", pdf);
  expect(saved).toHaveBeenCalledWith(
    pdf,
    expect.objectContaining({
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
      },
    }),
  );
  expect(await storage.read("owner", path)).toEqual(pdf);
  await expect(storage.read("other", path)).rejects.toThrow(/path/i);
  await expect(storage.remove("owner", "../secret")).rejects.toThrow(/path/i);
  await storage.remove("owner", path);
  expect(deletion).toHaveBeenCalledWith({ ignoreNotFound: true });
});
