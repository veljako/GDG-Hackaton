import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import type { Action, DemoState, Transition } from "./types";
import {
  changeView,
  getSnapshot,
  initializeBackend,
  sendAction,
  signIn,
  signOut,
  switchDemo,
  register,
  signInWithEmail,
  resetPassword,
  hasFirebaseSession,
  uploadCv,
  removeCv,
} from "./backend";
import type { BackendConfig, Snapshot } from "./backend";
import { BRAND } from "./config";
import "./backend.css";
import { RegistrationForm } from "./components/RegistrationForm";
import { Onboarding } from "./components/Onboarding";
import { requiresOnboarding } from "./onboarding";
import type { Organization, OrganizationMembership } from "./organizations";
import { OrganizationSetup } from "./components/OrganizationSetup";
const organizationIntentKey = "gevents-organization-intent";
function storedOrganizationIntent(): string | null {
  return sessionStorage.getItem(organizationIntentKey);
}
type Context = {
  state: DemoState;
  run: (action: Action, silent?: boolean) => Promise<Transition>;
  busy: boolean;
  backendMode: BackendConfig["mode"];
  organizer: boolean;
  logout: () => Promise<void>;
  saveCv: (file: File | null) => Promise<boolean>;
  refresh: () => Promise<void>;
  organizations: Organization[];
  memberships: OrganizationMembership[];
  startOrganization: () => void;
  openWorkspace: () => Promise<void>;
};
const DemoContext = createContext<Context | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const invite = new URLSearchParams(location.search).get("invite") ?? "";
  const organizationRoute = location.pathname === "/organizations";
  const [organizationIntent, setOrganizationIntent] = useState(
    storedOrganizationIntent,
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const stateRef = useRef<Snapshot | null>(null);
  const lock = useRef(false);
  const refreshLock = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const accept = useCallback(
    (next: Snapshot) => {
      const previous = stateRef.current;
      const before = previous?.state.people.find(
        (p) => p.id === previous.state.currentPersonId,
      );
      const after = next.state.people.find(
        (p) => p.id === next.state.currentPersonId,
      );
      if (
        before &&
        after &&
        before.id === after.id &&
        requiresOnboarding(before) &&
        after.onboarding?.status === "completed"
      ) {
        // Polling may observe the commit while the completion request awaits matching delivery.
        navigate("/", { replace: true });
        if (after.onboarding.matching_sync === "pending")
          toast("Profile saved. Matching will retry automatically.");
        else
          toast.success(
            "Profile saved. Your recommendations are being prepared.",
          );
      }
      stateRef.current = next;
      setSnapshot(next);
      setError("");
    },
    [navigate],
  );
  const initialize = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await initializeBackend();
      if (!alive.current || current !== generation.current) return;
      setConfig(next.config);
      stateRef.current = next.snapshot;
      setSnapshot(next.snapshot);
      if (next.error) setError(next.error);
    } catch (e) {
      if (alive.current && current === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void initialize();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [initialize]);
  const connected = !!snapshot;
  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const current = generation.current;
      if (!lock.current && !refreshLock.current) {
        refreshLock.current = true;
        setRefreshing(true);
        try {
          const next = await getSnapshot();
          if (!disposed && !lock.current && current === generation.current)
            accept(next);
        } catch (e) {
          if (!disposed && current === generation.current)
            setError((e as Error).message);
        } finally {
          refreshLock.current = false;
          if (alive.current) setRefreshing(false);
        }
      }
      if (!disposed) timeout = setTimeout(refresh, 2000);
    };
    timeout = setTimeout(refresh, 2000);
    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [connected, accept]);
  const run = useCallback(
    async (action: Action, silent = false): Promise<Transition> => {
      const previous = stateRef.current;
      if (!previous) throw new Error("Sign in first.");
      if (lock.current)
        return {
          state: previous.state,
          error: "A change is already being saved. Please wait.",
        };
      lock.current = true;
      const current = ++generation.current;
      setBusy(true);
      try {
        let result: Transition & { organizer: boolean };
        if (action.type === "SET_PERSON" || action.type === "SET_MODE") {
          const personId =
            action.type === "SET_PERSON"
              ? action.personId
              : previous.state.currentPersonId;
          const mode =
            action.type === "SET_MODE" ? action.mode : previous.state.mode;
          if (config?.mode === "firebase" && action.type === "SET_PERSON")
            throw new Error("Sign out to use a different account.");
          const next =
            config?.mode === "demo"
              ? await switchDemo(personId, mode)
              : await changeView(mode);
          result = { ...next, message: "View updated." };
        } else result = await sendAction(action);
        if (!alive.current || current !== generation.current)
          return {
            state: previous.state,
            error: "Your account changed while this request was completing.",
          };
        accept({
          ...previous,
          ...result,
          state: result.state,
          organizer: result.organizer,
        });
        if (!silent && result.message) toast.success(result.message);
        return result;
      } catch (e) {
        const message = (e as Error).message;
        if (!alive.current || current !== generation.current)
          return { state: previous.state, error: message };
        toast.error(message);
        setError(message);
        return { state: previous.state, error: message };
      } finally {
        if (alive.current && current === generation.current) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [config, accept],
  );
  async function saveCv(file: File | null) {
    if (!stateRef.current || lock.current) return false;
    lock.current = true;
    const current = ++generation.current;
    setBusy(true);
    try {
      const next = file ? await uploadCv(file) : await removeCv();
      if (alive.current && current === generation.current) {
        accept(next);
        toast.success(next.message);
        return true;
      }
      return false;
    } catch (error) {
      if (alive.current && current === generation.current) {
        const message = (error as Error).message;
        toast.error(message);
        setError(message);
      }
      return false;
    } finally {
      if (alive.current && current === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function login(
    operation: () => Promise<Snapshot> = signIn,
    intent?: "attendee" | "organization",
  ) {
    if (busy) return;
    if (intent === "organization" || organizationRoute) {
      sessionStorage.setItem(organizationIntentKey, "pending");
      setOrganizationIntent("pending");
    } else if (intent === "attendee") {
      sessionStorage.removeItem(organizationIntentKey);
      setOrganizationIntent(null);
    }
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      if (alive.current && current === generation.current) {
        if (storedOrganizationIntent() === "pending") {
          sessionStorage.setItem(
            organizationIntentKey,
            next.state.currentPersonId,
          );
          setOrganizationIntent(next.state.currentPersonId);
          navigate(
            invite
              ? `/organizations?invite=${encodeURIComponent(invite)}`
              : "/organizations",
            { replace: true },
          );
        }
        accept(next);
      }
    } catch (e) {
      if (alive.current && current === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && current === generation.current) setBusy(false);
    }
  }
  async function logout() {
    sessionStorage.removeItem(organizationIntentKey);
    setOrganizationIntent(null);
    const current = ++generation.current;
    lock.current = false;
    setBusy(true);
    stateRef.current = null;
    setSnapshot(null);
    try {
      await signOut();
    } catch (e) {
      if (alive.current && current === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && current === generation.current) setBusy(false);
    }
  }
  async function retry() {
    if (lock.current || refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    const current = ++generation.current;
    try {
      const next = await getSnapshot();
      if (alive.current && !lock.current && current === generation.current)
        accept(next);
    } catch (e) {
      if (alive.current && current === generation.current)
        setError((e as Error).message);
    } finally {
      refreshLock.current = false;
      if (alive.current) setRefreshing(false);
    }
  }
  function startOrganization() {
    const uid = stateRef.current?.state.currentPersonId ?? "pending";
    sessionStorage.setItem(organizationIntentKey, uid);
    setOrganizationIntent(uid);
    navigate("/organizations");
  }
  async function openWorkspace() {
    const result = await run({ type: "SET_MODE", mode: "organizer" }, true);
    if (!result.error) {
      sessionStorage.removeItem(organizationIntentKey);
      setOrganizationIntent(null);
      navigate("/organizer");
    } else throw Error(result.error);
  }
  if (!snapshot && !loading && config?.mode === "firebase")
    return (
      <main className="backend-gate">
        <RegistrationForm
          busy={busy}
          error={error}
          signedIn={hasFirebaseSession()}
          initialIntent={organizationRoute ? "organization" : undefined}
          onOrganizationStart={startOrganization}
          onGoogle={(intent) => login(signIn, intent)}
          onEmail={(email, password, intent) =>
            login(() => signInWithEmail(email, password), intent)
          }
          onRegister={(first_name, last_name, email, password, intent) =>
            login(
              () =>
                register(
                  `${first_name.trim()} ${last_name.trim()}`,
                  email,
                  password,
                  { first_name, last_name },
                ),
              intent,
            )
          }
          onRetry={() => login(getSnapshot)}
          onSignOut={async () => {
            await logout();
            setError("");
          }}
          onReset={resetPassword}
        />
      </main>
    );
  if (!snapshot)
    return (
      <main className="backend-gate">
        <div className="backend-card">
          <div className="backend-brand">
            <img src={BRAND.icon} alt="" width="36" height="36" />
            <span>{BRAND.name}</span>
          </div>
          <h1>
            {loading
              ? "Getting your community ready"
              : config?.mode === "firebase"
                ? "Your next team starts here"
                : "Let’s get connected"}
          </h1>
          <p>
            {loading
              ? "Connecting to your shared workspace…"
              : "Sign in to discover hackathons, meet teammates and manage your applications."}
          </p>
          {error && <p role="alert">{error}</p>}
          {!loading && (
            <button
              className="backend-primary"
              disabled={busy}
              onClick={() => void initialize()}
            >
              Try again
            </button>
          )}
        </div>
      </main>
    );
  const currentPerson = snapshot.state.people.find(
    (person) => person.id === snapshot.state.currentPersonId,
  );
  if (
    currentPerson &&
    (organizationRoute ||
      organizationIntent === currentPerson.id ||
      organizationIntent === "pending")
  )
    return (
      <OrganizationSetup
        person={currentPerson}
        invite={invite}
        organizations={snapshot.organizations ?? []}
        memberships={snapshot.memberships ?? []}
        onRefresh={retry}
        onWorkspace={openWorkspace}
        onAttendee={async () => {
          sessionStorage.removeItem(organizationIntentKey);
          setOrganizationIntent(null);
          await run({ type: "SET_MODE", mode: "attendee" }, true);
          navigate("/");
        }}
        logout={logout}
      />
    );
  if (
    currentPerson &&
    requiresOnboarding(currentPerson) &&
    snapshot.state.mode !== "organizer"
  )
    return (
      <>
        <div className="organization-onboarding-link">
          <button onClick={startOrganization}>
            Host an event with your organization
          </button>
        </div>
        <Onboarding
          key={currentPerson.id}
          person={currentPerson}
          saveCv={saveCv}
          logout={logout}
          onComplete={(next) => {
            ++generation.current;
            accept(next);
          }}
        />
      </>
    );
  return (
    <DemoContext.Provider
      value={{
        state: snapshot.state,
        run,
        busy,
        backendMode: config?.mode ?? "demo",
        organizer: snapshot.organizer,
        logout,
        saveCv,
        refresh: retry,
        organizations: snapshot.organizations ?? [],
        memberships: snapshot.memberships ?? [],
        startOrganization,
        openWorkspace,
      }}
    >
      {error && (
        <div className="backend-status" role="alert">
          {error}{" "}
          <button disabled={refreshing || busy} onClick={() => void retry()}>
            Retry
          </button>
        </div>
      )}
      {busy && (
        <div className="backend-saving" role="status">
          Saving your change…
        </div>
      )}
      {children}
    </DemoContext.Provider>
  );
}
export function useBackendBusy() {
  return useContext(DemoContext)?.busy ?? false;
}
export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("DemoProvider is required");
  const me = value.state.people.find(
    (p) => p.id === value.state.currentPersonId,
  );
  if (!me) throw new Error("Signed-in profile is missing");
  return { ...value, me };
}
