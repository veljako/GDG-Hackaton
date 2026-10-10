import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createApi } from "./http";
import { FileRepository, FirestoreRepository } from "./repository";
import { FileCvStorage, CloudCvStorage } from "./cv-storage";

if (existsSync(".env.server.local")) loadEnvFile(".env.server.local");
// Existing deployments may still provide the previous environment prefix.
for (const [key, value] of Object.entries(process.env))
  if (
    key.startsWith("GDEV_") &&
    process.env[key.replace(/^GDEV_/, "GEVENTS_")] === undefined
  )
    process.env[key.replace(/^GDEV_/, "GEVENTS_")] = value;
const mode = process.env.GEVENTS_BACKEND_MODE ?? "demo";
if (mode !== "demo" && mode !== "firebase")
  throw new Error("GEVENTS_BACKEND_MODE must be demo or firebase.");
if (mode === "demo" && process.env.NODE_ENV === "production")
  throw new Error(
    "Demo authentication cannot run with NODE_ENV=production. Configure Firebase.",
  );
let options: Parameters<typeof createApi>[0];
if (mode === "firebase") {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const appId = process.env.FIREBASE_WEB_APP_ID;
  if (!projectId || !apiKey || !authDomain || !appId)
    throw new Error(
      "Firebase mode requires project ID and public web configuration.",
    );
  const { initializeApp, applicationDefault } =
    await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getStorage } = await import("firebase-admin/storage");
  initializeApp({ credential: applicationDefault(), projectId });
  options = {
    mode,
    repository: new FirestoreRepository(getFirestore()),
    publicConfig: { projectId, apiKey, authDomain, appId },
    ...(process.env.FIREBASE_STORAGE_BUCKET
      ? {
          cvStorage: new CloudCvStorage(
            getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET),
          ),
        }
      : process.env.GEVENTS_CV_DIRECTORY
        ? { cvStorage: new FileCvStorage(resolve(process.env.GEVENTS_CV_DIRECTORY)) }
        : {}),
    authenticate: async (token) => {
      const user = await getAuth().verifyIdToken(token, true);
      return {
        uid: user.uid,
        name: user.name,
        email: user.email,
        emailVerified: user.email_verified,
      };
    },
    organizerUids: new Set(
      (process.env.GEVENTS_ORGANIZER_UIDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
} else {
  options = {
    mode,
    repository: new FileRepository(
      resolve(process.env.GEVENTS_DATA_FILE ?? ".runtime/backend/state.json"),
    ),
    publicConfig: null,
    cvStorage: new FileCvStorage(
      resolve(
        process.env.GEVENTS_CV_DIRECTORY ?? ".runtime/backend/private-cvs",
      ),
    ),
  };
}
const port = Number(process.env.GEVENTS_API_PORT ?? process.env.PORT ?? 5181);
const host = process.env.GEVENTS_API_HOST ?? "127.0.0.1";
const allowedOrigins = new Set(
  (process.env.GEVENTS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const server = createApi({
  ...options,
  allowedOrigins,
  staticDirectory: resolve("dist"),
});
server.listen(port, host, () =>
  console.log(`GEvents API: http://${host}:${port} (${mode})`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
