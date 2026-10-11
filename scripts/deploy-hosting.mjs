import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const PROJECT = "gdg-hackathon-d0b85";
const HOSTING = "https://firebasehosting.googleapis.com/v1beta1";
const RULES = "https://firebaserules.googleapis.com/v1";

export async function buildManifest(directory) {
  const files = {};
  const blobs = new Map();
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      // The temporary phone handoff must never reach permanent Hosting.
      if (
        entry.name.startsWith(".") ||
        entry.name === "deploy" ||
        entry.name === "node_modules"
      )
        continue;
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = gzipSync(await readFile(path), { level: 9 });
        const hash = createHash("sha256").update(content).digest("hex");
        files[`/${relative(directory, path).split(sep).join("/")}`] = hash;
        blobs.set(hash, content);
      }
    }
  }
  await visit(resolve(directory));
  if (!files["/index.html"])
    throw new Error("Build the app before publishing Hosting.");
  return { files, blobs };
}

export function servingConfig(hosting) {
  return {
    headers: (hosting.headers ?? []).map((rule) => ({
      glob: rule.source,
      headers: Object.fromEntries(
        rule.headers.map(({ key, value }) => [key, value]),
      ),
    })),
    rewrites: hosting.rewrites.map((rule) => ({
      glob: rule.source,
      ...(rule.run ? { run: rule.run } : { path: rule.destination }),
    })),
  };
}

export async function publish({
  request,
  directory,
  hosting,
  rulesContent,
  log = console.log,
}) {
  const site = hosting.site;
  if (site !== PROJECT) throw new Error("Unexpected Firebase Hosting site.");
  const sitePath = `${HOSTING}/projects/${PROJECT}/sites/${site}`;
  const existing = await request(sitePath, "GET", undefined, [404]);
  if (existing.status === 404) {
    await request(
      `${HOSTING}/projects/${PROJECT}/sites?siteId=${site}`,
      "POST",
      {},
    );
  }
  // Publish deny-by-default rules before exposing the production frontend.
  const ruleset = await request(
    `${RULES}/projects/${PROJECT}/rulesets`,
    "POST",
    {
      source: { files: [{ name: "firestore.rules", content: rulesContent }] },
    },
  );
  const releaseName = `projects/${PROJECT}/releases/cloud.firestore`;
  const currentRules = await request(
    `${RULES}/${releaseName}`,
    "GET",
    undefined,
    [404],
  );
  if (currentRules.status === 404) {
    await request(`${RULES}/projects/${PROJECT}/releases`, "POST", {
      name: releaseName,
      rulesetName: ruleset.body.name,
    });
  } else {
    await request(`${RULES}/${releaseName}`, "PATCH", {
      release: { name: releaseName, rulesetName: ruleset.body.name },
    });
  }
  const { files, blobs } = await buildManifest(directory);
  log(`Publishing ${Object.keys(files).length} frontend files…`);
  const version = await request(`${HOSTING}/sites/${site}/versions`, "POST", {
    config: servingConfig(hosting),
  });
  const name = version.body.name;
  if (!name?.startsWith(`sites/${site}/versions/`))
    throw new Error("Unexpected Hosting version resource.");
  const populated = await request(`${HOSTING}/${name}:populateFiles`, "POST", {
    files,
  });
  const required = populated.body.uploadRequiredHashes ?? [];
  if (
    required.length &&
    !populated.body.uploadUrl?.startsWith(
      "https://upload-firebasehosting.googleapis.com/",
    )
  ) {
    throw new Error("Unexpected Hosting upload destination.");
  }
  for (const hash of required) {
    const content = blobs.get(hash);
    if (!content)
      throw new Error("Hosting requested a file outside the manifest.");
    await request(`${populated.body.uploadUrl}/${hash}`, "POST", content);
  }
  await request(`${HOSTING}/${name}?updateMask=status`, "PATCH", {
    status: "FINALIZED",
  });
  await request(
    `${HOSTING}/sites/${site}/releases?versionName=${encodeURIComponent(name)}`,
    "POST",
    {},
  );
  return `https://${site}.web.app`;
}

export function authorizedRequest({ fetchImpl = fetch, tokenProvider }) {
  let token;
  return async (url, method = "GET", body, allowed = []) => {
    const target = new URL(url);
    if (
      ![
        "firebasehosting.googleapis.com",
        "upload-firebasehosting.googleapis.com",
        "firebaserules.googleapis.com",
        "identitytoolkit.googleapis.com",
        "billingbudgets.googleapis.com",
      ].includes(target.hostname) ||
      target.protocol !== "https:"
    ) {
      throw new Error(
        "Refusing to send Google credentials to an unexpected destination.",
      );
    }
    token ??= await tokenProvider();
    if (!token) throw new Error("Cloud Shell needs Google authorization.");
    const binary = Buffer.isBuffer(body);
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : {
              "Content-Type": binary
                ? "application/octet-stream"
                : "application/json",
            }),
      },
      body:
        body === undefined ? undefined : binary ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
      redirect: "error",
    });
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }
    if (!response.ok && !allowed.includes(response.status)) {
      throw new Error(
        `${method} ${target.hostname}${target.pathname}: ${response.status} ${result.error?.message ?? response.statusText}`,
      );
    }
    return { status: response.status, body: result };
  };
}

async function main() {
  const config = JSON.parse(await readFile("firebase.json", "utf8"));
  const request = authorizedRequest({
    tokenProvider: () =>
      execFileSync("gcloud", ["auth", "print-access-token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }).trim(),
  });
  const url = await publish({
    request,
    directory: resolve(config.hosting.public),
    hosting: config.hosting,
    rulesContent: await readFile(config.firestore.rules, "utf8"),
  });
  // Add permanent hostnames only if Auth was already initialized by the owner.
  const authUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  try {
    const auth = await request(authUrl, "GET");
    const domains = [
      ...new Set([
        ...(auth.body.authorizedDomains ?? []),
        `${PROJECT}.web.app`,
        `${PROJECT}.firebaseapp.com`,
      ]),
    ];
    await request(`${authUrl}?updateMask=authorizedDomains`, "PATCH", {
      authorizedDomains: domains,
    });
  } catch (error) {
    console.warn(
      `Hosting deployed; Firebase Google login still needs console setup. ${error.message}`,
    );
  }
  console.log(`\nHosting release published: ${url}\n`);
  console.log(
    "Run the verification printed by deploy-cloud.sh before calling the app ready.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
