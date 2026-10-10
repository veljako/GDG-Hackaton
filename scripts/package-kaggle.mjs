import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const stage = resolve(".runtime/kaggle");
const source = resolve(stage, "source");
await mkdir(source, { recursive: true });
const entries = ["package.json", "package-lock.json", "Dockerfile", ".dockerignore", "firestore.rules", "firebase.self-hosted.json", "index.html", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "tsconfig.server.json", "src", "server", "public", "deploy/firebase-web.json"];
for (const entry of entries) {
  await mkdir(resolve(source, entry, ".."), { recursive: true });
  await cp(resolve(entry), resolve(source, entry), { recursive: true });
}
const archive = resolve(stage, "gevents-backend.tgz");
const tar = process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
execFileSync(tar, ["-czf", archive, "-C", source, "."]);
const listing = execFileSync(tar, ["-tzf", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
for (const name of listing) {
  if (name.split("/").includes("..") || /(^|\/)(\.env[^/]*|\.runtime|\.agents|node_modules|\.git|dist|artifacts|backend\.env)(\/|$)/.test(name) || /firebase-admin|serviceAccountKey|application_default_credentials/i.test(name)) {
    throw new Error(`Unexpected private or generated archive entry: ${name}`);
  }
}
const hash = createHash("sha256").update(await readFile(archive)).digest("hex");
const bootstrap = String.raw`import hashlib, json, os, re, shutil, subprocess, tarfile, tempfile, time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
from kaggle_secrets import UserSecretsClient

EXPECTED_SHA256 = "SOURCE_HASH"
PROJECT = "gdg-hackathon-d0b85"
work = Path("/kaggle/working/gevents-backend")
private = Path(tempfile.mkdtemp(prefix="gevents-private-", dir="/tmp"))
processes = []
logs = []

def stop_backend():
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    for handle in logs:
        handle.close()
    shutil.rmtree(private, ignore_errors=True)

def download(url, destination, expected=None):
    with urlopen(Request(url, headers={"User-Agent": "GEvents-Kaggle-Setup"}), timeout=60) as response:
        with destination.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    if expected and hashlib.sha256(destination.read_bytes()).hexdigest() != expected:
        raise RuntimeError("Downloaded file checksum does not match.")

def get_json(url):
    with urlopen(Request(url, headers={"User-Agent": "GEvents-Kaggle-Setup"}), timeout=15) as response:
        return json.load(response)

try:
    if "gevents_api_process" in globals() and gevents_api_process.poll() is None:
        raise RuntimeError("Stop the previous backend session before running setup again.")
    archives = list(Path("/kaggle/input").rglob("gevents-backend.tgz"))
    if len(archives) != 1:
        raise RuntimeError("Attach exactly one private dataset containing gevents-backend.tgz.")
    if hashlib.sha256(archives[0].read_bytes()).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError("The source archive does not match this notebook. Regenerate both together.")
    work.mkdir(parents=True, exist_ok=True)
    # Reject links and unsafe names before extraction; never execute dataset code until verified.
    with tarfile.open(archives[0], "r:gz") as bundle:
        for member in bundle.getmembers():
            target = (work / member.name).resolve()
            if not target.is_relative_to(work.resolve()) or not (member.isfile() or member.isdir()):
                raise RuntimeError("Unsafe source archive entry.")
        bundle.extractall(work)
    config = json.loads((work / "deploy/firebase-web.json").read_text())
    secrets = UserSecretsClient()
    def brand_secret(name):
        try:
            return secrets.get_secret("GEVENTS_" + name)
        except Exception:
            return secrets.get_secret("GHUB_" + name)
    credential = json.loads(brand_secret("FIREBASE_ADMIN_JSON"))
    if credential.get("type") != "service_account" or credential.get("project_id") != PROJECT:
        raise RuntimeError("The attached Firebase secret must be a service account for this project.")
    credential_path = private / "firebase-admin.json"
    credential_path.write_text(json.dumps(credential))
    credential_path.chmod(0o600)
    del credential
    bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", "")
    if not bucket_name:
        try:
            bucket_name = brand_secret("FIREBASE_STORAGE_BUCKET").strip()
        except Exception:
            raise RuntimeError("Attach GEVENTS_FIREBASE_STORAGE_BUCKET with the private CV bucket name.") from None
    if not bucket_name or "/" in bucket_name or bucket_name.startswith("gs:"):
        raise RuntimeError("Use the private bucket name without gs:// in GEVENTS_FIREBASE_STORAGE_BUCKET.")
    try:
        organizer_uids = brand_secret("ORGANIZER_UIDS")
    except Exception:
        organizer_uids = ""
        print("No organizer UID secret attached; users will have attendee access.")
    node_base = "https://nodejs.org/dist/latest-v24.x/"
    with urlopen(node_base + "SHASUMS256.txt", timeout=30) as response:
        checksums = response.read().decode()
    match = re.search(r"^([0-9a-f]{64})\s+(node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz)$", checksums, re.M)
    if not match:
        raise RuntimeError("Cannot find the official Node 24 Linux x64 distribution.")
    node_archive = private / match[2]
    download(node_base + match[2], node_archive, match[1])
    with tarfile.open(node_archive, "r:xz") as bundle:
        for member in bundle.getmembers():
            target = (private / member.name).resolve()
            if not target.is_relative_to(private.resolve()):
                raise RuntimeError("Unsafe Node distribution archive.")
            if member.issym() and not (target.parent / member.linkname).resolve().is_relative_to(private.resolve()):
                raise RuntimeError("Unsafe Node distribution link.")
            if member.islnk() and not (private / member.linkname).resolve().is_relative_to(private.resolve()):
                raise RuntimeError("Unsafe Node distribution hard link.")
        bundle.extractall(private)
    node_dir = private / match[2].removesuffix(".tar.xz") / "bin"
    env = os.environ.copy()
    env["PATH"] = str(node_dir) + os.pathsep + env["PATH"]
    # Install/build before adding credentials to the subprocess environment.
    for key in list(env):
        if key.startswith("VITE_") or key in ("GOOGLE_APPLICATION_CREDENTIALS", "GEVENTS_FIREBASE_ADMIN_JSON", "GHUB_FIREBASE_ADMIN_JSON"):
            env.pop(key, None)
    subprocess.run([str(node_dir / "npm"), "ci", "--no-audit", "--no-fund"], cwd=work, env=env, check=True)
    subprocess.run([str(node_dir / "npm"), "run", "build"], cwd=work, env=env, check=True)
    env.update({
        "NODE_ENV": "production", "GEVENTS_BACKEND_MODE": "firebase",
        "GEVENTS_API_HOST": "127.0.0.1", "GEVENTS_API_PORT": "8080",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credential_path),
        "FIREBASE_PROJECT_ID": PROJECT, "FIREBASE_WEB_API_KEY": config["apiKey"],
        "FIREBASE_AUTH_DOMAIN": config["authDomain"], "FIREBASE_WEB_APP_ID": config["appId"],
        "FIREBASE_STORAGE_BUCKET": bucket_name,
        "GEVENTS_ORGANIZER_UIDS": organizer_uids,
        "GEVENTS_ALLOWED_ORIGINS": "https://gdg-hackathon-d0b85.web.app,https://gdg-hackathon-d0b85.firebaseapp.com",
    })
    # Fail before publishing a URL if Firestore/Auth or private CV storage is inaccessible.
    subprocess.run([str(node_dir / "node"), "--import", "tsx", "server/check-firebase.ts", "--project", PROJECT], cwd=work, env=env, check=True)
    api_log = (private / "api.log").open("w")
    logs.append(api_log)
    gevents_api_process = subprocess.Popen([str(node_dir / "node"), "--import", "tsx", "server/index.ts"], cwd=work, env=env, stdout=api_log, stderr=subprocess.STDOUT)
    processes.append(gevents_api_process)
    for attempt in range(30):
        if gevents_api_process.poll() is not None:
            raise RuntimeError("Backend startup failed. Check Firebase configuration and the private API log.")
        try:
            health = get_json("http://127.0.0.1:8080/api/health")
            if health == {"ok": True, "mode": "firebase"}:
                break
        except (URLError, TimeoutError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError("Backend did not become ready.")
    release = get_json("https://api.github.com/repos/cloudflare/cloudflared/releases/latest")
    asset = next(item for item in release["assets"] if item["name"] == "cloudflared-linux-amd64")
    digest = asset.get("digest", "")
    url = asset["browser_download_url"]
    if not url.startswith("https://github.com/cloudflare/cloudflared/releases/download/") or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise RuntimeError("Official cloudflared asset has no usable SHA-256 digest.")
    cloudflared = private / "cloudflared"
    download(url, cloudflared, digest.split(":", 1)[1])
    cloudflared.chmod(0o700)
    tunnel_path = private / "tunnel.log"
    tunnel_log = tunnel_path.open("w")
    logs.append(tunnel_log)
    # The tunnel process receives no Firebase credential environment.
    tunnel = subprocess.Popen([str(cloudflared), "tunnel", "--url", "http://127.0.0.1:8080", "--no-autoupdate"], stdout=tunnel_log, stderr=subprocess.STDOUT)
    processes.append(tunnel)
    for attempt in range(45):
        if tunnel.poll() is not None:
            raise RuntimeError("Quick Tunnel failed. Check Kaggle Internet access and the private tunnel log.")
        found = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", tunnel_path.read_text())
        if found:
            gevents_api_origin = found[0]
            try:
                public_config = get_json(gevents_api_origin + "/api/config")
                if public_config.get("mode") == "firebase" and public_config.get("firebase", {}).get("projectId") == PROJECT:
                    break
            except (URLError, TimeoutError):
                pass
        time.sleep(1)
    else:
        raise RuntimeError("The public API did not become available.")
    for path, expected_status in [("state", 401), ("demo-session", 404)]:
        request = Request(gevents_api_origin + "/api/" + path, method="POST" if path == "demo-session" else "GET")
        try:
            urlopen(request, timeout=15)
        except HTTPError as error:
            if error.code != expected_status:
                raise RuntimeError("Unexpected public authentication response.") from None
        else:
            raise RuntimeError("The public backend did not reject unauthenticated access.")
    print("Temporary API:", gevents_api_origin)
    print("Frontend build setting: VITE_API_ORIGIN=" + gevents_api_origin)
    print("HTTP/auth rejection checks passed. Real Google sign-in and a Firestore read/write still need verification.")
    print("Run the next cell to serve requests for this Kaggle session. The URL changes after restart.")
except BaseException:
    stop_backend()
    raise
` .replace("SOURCE_HASH", hash);
const markdown = text => ({ cell_type: "markdown", metadata: {}, source: text.split(/(?<=\n)/) });
const code = text => ({ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: text.split(/(?<=\n)/) });
const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python", version: "3.11" } },
  cells: [
    markdown("# GEvents API on Kaggle\n\nTemporary hosting for the existing backend. The algorithm is unchanged; this notebook does not train a model.\n\nAttach the matching **private** dataset containing `gevents-backend.tgz`, enable Internet, and attach Kaggle Secrets `GEVENTS_FIREBASE_ADMIN_JSON` and `GEVENTS_FIREBASE_STORAGE_BUCKET` (private CV bucket name without `gs://`). Optionally attach `GEVENTS_ORGANIZER_UIDS`. The backend identity needs Firestore/Auth access and `roles/storage.objectUser` on that bucket. Keep secrets out of cells and output. CPU is enough for this API.\n\nSetup checks Firestore, Auth and a disposable private CV upload/download/removal before exposing the API. It does not create or modify real user accounts. Kaggle CPU/GPU sessions have a 12-hour execution limit. Stopping the session ends hosting. The Quick Tunnel URL changes after restart. Real Google sign-in still requires an end-to-end check.\n"),
    code(bootstrap),
    markdown("## Serve for this session\n\nRun this cell to keep serving the API. Interrupt it to stop the API/tunnel and clean up its temporary credential. No quota resets or session-limit bypasses are performed.\n"),
    code("try:\n    while gevents_api_process.poll() is None and tunnel.poll() is None:\n        time.sleep(5)\n    raise RuntimeError('A serving process exited; restart setup to obtain a fresh URL.')\nfinally:\n    stop_backend()\n"),
  ].map((cell, index) => ({ ...cell, id: `gevents-cell-${index + 1}` })),
};
await writeFile("deploy/kaggle-backend.ipynb", JSON.stringify(notebook, null, 2) + "\n");
await writeFile(resolve(stage, "manifest.json"), JSON.stringify({ archive, sha256: hash, entries: listing, createdAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ archive, notebook: resolve("deploy/kaggle-backend.ipynb"), sha256: hash, entries: listing.length }));
