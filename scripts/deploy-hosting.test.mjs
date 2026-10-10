import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  authorizedRequest,
  buildManifest,
  publish,
  servingConfig,
} from "./deploy-hosting.mjs";

let directory, hosting;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "gevents-hosting-test-"));
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "deploy"));
  await writeFile(join(directory, "index.html"), "<h1>GEvents</h1>");
  await writeFile(join(directory, "assets/app.js"), "console.log('GEvents')");
  await writeFile(join(directory, ".env.server.local"), "private credential");
  await writeFile(
    join(directory, "deploy/source.tgz"),
    "private handoff archive",
  );
  hosting = JSON.parse(await readFile("firebase.json", "utf8")).hosting;
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("Hosting manifest excludes credentials and the source handoff, and preserves file content", async () => {
  const { files, blobs } = await buildManifest(directory);
  assert.deepEqual(Object.keys(files).sort(), [
    "/assets/app.js",
    "/index.html",
  ]);
  assert.equal(
    gunzipSync(blobs.get(files["/index.html"])).toString(),
    "<h1>GEvents</h1>",
  );
});
test("production API requests route to Cloud Run before the SPA fallback", () => {
  const config = servingConfig(hosting);
  assert.deepEqual(config.rewrites[0], {
    glob: "/api/**",
    run: { serviceId: "gevents", region: "europe-west1" },
  });
  assert.deepEqual(config.rewrites[1], { glob: "**", path: "/index.html" });
  assert.equal(
    config.headers[0].headers["Cache-Control"],
    "public,max-age=31536000,immutable",
  );
});
async function fakeDeployment(failure) {
  const { files } = await buildManifest(directory);
  const hash = files["/index.html"];
  const calls = [];
  const request = async (url, method = "GET", body) => {
    calls.push({ url, method, binary: Buffer.isBuffer(body) });
    if (
      url.endsWith("/sites/gdg-hackathon-d0b85") ||
      (url.endsWith("/releases/cloud.firestore") && method === "GET")
    )
      return { status: 404, body: {} };
    if (url.endsWith("/rulesets"))
      return {
        status: 200,
        body: { name: "projects/gdg-hackathon-d0b85/rulesets/test" },
      };
    if (url.endsWith("/versions"))
      return {
        status: 200,
        body: { name: "sites/gdg-hackathon-d0b85/versions/test" },
      };
    if (url.endsWith(":populateFiles"))
      return {
        status: 200,
        body: {
          uploadRequiredHashes: [hash],
          uploadUrl:
            failure === "destination"
              ? "https://example.com/credential-trap"
              : "https://upload-firebasehosting.googleapis.com/upload/test/files",
        },
      };
    if (Buffer.isBuffer(body) && failure === "upload")
      throw new Error("Upload failed");
    return { status: 200, body: {} };
  };
  const pending = publish({
    request,
    directory,
    hosting,
    rulesContent: "deny all",
    log: () => {},
  });
  if (failure)
    await assert.rejects(
      pending,
      failure === "upload"
        ? /Upload failed/
        : /Unexpected Hosting upload destination/,
    );
  else assert.equal(await pending, "https://gdg-hackathon-d0b85.web.app");
  return calls;
}
test("a complete upload is finalized before the live release is published", async () => {
  const calls = await fakeDeployment();
  const upload = calls.findIndex((c) => c.binary);
  const finalized = calls.findIndex((c) => c.url.includes("updateMask=status"));
  const released = calls.findIndex((c) =>
    c.url.includes("releases?versionName="),
  );
  assert.ok(upload >= 0 && finalized > upload && released > finalized);
});
test("an upload failure never publishes an incomplete build", async () => {
  const calls = await fakeDeployment("upload");
  assert.ok(
    !calls.some(
      (c) =>
        c.url.includes("updateMask=status") ||
        c.url.includes("releases?versionName="),
    ),
  );
});
test("an unexpected upload destination never receives content", async () => {
  const calls = await fakeDeployment("destination");
  assert.ok(!calls.some((c) => c.binary));
});
test("Google credentials cannot be sent to an arbitrary host or HTTP endpoint", async () => {
  let tokensRead = 0;
  const request = authorizedRequest({
    tokenProvider: () => {
      tokensRead++;
      return "test-only-token";
    },
  });
  await assert.rejects(
    request("https://example.com/"),
    /unexpected destination/,
  );
  await assert.rejects(
    request("http://firebasehosting.googleapis.com/"),
    /unexpected destination/,
  );
  assert.equal(tokensRead, 0);
});
test("authenticated requests refuse redirects instead of forwarding credentials", async () => {
  let received;
  const request = authorizedRequest({
    tokenProvider: () => "test-only-token",
    fetchImpl: async (_url, options) => {
      received = options;
      return new Response("{}", { status: 200 });
    },
  });
  await request(
    "https://firebasehosting.googleapis.com/v1beta1/sites/test",
    "POST",
    {},
  );
  assert.equal(received.redirect, "error");
  assert.equal(received.headers.Authorization, "Bearer test-only-token");
});
