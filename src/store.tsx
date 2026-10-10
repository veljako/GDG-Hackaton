import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
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
type Context = {
  state: DemoState;
  run: (action: Action, silent?: boolean) => Promise<Transition>;
  busy: boolean;
  backendMode: BackendConfig["mode"];
  organizer: boolean;
  logout: () => Promise<void>;
  saveCv: (file: File | null) => Promise<void>;
};
const DemoContext = createContext<Context | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
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
  const accept = useCallback((next: Snapshot) => {
    stateRef.current = next;
    setSnapshot(next);
    setError("");
  }, []);
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
        accept({ state: result.state, organizer: result.organizer });
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
    if (!stateRef.current || lock.current) return;
    lock.current = true;
    const current = ++generation.current;
    setBusy(true);
    try {
      const next = file ? await uploadCv(file) : await removeCv();
      if (alive.current && current === generation.current) {
        accept(next);
        toast.success(next.message);
      }
    } catch (error) {
      if (alive.current && current === generation.current) {
        const message = (error as Error).message;
        toast.error(message);
        setError(message);
      }
    } finally {
      if (alive.current && current === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function login(operation: () => Promise<Snapshot> = signIn) {
    if (busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      if (alive.current && current === generation.current) accept(next);
    } catch (e) {
      if (alive.current && current === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && current === generation.current) setBusy(false);
    }
  }
  async function logout() {
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
  if (!snapshot && !loading && config?.mode === "firebase")
    return (
      <main className="backend-gate">
        <RegistrationForm
          busy={busy}
          error={error}
          signedIn={hasFirebaseSession()}
          onGoogle={() => login()}
          onEmail={(email, password) =>
            login(() => signInWithEmail(email, password))
          }
          onRegister={(first_name, last_name, email, password) =>
            login(() =>
              register(
                `${first_name.trim()} ${last_name.trim()}`,
                email,
                password,
                { first_name, last_name },
              ),
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
