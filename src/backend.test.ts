import { beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  auth: {
    currentUser: null as null | {
      getIdToken: () => Promise<string>;
      displayName?: string;
    },
    authStateReady: async () => {},
  },
  create: vi.fn(),
  login: vi.fn(),
  profile: vi.fn(),
  reset: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("firebase/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  getAuth: () => sdk.auth,
  createUserWithEmailAndPassword: sdk.create,
  signInWithEmailAndPassword: sdk.login,
  updateProfile: sdk.profile,
  sendPasswordResetEmail: sdk.reset,
  signOut: sdk.logout,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.auth.currentUser = null;
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("config")
              ? { mode: "firebase", firebase: { projectId: "test" } }
              : { state: { currentPersonId: "real-uid" }, organizer: false },
          ),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
});
it("registers through Firebase, sets the display name and sends only an ID token to the API", async () => {
  const user = { getIdToken: async () => "id-token" };
  sdk.create.mockImplementation(async () => {
    sdk.auth.currentUser = user;
    return { user };
  });
  const backend = await import("./backend");
  await backend.initializeBackend();
  await backend.register(
    "  Builder  ",
    "builder@example.com",
    "secret-password",
  );
  expect(sdk.create).toHaveBeenCalledWith(
    sdk.auth,
    "builder@example.com",
    "secret-password",
  );
  expect(sdk.profile).toHaveBeenCalledWith(user, { displayName: "Builder" });
  const request = vi.mocked(fetch).mock.calls.at(-1)!;
  expect(request[1]?.headers).toMatchObject({
    Authorization: "Bearer id-token",
  });
  expect(JSON.stringify(request)).not.toContain("secret-password");
});
it("maps Firebase registration failures to readable errors", async () => {
  sdk.create.mockRejectedValue({ code: "auth/email-already-in-use" });
  const backend = await import("./backend");
  await backend.initializeBackend();
  await expect(
    backend.register("Builder", "builder@example.com", "secret-password"),
  ).rejects.toThrow(/already.*account|already.*use/i);
});
it("persists explicit first and last names after registration without sending a password to the API", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const user = { uid: "real-uid", getIdToken: async () => "id-token" };
  sdk.create.mockImplementation(async () => {
    sdk.auth.currentUser = user;
    return { user };
  });
  const backend = await import("./backend");
  await backend.initializeBackend();
  await backend.register(
    "Ana Marija Petrović",
    "ana@example.com",
    "secret-password",
    { first_name: "Ana Marija", last_name: "Petrović" },
  );
  const call = vi.mocked(fetch).mock.calls.at(-1)!;
  expect(call[0]).toContain("actions");
  expect(JSON.parse(String(call[1]?.body))).toEqual({
    type: "UPDATE_PROFILE",
    personId: "real-uid",
    changes: { first_name: "Ana Marija", last_name: "Petrović" },
  });
  expect(JSON.stringify(call)).not.toContain("secret-password");
  expect(values.has("gevents-pending-registration-names")).toBe(false);
});
it("retries API profile creation without creating a second Firebase account", async () => {
  const user = { getIdToken: async () => "id-token" };
  sdk.create.mockImplementation(async () => {
    sdk.auth.currentUser = user;
    return { user };
  });
  const backend = await import("./backend");
  await backend.initializeBackend();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "Storage unavailable" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(
    backend.register("Builder", "builder@example.com", "secret-password"),
  ).rejects.toThrow("Storage unavailable");
  expect(backend.hasFirebaseSession()).toBe(true);
  await backend.getSnapshot();
  expect(sdk.create).toHaveBeenCalledTimes(1);
});
it("restores the Firebase gate with a retry when an existing session cannot load its profile", async () => {
  sdk.auth.currentUser = { getIdToken: async () => "id-token" };
  const backend = await import("./backend");
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    args[0].toString().endsWith("config")
      ? original(...args)
      : new Response(JSON.stringify({ error: "Storage unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
  );
  const result = await backend.initializeBackend();
  expect(result.config.mode).toBe("firebase");
  expect(result.snapshot).toBeNull();
  expect(result.error).toBe("Storage unavailable");
  expect(backend.hasFirebaseSession()).toBe(true);
});
it("email sign-in and password reset use Firebase rather than application endpoints", async () => {
  const backend = await import("./backend");
  await backend.initializeBackend();
  sdk.login.mockImplementation(async () => {
    sdk.auth.currentUser = { getIdToken: async () => "id-token" };
  });
  await backend.signInWithEmail(" builder@example.com ", "test-password");
  expect(sdk.login).toHaveBeenCalledWith(
    sdk.auth,
    "builder@example.com",
    "test-password",
  );
  const calls = vi.mocked(fetch).mock.calls.length;
  await backend.resetPassword(" builder@example.com ");
  expect(sdk.reset).toHaveBeenCalledWith(sdk.auth, "builder@example.com");
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
});
