import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const token = randomBytes(24).toString('hex');
const stage = resolve(root, '.runtime/deploy', token);
const source = resolve(stage, 'source');
await mkdir(source, { recursive: true });
const entries = ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', '.gcloudignore', '.firebaserc', 'firebase.json', 'firestore.rules', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.server.json', 'src', 'server', 'public', 'dist', 'deploy/firebase-web.json', 'scripts/deploy-cloud.sh', 'scripts/deploy-hosting.mjs'];
for (const entry of entries) {
  await cp(resolve(root, entry), resolve(source, entry), { recursive: true, filter: path => !path.startsWith(resolve(root, 'dist/deploy')) });
}
const bashPath = resolve(source, 'scripts/deploy-cloud.sh');
await writeFile(bashPath, (await readFile(bashPath, 'utf8')).replaceAll('\r\n', '\n'));
const archive = resolve(stage, 'gevents.tgz');
execFileSync('C:/WINDOWS/system32/tar.exe', ['-czf', archive, '-C', source, '.']);
const contents = execFileSync('C:/WINDOWS/system32/tar.exe', ['-tzf', archive], { encoding: 'utf8' });
for (const name of contents.trim().split(/\r?\n/)) {
  if (name.includes('..') || /(^|\/)(\.env[^/]*|\.runtime|\.agents|node_modules|\.git|artifacts)(\/|$)/.test(name) || /serviceAccountKey|firebase-admin\.json|application_default_credentials|\.local\./i.test(name)) throw new Error(`Unsafe archive entry: ${name}`);
}
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
const preview = JSON.parse(await readFile('.runtime/cloudflare-backend.json', 'utf8')).url;
const base = `${preview}/deploy/${token}`;
const command = `TASK_DIR=$(mktemp -d "$HOME/gevents-deploy-XXXXXX") && curl -fsSL '${base}/gevents.tgz' -o "$TASK_DIR/gevents.tgz" && printf '${hash}  %s\\n' "$TASK_DIR/gevents.tgz" | sha256sum -c - && tar -xzf "$TASK_DIR/gevents.tgz" -C "$TASK_DIR" && bash "$TASK_DIR/scripts/deploy-cloud.sh"`;
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const target = resolve(root, 'dist/deploy', token);
await mkdir(target, { recursive: true });
await cp(archive, resolve(target, 'gevents.tgz'));
await writeFile(resolve(target, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Deploy GEvents</title><style>body{font-family:system-ui;background:#101017;color:#fafafa;max-width:650px;margin:auto;padding:24px;line-height:1.55}h1{font-size:36px}a,button{display:block;padding:14px;border-radius:12px;margin:12px 0;background:#cdfb50;color:#101017;font-weight:750;text-align:center;text-decoration:none;border:0;font-size:16px}textarea{box-sizing:border-box;width:100%;height:150px;background:#232330;color:white;border:1px solid #555;padding:12px;border-radius:12px;word-break:break-all}small{color:#bbb}.step{border-bottom:1px solid #444;padding:12px 0}</style></head><body><h1>Give GEvents a permanent home.</h1><p>Firebase Hosting + Cloud Run. Your teammates' algorithm stays unchanged.</p><section class="step"><h2>1. Enable billing</h2><p>Choose Blaze and link your payment method in Firebase.</p><a href="https://console.firebase.google.com/project/gdg-hackathon-d0b85/usage/details" target="_blank" rel="noopener">Open Firebase billing</a></section><section class="step"><h2>2. Copy this command</h2><p>The download checksum is checked before anything runs.</p><textarea id="command" readonly aria-label="Deployment command">${escape(command)}</textarea><button id="copy">Copy deployment command</button><p id="status" role="status"></p></section><section class="step"><h2>3. Open Cloud Shell</h2><p>Sign into the Google account that owns this Firebase project. Paste the command in the terminal, press Enter, and approve Google's authorization prompt. Keep this page available while it downloads.</p><a href="https://shell.cloud.google.com/?project=gdg-hackathon-d0b85" target="_blank" rel="noopener">Open Cloud Shell</a><p>Build and deployment can take several minutes. Wait for <strong>DEPLOYED AND HTTP VERIFIED</strong>, then tell Codex so login and the live app can be checked.</p></section><h2>What this creates</h2><p>A Cloud Run service in Belgium, a default Firestore database if absent, Firebase Hosting, and dedicated runtime/build identities. The runtime can access Firestore and verify Firebase users. Browser database access is denied; the API checks login.</p><p>Cloud Run scales to zero with a maximum of two instances. These limits and budget alerts do <strong>not</strong> cap the total bill. The setup cannot guarantee a $10 ceiling.</p><a href="https://console.cloud.google.com/billing/budgets?project=gdg-hackathon-d0b85" target="_blank" rel="noopener">Set a $10 budget alert</a><p>After deployment, enable Google sign-in if Firebase asks:</p><a href="https://console.firebase.google.com/project/gdg-hackathon-d0b85/authentication" target="_blank" rel="noopener">Firebase Authentication</a><small>Permanent address after successful deployment: https://gdg-hackathon-d0b85.web.app<br>This handoff link is temporary. Never paste passwords, tokens, or verification codes into chat.</small><script>document.getElementById('copy').onclick=async()=>{const input=document.getElementById('command');try{await navigator.clipboard.writeText(input.value);document.getElementById('status').textContent='Copied. Open Cloud Shell and paste it.'}catch{input.focus();input.select();document.getElementById('status').textContent='Select and copy the command above.'}};</script></body></html>`);
await writeFile('.runtime/deploy/handoff.json', JSON.stringify({ url: `${base}/index.html`, archiveUrl: `${base}/gevents.tgz`, hash, command, createdAt: new Date().toISOString(), entries: contents.trim().split(/\r?\n/) }, null, 2));
await writeFile(resolve(stage, 'bootstrap.sh'), `${command}\n`);
console.log(JSON.stringify({ url: `${base}/index.html`, hash, fileCount: contents.trim().split(/\r?\n/).length }));
