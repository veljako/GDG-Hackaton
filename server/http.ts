import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { z } from "zod";
import type { Repository } from "./repository";
import { isDatabaseQuotaError } from "./firestore-read";
import { execute, view, type Session } from "./service";
import type { Person } from "../src/types";
import type { CvStorage } from "./cv-storage";
import { OrganizationError, type OrganizationStore } from "./organizations";
import { normalizePerson } from "../src/user-profile";
import { matchingRoutes, MatchingRouteError } from "./matching-routes";
import {
  onboardingRoutes,
  deliverOnboardingMatching,
} from "./onboarding-routes";
import {
  MatchingUnavailable,
  queueMatchingSync,
  type MatchingClient,
} from "./matching-client";

type Identity = {
  uid: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
};

export type ApiOptions = {
  repository: Repository;
  mode: "demo" | "firebase";
  publicConfig: Record<string, string> | null;
  authenticate?: (token: string) => Promise<Identity>;
  cvStorage?: CvStorage;
  organizerUids?: Set<string>;
  staticDirectory?: string;
  allowedOrigins?: Set<string>;
  matchingClient?: MatchingClient;
  organizationStore?: OrganizationStore;
};
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const loginSchema = z
  .object({
    personId: z.string().min(1).max(128),
    mode: z.enum(["attendee", "organizer"]),
  })
  .strict();
const organizationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    website: z
      .string()
      .trim()
      .max(300)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }),
    city: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
  })
  .strict();
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new ApiError(415, "Send JSON data.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128000) throw new ApiError(413, "Request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Invalid JSON request.");
  }
}
function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
export function createApi(options: ApiOptions) {
  const onboarding = onboardingRoutes(
    options.repository,
    options.matchingClient,
  );
  const matching = matchingRoutes(
    options.repository,
    options.matchingClient,
    options.cvStorage,
  );
  const sessions = new Map<string, { session: Session; expires: number }>();
  async function authenticate(
    request: IncomingMessage,
    url: URL,
  ): Promise<Session> {
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new ApiError(401, "Sign in to continue.");
    if (options.mode === "demo") {
      const stored = sessions.get(token);
      if (!stored || stored.expires < Date.now()) {
        sessions.delete(token);
        throw new ApiError(
          401,
          "Your demo session expired. Choose a profile again.",
        );
      }
      const snapshot = await options.organizationStore?.snapshot(
        stored.session.personId,
      );
      const person = (await options.repository.read()).people.find(
        (p) => p.id === stored.session.personId,
      );
      return {
        ...stored.session,
        ...snapshot,
        legacyOrganizer: stored.session.organizer,
        organizer: stored.session.organizer || !!snapshot?.memberships.length,
        identityEmail: person?.email ?? null,
        identityEmailVerified: person?.email_verified === true,
      };
    }
    if (!options.authenticate)
      throw new ApiError(503, "Firebase authentication is not configured.");
    let identity: Identity;
    try {
      identity = await options.authenticate(token);
    } catch {
      throw new ApiError(401, "Your sign-in expired. Sign in again.");
    }
    const existing = (await options.repository.read()).people.find(
      (p) => p.id === identity.uid,
    );
    if (
      !existing ||
      existing.email !== (identity.email ?? null) ||
      existing.email_verified !== (identity.emailVerified ?? false)
    ) {
      await options.repository.update((state) => {
        let person = state.people.find((p) => p.id === identity.uid);
        if (!person) {
          person = normalizePerson({
            id: identity.uid,
            name: identity.name || "New builder",
            title: "Community member",
            city: "",
            school: "",
            bio: "",
            skills: [],
            interests: [],
            roles: ["Participant"],
            experience: "",
            color: "blue",
            avatar: "",
            lookingForTeam: true,
            linkedin: "",
            kaggle: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(!options.organizerUids?.has(identity.uid)
              ? {
                  onboarding: {
                    version: 1 as const,
                    status: "required" as const,
                    completed_at: null,
                  },
                }
              : {}),
          });
          state.people.push(person);
        }
        person.email = identity.email ?? null;
        person.email_verified = identity.emailVerified ?? false;
        return { state };
      });
    }
    const legacyOrganizer = options.organizerUids?.has(identity.uid) ?? false;
    const snapshot = await options.organizationStore?.snapshot(identity.uid);
    const organizer = legacyOrganizer || !!snapshot?.memberships.length;
    return {
      personId: identity.uid,
      organizer,
      legacyOrganizer,
      ...snapshot,
      identityEmail: identity.email ?? null,
      identityEmailVerified: identity.emailVerified === true,
      mode:
        organizer && url.searchParams.get("mode") === "organizer"
          ? "organizer"
          : "attendee",
      demo: false,
    };
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const origin = request.headers.origin;
      const trustedOrigin = origin && options.allowedOrigins?.has(origin);
      if (url.pathname.startsWith("/api/")) {
        response.setHeader("Vary", "Origin");
        if (request.method === "OPTIONS") {
          const method = request.headers["access-control-request-method"];
          const headers = String(
            request.headers["access-control-request-headers"] ?? "",
          )
            .split(",")
            .map((header) => header.trim().toLowerCase())
            .filter(Boolean);
          if (
            !trustedOrigin ||
            !["GET", "POST"].includes(String(method)) ||
            headers.some(
              (header) => !["authorization", "content-type"].includes(header),
            )
          ) {
            throw new ApiError(403, "This browser request is not allowed.");
          }
          response.writeHead(204, {
            "Access-Control-Allow-Origin": origin!,
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
          });
          return response.end();
        }
        if (trustedOrigin)
          response.setHeader("Access-Control-Allow-Origin", origin!);
      }
      if (request.method === "POST") {
        // Vite/preview proxy preserves the original host. No cross-origin API writes.
        if (
          origin &&
          new URL(origin).host !== request.headers.host &&
          !options.allowedOrigins?.has(origin)
        )
          throw new ApiError(403, "Cross-origin writes are not allowed.");
      }
      if (request.method === "GET" && url.pathname === "/api/config")
        return send(response, 200, {
          mode: options.mode,
          firebase: options.publicConfig,
        });
      if (request.method === "GET" && url.pathname === "/api/health")
        return send(response, 200, { ok: true, mode: options.mode });
      if (request.method === "POST" && url.pathname === "/api/demo-session") {
        if (options.mode !== "demo") throw new ApiError(404, "Not found.");
        const parsed = loginSchema.safeParse(await body(request));
        if (!parsed.success)
          throw new ApiError(400, "Choose a demo person and view.");
        const state = await options.repository.read();
        if (!state.people.some((p) => p.id === parsed.data.personId))
          throw new ApiError(400, "Demo person not found.");
        for (const [key, value] of sessions)
          if (value.expires < Date.now()) sessions.delete(key);
        if (sessions.size >= 1000)
          throw new ApiError(429, "Too many demo sessions.");
        const token = randomBytes(32).toString("hex");
        const session: Session = {
          personId: parsed.data.personId,
          mode: parsed.data.mode,
          organizer: parsed.data.mode === "organizer",
          demo: true,
        };
        sessions.set(token, {
          session,
          expires: Date.now() + 8 * 60 * 60 * 1000,
        });
        return send(response, 200, {
          token,
          state: view(state, session),
          organizer: session.organizer,
        });
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        const session = await authenticate(request, url);
        return send(response, 200, {
          state: view(await options.repository.read(), session),
          organizer: session.organizer,
          organizations: session.organizations ?? [],
          memberships: session.memberships ?? [],
        });
      }
      if (
        url.pathname === "/api/organizations" ||
        url.pathname.startsWith("/api/organizations/")
      ) {
        const session = await authenticate(request, url);
        const store = options.organizationStore;
        if (!store)
          throw new ApiError(503, "Organization setup is not configured yet.");
        if (url.pathname === "/api/organizations" && request.method === "GET")
          return send(response, 200, await store.snapshot(session.personId));
        if (
          url.pathname === "/api/organizations" &&
          request.method === "POST"
        ) {
          const parsed = organizationInputSchema.safeParse(await body(request));
          if (!parsed.success)
            throw new ApiError(
              400,
              "Check the organization name, city, description, and website.",
            );
          return send(
            response,
            200,
            await store.create(session.personId, parsed.data),
          );
        }
        if (
          url.pathname === "/api/organizations/join" &&
          request.method === "POST"
        ) {
          const parsed = z
            .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
            .strict()
            .safeParse(await body(request));
          if (!parsed.success)
            throw new ApiError(400, "This invitation is invalid.");
          return send(
            response,
            200,
            await store.join(
              session.personId,
              session.identityEmail ?? null,
              session.identityEmailVerified === true,
              parsed.data.token,
            ),
          );
        }
        const route = url.pathname.match(
          /^\/api\/organizations\/([\w-]+)\/(members|invitations)$/,
        );
        if (route?.[2] === "members" && request.method === "GET") {
          const memberships = await store.members(session.personId, route[1]);
          const people = (await options.repository.read()).people;
          return send(response, 200, {
            members: memberships.map((m) => {
              const person = people.find((p) => p.id === m.personId);
              return {
                ...m,
                name: person?.name ?? "Organization member",
                email: person?.email ?? null,
              };
            }),
          });
        }
        if (route?.[2] === "invitations" && request.method === "POST") {
          const parsed = z
            .object({
              email: z.string().trim().email().max(254),
              role: z.enum(["admin", "member"]),
            })
            .strict()
            .safeParse(await body(request));
          if (!parsed.success)
            throw new ApiError(
              400,
              "Enter a valid email and organization role.",
            );
          return send(response, 200, {
            invitation: await store.invite(
              session.personId,
              route[1],
              parsed.data.email,
              parsed.data.role,
            ),
          });
        }
        throw new ApiError(404, "Not found.");
      }
      if (
        url.pathname.startsWith("/api/onboarding/") &&
        ["GET", "POST"].includes(request.method ?? "")
      ) {
        const session = await authenticate(request, url);
        if (
          request.method === "GET" &&
          url.pathname !== "/api/onboarding/draft"
        )
          throw new ApiError(405, "Use the setup form to finish your profile.");
        const result = await onboarding.handle(
          url.pathname.slice("/api/onboarding/".length),
          session,
          request.method === "POST" ? await body(request) : undefined,
        );
        return send(response, 200, result);
      }
      if (
        url.pathname.startsWith("/api/matching/") &&
        (request.method === "POST" ||
          (request.method === "GET" &&
            url.pathname === "/api/matching/cv/proposal"))
      ) {
        const session = await authenticate(request, url);
        const result = await matching.handle(
          url.pathname.slice("/api/matching/".length),
          session,
          request.method === "POST" ? await body(request) : {},
        );
        return send(response, 200, result);
      }
      if (
        (url.pathname === "/api/cv" &&
          ["GET", "POST"].includes(request.method ?? "")) ||
        (url.pathname === "/api/cv/remove" && request.method === "POST")
      ) {
        const session = await authenticate(request, url);
        const storage = options.cvStorage;
        if (!storage)
          throw new ApiError(503, "CV storage is not configured yet.");
        const uid = session.personId;
        if (request.method === "GET") {
          const person = (await options.repository.read()).people.find(
            (p) => p.id === uid,
          )!;
          if (!person.cv_document)
            throw new ApiError(404, "No stored CV. Upload a PDF first.");
          let bytes: Buffer;
          try {
            bytes = await storage.read(uid, person.cv_document.storage_path);
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code === "ENOENT" ||
              (error as { code?: number }).code === 404
            )
              throw new ApiError(
                404,
                "The stored CV file could not be found. Upload it again.",
              );
            throw error;
          }
          response.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="cv.pdf"; filename*=UTF-8''${encodeURIComponent(person.cv_document.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          });
          return response.end(bytes);
        }
        let path: string | null = null;
        let document: Person["cv_document"] = null;
        if (url.pathname === "/api/cv") {
          const filename = url.searchParams.get("filename") ?? "";
          if (
            !filename ||
            filename.length > 200 ||
            /[/\\\x00-\x1f\x7f]/.test(filename) ||
            !/\.pdf$/i.test(filename)
          )
            throw new ApiError(400, "Choose a PDF CV with a valid filename.");
          if (
            request.headers["content-type"]?.split(";")[0] !== "application/pdf"
          )
            throw new ApiError(415, "Upload a PDF CV.");
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 5 * 1024 * 1024)
              throw new ApiError(413, "Choose a CV smaller than 5 MB.");
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks);
          if (!/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("ascii")))
            throw new ApiError(400, "This file is not a PDF CV.");
          path = await storage.save(uid, bytes);
          document = {
            storage_path: path,
            filename,
            content_type: "application/pdf",
            size_bytes: size,
            uploaded_at: new Date().toISOString(),
            extraction_status: "not_started",
            extracted_at: null,
          };
        } else await body(request);
        let oldPath: string | undefined;
        let result;
        try {
          result = await options.repository.update((state) => {
            const person = state.people.find((p) => p.id === uid);
            if (!person)
              return { state, error: "Profile not found. Sign in again." };
            oldPath = person.cv_document?.storage_path;
            person.cv_document = document;
            person.cv = document?.filename ?? "";
            person.updated_at = new Date().toISOString();
            return { state };
          });
          if (result.error) throw new ApiError(400, result.error);
        } catch (error) {
          if (path)
            await storage
              .remove(uid, path)
              .catch(() => console.error("CV rollback cleanup failed."));
          throw error;
        }
        if (oldPath)
          await storage
            .remove(uid, oldPath)
            .catch(() => console.error("Previous CV cleanup failed."));
        matching.invalidate(uid);
        if (oldPath && options.matchingClient)
          await options.matchingClient
            .call("remove_cv", uid, result.state, { storage_path: oldPath })
            .catch(() =>
              console.error(
                "Matching CV invalidation unavailable; canonical revision guards remain required.",
              ),
            );
        return send(response, 200, {
          state: view(result.state, session),
          organizer: session.organizer,
          message: document ? "CV uploaded privately." : "CV removed.",
          ...(await queueMatchingSync(
            options.matchingClient,
            options.repository,
            uid,
          )),
        });
      }
      if (url.pathname === "/api/actions" && request.method === "POST") {
        const session = await authenticate(request, url);
        const input = await body(request);
        const result = await options.repository.update((state) =>
          execute(state, session, input),
        );
        const actionType =
          input && typeof input === "object" && "type" in input
            ? input.type
            : null;
        const sync =
          !result.error &&
          [
            "UPDATE_PROFILE",
            "CREATE_EVENT",
            "UPDATE_EVENT",
            "REVIEW_EVENT_PUBLICATION",
          ].includes(String(actionType))
            ? await queueMatchingSync(
                options.matchingClient,
                options.repository,
                session.personId,
                actionType !== "UPDATE_PROFILE",
              )
            : {};
        return send(response, result.error ? 400 : 200, {
          ...result,
          ...sync,
          state: view(result.state, session),
          organizer: session.organizer,
          organizations: session.organizations ?? [],
          memberships: session.memberships ?? [],
        });
      }
      if (
        !url.pathname.startsWith("/api/") &&
        request.method === "GET" &&
        options.staticDirectory
      ) {
        const root = resolve(options.staticDirectory);
        const path = resolve(root, "." + decodeURIComponent(url.pathname));
        if (!path.startsWith(root + sep) && path !== root)
          throw new ApiError(403, "Invalid path.");
        const file = url.pathname === "/" ? resolve(root, "index.html") : path;
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".jpg": "image/jpeg",
          ".png": "image/png",
          ".woff2": "font/woff2",
          ".json": "application/json",
        };
        let content: Buffer;
        try {
          content = await readFile(file);
        } catch {
          throw new ApiError(404, "Not found.");
        }
        response.writeHead(200, {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        });
        return response.end(content);
      }
      throw new ApiError(404, "Not found.");
    } catch (error) {
      if (isDatabaseQuotaError(error)) {
        response.setHeader("Retry-After", "300");
        return send(response, 503, {
          error:
            "The database has reached its usage limit. Existing data is preserved; please try again later.",
        });
      }
      if (error instanceof OrganizationError)
        return send(response, error.status, { error: error.message });
      if (error instanceof MatchingRouteError)
        return send(response, error.status, { error: error.message });
      if (error instanceof MatchingUnavailable)
        return send(response, 503, { error: error.message });
      if (error instanceof ApiError)
        return send(response, error.status, { error: error.message });
      console.error(
        "API request failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      send(response, 500, {
        error: "The server could not save or load your data. Try again.",
      });
    }
  });
  // Retry the durable onboarding handoff independently of browser sessions or later profile edits.
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  let retrying = false;
  let retryAfter = 0;
  async function retryPendingMatching() {
    if (retrying || !options.matchingClient || Date.now() < retryAfter) return;
    retrying = true;
    try {
      const people = options.repository.pendingMatchingPeople
        ? await options.repository.pendingMatchingPeople()
        : (await options.repository.read()).people;
      const pending = people
        .filter(
          (p) =>
            p.onboarding?.status === "completed" &&
            p.onboarding.matching_sync === "pending",
        )
        .slice(0, 20);
      for (const person of pending)
        await deliverOnboardingMatching(
          options.repository,
          options.matchingClient,
          person.id,
        );
    } catch (error) {
      if (isDatabaseQuotaError(error)) retryAfter = Date.now() + 300000;
      console.error(
        isDatabaseQuotaError(error)
          ? "Firebase quota exceeded; pending matching paused for five minutes."
          : "Pending profile matching will retry.",
      );
    } finally {
      retrying = false;
    }
  }
  server.once("listening", () => {
    if (options.matchingClient) {
      void retryPendingMatching();
      retryTimer = setInterval(() => void retryPendingMatching(), 30000);
      retryTimer.unref();
    }
  });
  server.once("close", () => {
    if (retryTimer) clearInterval(retryTimer);
  });
  return server;
}
