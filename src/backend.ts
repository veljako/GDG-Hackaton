import type { Action, DemoState, Transition } from "./types";
import type { Auth } from "firebase/auth";
import { apiUrl } from "./api-url";
import { migrateStorageKey } from "./storage";
import type { OnboardingDraft, ReviewedProfile } from "./onboarding";
export type OnboardingInput = {
  profile: Partial<ReviewedProfile>;
  step: "review" | "interests";
  expected_extraction_hash: string;
  expected_profile_updated_at: string | null;
  expected_draft_version: number | null;
};
export const getOnboardingDraft = () =>
  request<{ draft: OnboardingDraft | null }>("onboarding/draft");
export const saveOnboardingDraft = (input: OnboardingInput) =>
  request<{ draft: OnboardingDraft }>("onboarding/draft", input);
export const completeOnboarding = (input: OnboardingInput) =>
  request<Snapshot & { message: string; matching_sync?: string }>(
    "onboarding/complete",
    input,
  );
export type BackendConfig = {
  mode: "demo" | "firebase";
  firebase: Record<string, string> | null;
};
export type Snapshot = { state: DemoState; organizer: boolean };
export type SemanticResponse = {
  source?: string;
  results: { eventId?: string; personId?: string; reasons: string[] }[];
  warnings?: string[];
  proposal?: Record<string, unknown>;
  extraction_hash?: string;
  expected_profile_updated_at?: string | null;
};
export const semanticMatching = (route: string, input: unknown = {}) =>
  request<SemanticResponse>(`matching/${route}`, input);
export const retryOnboardingMatching = () =>
  request<Snapshot & { matching_sync?: string; warnings?: string[] }>(
    "onboarding/retry-matching",
    {},
  );
const sessionKey = "gevents-api-session";
const pendingNamesKey = "gevents-pending-registration-names";
let config: BackendConfig;
let auth: Auth | undefined;
let token =
  migrateStorageKey(sessionStorage, sessionKey, "gdev-api-session") ?? "";
let mode: "attendee" | "organizer" =
  migrateStorageKey(sessionStorage, "gevents-view", "gdev-view") === "organizer"
    ? "organizer"
    : "attendee";
export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  data?: unknown,
  authenticated = true,
  download = false,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    data instanceof Blob || path.startsWith("matching/") ? 100000 : 12000,
  );
  try {
    const credential =
      config?.mode === "firebase"
        ? await auth?.currentUser?.getIdToken()
        : token;
    const response = await fetch(
      apiUrl(path, import.meta.env.VITE_API_ORIGIN ?? ""),
      {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(authenticated && credential
            ? { Authorization: `Bearer ${credential}` }
            : {}),
          ...(data === undefined
            ? {}
            : {
                "Content-Type":
                  data instanceof Blob ? "application/pdf" : "application/json",
              }),
        },
        body:
          data === undefined
            ? undefined
            : data instanceof Blob
              ? data
              : JSON.stringify(data),
        signal: controller.signal,
      },
    );
    if (download && response.ok) return (await response.blob()) as T;
    if (
      !(response.headers.get("content-type") ?? "").includes("application/json")
    )
      throw new BackendError(
        "The backend is unavailable. Start the API server and try again.",
        503,
      );
    const result = await response.json();
    if (!response.ok)
      throw new BackendError(
        result.error ?? "The request failed.",
        response.status,
      );
    if (
      result.matching_sync === "unavailable" &&
      Array.isArray(result.warnings)
    )
      result.message = [
        result.message || "Changes saved.",
        ...result.warnings,
      ].join(" ");
    return result as T;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(
      "Unable to reach the server. Check your connection and try again.",
      503,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
export async function initializeBackend(): Promise<{
  config: BackendConfig;
  snapshot: Snapshot | null;
  error?: string;
}> {
  config = await request<BackendConfig>("config", undefined, false);
  if (config.mode === "demo") {
    if (token) {
      try {
        return { config, snapshot: await getSnapshot() };
      } catch (error) {
        if (!(error instanceof BackendError) || error.status !== 401)
          throw error;
      }
    }
    return { config, snapshot: await switchDemo("luka", "attendee") };
  }
  if (!config.firebase)
    throw new BackendError("Firebase sign-in is not configured.", 503);
  const { initializeApp, getApps } = await import("firebase/app");
  const { getAuth } = await import("firebase/auth");
  auth = getAuth(getApps()[0] ?? initializeApp(config.firebase));
  await auth.authStateReady();
  if (!auth.currentUser) return { config, snapshot: null };
  try {
    return { config, snapshot: await getSnapshot() };
  } catch (error) {
    // Keep the auth gate available when a restored account cannot reach its profile.
    return { config, snapshot: null, error: (error as Error).message };
  }
}
export async function signIn(): Promise<Snapshot> {
  if (!auth) throw new BackendError("Firebase sign-in is not ready.", 503);
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    throw authError(error);
  }
  return getSnapshot();
}
function authError(error: unknown): Error {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    "auth/email-already-in-use":
      "This email already has an account. Sign in instead.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password":
      "Choose a stronger password with at least 8 characters.",
    "auth/password-does-not-meet-requirements":
      "Your password does not meet this community’s password requirements.",
    "auth/invalid-credential": "Email or password is incorrect. Try again.",
    "auth/user-not-found": "Email or password is incorrect. Try again.",
    "auth/wrong-password": "Email or password is incorrect. Try again.",
    "auth/user-disabled":
      "This account is disabled. Contact your community organizer.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Check your connection and try again.",
    "auth/popup-closed-by-user": "Sign-in was closed. You can try again.",
    "auth/popup-blocked": "Allow popups for this site to continue with Google.",
    "auth/unauthorized-domain":
      "Sign-in is not enabled for this address yet. Contact your community organizer.",
    "auth/operation-not-allowed":
      "This sign-in method is not enabled yet. Contact your community organizer.",
  };
  return new Error(
    (code && messages[code]) || "Sign-in could not finish. Please try again.",
  );
}
export const hasFirebaseSession = () => !!auth?.currentUser;
export async function register(
  name: string,
  email: string,
  password: string,
  names?: { first_name: string; last_name: string },
): Promise<Snapshot> {
  if (!auth) throw new BackendError("Firebase sign-in is not ready.", 503);
  if (!name.trim() || name.trim().length > 200)
    throw Error("Enter your name (up to 200 characters).");
  if (password.length < 8)
    throw Error("Choose a password with at least 8 characters.");
  if (
    names &&
    [names.first_name, names.last_name].some(
      (value) => !value.trim() || value.trim().length > 100,
    )
  )
    throw Error("Enter your first and last name (up to 100 characters each).");
  const { createUserWithEmailAndPassword, updateProfile } =
    await import("firebase/auth");
  try {
    const { user } = await createUserWithEmailAndPassword(
      auth,
      email.trim(),
      password,
    );
    if (names)
      sessionStorage.setItem(
        pendingNamesKey,
        JSON.stringify({
          uid: user.uid,
          first_name: names.first_name.trim(),
          last_name: names.last_name.trim(),
        }),
      );
    await updateProfile(user, { displayName: name.trim() });
    // Refresh claims so the API receives the newly set display name.
    await user.getIdToken(true);
  } catch (error) {
    throw authError(error);
  }
  return getSnapshot();
}
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<Snapshot> {
  if (!auth) throw new BackendError("Firebase sign-in is not ready.", 503);
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (error) {
    throw authError(error);
  }
  return getSnapshot();
}
export async function resetPassword(email: string): Promise<void> {
  if (!auth) throw new BackendError("Firebase sign-in is not ready.", 503);
  const { sendPasswordResetEmail } = await import("firebase/auth");
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (error) {
    throw authError(error);
  }
}
export async function signOut() {
  if (auth) await (await import("firebase/auth")).signOut(auth);
  token = "";
  sessionStorage.removeItem(sessionKey);
  sessionStorage.removeItem("gdev-api-session");
  mode = "attendee";
  sessionStorage.removeItem("gevents-view");
  sessionStorage.removeItem("gdev-view");
  sessionStorage.removeItem(pendingNamesKey);
}
export async function switchDemo(
  personId: string,
  nextMode: "attendee" | "organizer",
): Promise<Snapshot> {
  const result = await request<Snapshot & { token: string }>(
    "demo-session",
    { personId, mode: nextMode },
    false,
  );
  token = result.token;
  mode = nextMode;
  sessionStorage.setItem(sessionKey, token);
  sessionStorage.setItem("gevents-view", mode);
  return result;
}
export async function changeView(nextMode: "attendee" | "organizer") {
  const result = await request<Snapshot>(`state?mode=${nextMode}`);
  if (nextMode === "organizer" && !result.organizer)
    throw new BackendError("Your account does not have organizer access.", 403);
  mode = nextMode;
  sessionStorage.setItem("gevents-view", mode);
  return result;
}
export async function getSnapshot(): Promise<Snapshot> {
  const snapshot = await request<Snapshot>(`state?mode=${mode}`);
  const stored = sessionStorage.getItem(pendingNamesKey);
  if (config?.mode !== "firebase" || !stored) return snapshot;
  let names: { uid: string; first_name: string; last_name: string };
  try {
    names = JSON.parse(stored);
  } catch {
    sessionStorage.removeItem(pendingNamesKey);
    return snapshot;
  }
  if (
    !names ||
    names.uid !== snapshot.state.currentPersonId ||
    typeof names.first_name !== "string" ||
    typeof names.last_name !== "string"
  ) {
    sessionStorage.removeItem(pendingNamesKey);
    return snapshot;
  }
  const result = await sendAction({
    type: "UPDATE_PROFILE",
    personId: snapshot.state.currentPersonId,
    changes: { first_name: names.first_name, last_name: names.last_name },
  });
  if (result.error) throw new BackendError(result.error, 400);
  sessionStorage.removeItem(pendingNamesKey);
  return { state: result.state, organizer: result.organizer };
}
export const sendAction = (action: Action) =>
  request<Transition & { organizer: boolean }>(`actions?mode=${mode}`, action);
export async function uploadCv(file: File) {
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 5 * 1024 * 1024)
    throw new BackendError("Choose a PDF CV smaller than 5 MB.", 400);
  return request<Snapshot & { message: string }>(
    `cv?mode=${mode}&filename=${encodeURIComponent(file.name)}`,
    file,
  );
}
export const removeCv = () =>
  request<Snapshot & { message: string }>(`cv/remove?mode=${mode}`, {});
export const downloadCv = () =>
  request<Blob>(`cv?mode=${mode}`, undefined, true, true);
