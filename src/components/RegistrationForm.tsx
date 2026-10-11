import { useState } from "react";
import type { FormEvent } from "react";
import { BRAND } from "../config";
import "./onboarding.css";

type Props = {
  busy: boolean;
  error: string;
  signedIn: boolean;
  onGoogle: () => Promise<void>;
  onEmail: (email: string, password: string) => Promise<void>;
  onRegister: (
    firstName: string,
    lastName: string,
    email: string,
    password: string,
  ) => Promise<void>;
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onReset: (email: string) => Promise<void>;
};
export function RegistrationForm(props: Props) {
  const [screen, setScreen] = useState<"login" | "register" | "reset">("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resetError, setResetError] = useState("");
  const busy = props.busy || resetBusy;
  function changeScreen(next: typeof screen) {
    setScreen(next);
    setPassword("");
    setMessage("");
    setResetError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setMessage("");
    setResetError("");
    if (screen === "reset") {
      setResetBusy(true);
      try {
        await props.onReset(email);
        setMessage(
          "If an account exists for this email, you’ll receive a password reset link.",
        );
      } catch (error) {
        setResetError((error as Error).message);
      } finally {
        setResetBusy(false);
      }
    } else if (screen === "register")
      await props.onRegister(firstName, lastName, email, password);
    else await props.onEmail(email, password);
    setPassword("");
  }
  return (
    <div className="ob-shell ob-account">
      <aside className="ob-intro">
        <div className="ob-brand">
          <img src={BRAND.icon} alt="" width="38" height="38" />
          {BRAND.name}
        </div>
        <h1>
          A little about you.
          <br />A better next event.
        </h1>
        <p>
          Your experience, ideas and interests help us find events and teammates
          that fit.
        </p>
        <ol className="ob-progress" aria-label="Setup progress">
          {["Account", "Your CV", "Review profile", "Your interests"].map(
            (label, index) => (
              <li key={label} aria-current={index === 0 ? "step" : undefined}>
                <span>{index + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>
        <div className="ob-art" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </aside>
      <section className="backend-card ob-panel">
        <h1>
          {props.signedIn
            ? "Finish signing in"
            : screen === "register"
              ? "Find your people. Build together."
              : screen === "reset"
                ? "Reset your password"
                : "Your next team starts here"}
        </h1>
        <p>
          {props.signedIn
            ? "Your account is signed in. Retry connecting to your community."
            : screen === "register"
              ? "Create your account, then upload a PDF CV or background summary and review your profile before joining events."
              : screen === "reset"
                ? "Enter your account email and we’ll send you a reset link."
                : "Sign in to discover events, meet teammates and manage your applications."}
        </p>
        {!props.signedIn && screen !== "reset" && (
          <p className="registration-hint">
            New accounts complete four steps: Account, Your CV, Review profile
            and Your interests. A PDF up to 5 MiB and 20 pages is required.
          </p>
        )}
        {(resetError || props.error) && (
          <p role="alert" id="registration-error">
            {resetError || props.error}
          </p>
        )}
        {props.signedIn ? (
          <div className="registration-actions">
            <button
              className="backend-primary"
              disabled={busy}
              onClick={() => void props.onRetry()}
            >
              {busy ? "Connecting…" : "Retry connection"}
            </button>
            <button
              className="backend-link"
              disabled={busy}
              onClick={() => void props.onSignOut()}
            >
              Use a different account
            </button>
          </div>
        ) : (
          <>
            {screen !== "reset" && (
              <>
                <button
                  className="backend-google"
                  disabled={busy}
                  onClick={() => void props.onGoogle()}
                >
                  Continue with Google
                </button>
                <div className="registration-divider">
                  <span>or use your email</span>
                </div>
              </>
            )}
            <form
              className="registration-form"
              onSubmit={(event) => void submit(event)}
              aria-busy={busy}
            >
              {screen === "register" && (
                <>
                  <label>
                    First name
                    <input
                      name="first_name"
                      autoComplete="given-name"
                      required
                      maxLength={100}
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Last name
                    <input
                      name="last_name"
                      autoComplete="family-name"
                      required
                      maxLength={100}
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </label>
              {screen !== "reset" && (
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      screen === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    required
                    minLength={screen === "register" ? 8 : undefined}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    aria-describedby={
                      screen === "register" ? "password-hint" : undefined
                    }
                  />
                </label>
              )}
              {screen === "register" && (
                <p className="registration-hint" id="password-hint">
                  Use at least 8 characters.
                </p>
              )}
              <button className="backend-primary" type="submit" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : screen === "register"
                    ? "Create account"
                    : screen === "reset"
                      ? "Send reset link"
                      : "Sign in"}
              </button>
            </form>
            {message && <p role="status">{message}</p>}
            <div className="registration-actions">
              {screen === "login" ? (
                <>
                  <button
                    className="backend-link"
                    disabled={busy}
                    onClick={() => changeScreen("register")}
                  >
                    New here? Create an account
                  </button>
                  <button
                    className="backend-link"
                    disabled={busy}
                    onClick={() => changeScreen("reset")}
                  >
                    Forgot password?
                  </button>
                </>
              ) : (
                <button
                  className="backend-link"
                  disabled={busy}
                  onClick={() => changeScreen("login")}
                >
                  {screen === "register"
                    ? "Already have an account? Sign in"
                    : "Back to sign in"}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
