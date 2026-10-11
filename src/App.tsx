import { lazy, Suspense, useEffect, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  House,
  CalendarBlank,
  UsersThree,
  Globe,
  Stack,
  Bell,
  MagnifyingGlass,
  CaretDown,
  ArrowRight,
  ArrowCounterClockwise,
  Sliders,
  UserCircle,
  Check,
  X,
  Sun,
  Moon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useDemo } from "./store";
import { BRAND } from "./config";
import { BrandMark } from "./components/visuals";
import { Avatar, Button, Empty, IconButton, Modal } from "./components/ui";
import { PageLoader } from "./components/playful";
import { useTheme } from "./theme";
import { GuidedTour } from "./components/GuidedTour";

const Home = lazy(() => import("./pages/Home"));
const Hackathons = lazy(() => import("./pages/Events"));
const HackathonDetail = lazy(() =>
  import("./pages/Hackathons").then((m) => ({ default: m.HackathonDetail })),
);
const Teams = lazy(() =>
  import("./pages/Teams").then((m) => ({ default: m.Teams })),
);
const TeamDetail = lazy(() =>
  import("./pages/Teams").then((m) => ({ default: m.TeamDetail })),
);
const People = lazy(() => import("./pages/People"));
const Activity = lazy(() =>
  import("./pages/Activity").then((m) => ({ default: m.Activity })),
);
const Profile = lazy(() =>
  import("./pages/Profile").then((m) => ({ default: m.Profile })),
);
const Organizer = lazy(() => import("./pages/Organizer"));

const navItems = [
  { path: "/", label: "Home", icon: House },
  { path: "/events", label: "Events", icon: CalendarBlank },
  { path: "/teams", label: "My teams", icon: UsersThree },
  { path: "/people", label: "Community", icon: Globe },
  { path: "/activity", label: "My activity", icon: Stack },
];
const titles: Record<string, string> = {
  hackathons: "Events",
  events: "Events",
  teams: "Team space",
  people: "Community",
  activity: "My activity",
  profile: "My profile",
  organizer: "Organizer workspace",
};
export default function App() {
  const { theme, toggleTheme } = useTheme();
  const {
    state,
    me,
    run,
    backendMode,
    organizer,
    logout,
    busy,
    startOrganization,
  } = useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const reduce = useReducedMotion();
  const [switcher, setSwitcher] = useState(false);
  const [reset, setReset] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const unread = state.notifications.filter(
    (n) => n.personId === me.id && !n.read,
  ).length;
  const invites = [...state.invitations, ...(state.eventInvitations ?? [])].filter(
    (i) => i.personId === me.id && i.status === "pending",
  ).length;
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main-content")?.scrollTo(0, 0);
    setSearchOpen(false);
    setSearch("");
    document.title = `${titles[location.pathname.split("/")[1]] ?? "Home"} · ${BRAND.name}`;
  }, [location.pathname]);
  const term = search.trim().toLowerCase();
  const events = term
    ? state.events
        .filter(
          (e) =>
            e.status !== "draft" &&
            `${e.title} ${e.theme}`.toLowerCase().includes(term),
        )
        .slice(0, 3)
    : [];
  const people = term
    ? state.people
        .filter((p) =>
          `${p.name} ${p.skills.join(" ")}`.toLowerCase().includes(term),
        )
        .slice(0, 3)
    : [];
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
          document.getElementById("main-content")?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <BrandMark />
          <span className="brand-wordmark">{BRAND.name}</span>
        </NavLink>
        <span className="community-location">Belgrade community</span>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              end={path === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={23} />
              <span>{label}</span>
              {path === "/activity" && invites > 0 && (
                <span className="nav-count">{invites}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="organizer-switch"
            disabled={busy}
            onClick={startOrganization}
          >
            <UsersThree size={20} />
            <span>Organizations</span>
            <ArrowRight size={16} />
          </button>
          <button
            className={`organizer-switch ${state.mode === "organizer" ? "active" : ""}`}
            hidden={backendMode === "firebase" && !organizer}
            disabled={busy}
            onClick={async () => {
              const result = await run(
                {
                  type: "SET_MODE",
                  mode: state.mode === "organizer" ? "attendee" : "organizer",
                },
                true,
              );
              if (!result.error)
                navigate(
                  result.state.mode === "organizer" ? "/organizer" : "/",
                );
            }}
          >
            <Sliders size={20} />
            <span>
              {state.mode === "organizer"
                ? "Attendee view"
                : "Organizer workspace"}
            </span>
            <ArrowRight size={16} />
          </button>
          <button className="demo-label" onClick={() => setSwitcher(true)}>
            <span className="demo-light" />
            {backendMode === "demo" ? "Shared demo" : "Account settings"}
            <Sliders size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div className="header-breadcrumb">
            <span>{BRAND.name}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{titles[location.pathname.split("/")[1]] ?? "Home"}</strong>
          </div>
          <NavLink to="/" className="brand mobile-brand">
            <BrandMark />
            <span className="brand-wordmark">{BRAND.name}</span>
          </NavLink>
          <div className="header-actions">
            <GuidedTour />
            <IconButton
              label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={toggleTheme}
              className="theme-toggle"
            >
              {theme === "dark" ? <Sun size={21} /> : <Moon size={21} />}
            </IconButton>
            <div className="global-search">
              <MagnifyingGlass size={19} />
              <input
                aria-label="Search all events and people"
                placeholder="Search anything"
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                  if (e.key === "Enter" && term) {
                    navigate(`/events?q=${encodeURIComponent(search)}`);
                    setSearchOpen(false);
                  }
                }}
              />
              <kbd aria-hidden="true">↵</kbd>
              {searchOpen && term && (
                <>
                  <button
                    className="search-backdrop"
                    aria-label="Close search results"
                    onClick={() => setSearchOpen(false)}
                  />
                  <div className="global-results">
                    <span className="results-caption">Events</span>
                    {events.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => navigate(`/events/${e.id}`)}
                      >
                        <CalendarBlank size={19} />
                        <span>{e.title}</span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                    {!events.length && <p>No matching events</p>}
                    <span className="results-caption">People</span>
                    {people.map((p) => (
                      <button
                        key={p.id}
                        onClick={() =>
                          navigate(`/people?q=${encodeURIComponent(p.name)}`)
                        }
                      >
                        <Avatar person={p} size={28} />
                        <span>{p.name}</span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                    {!people.length && <p>No matching people</p>}
                  </div>
                </>
              )}
            </div>
            <div className="notification-button">
              <IconButton
                label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                onClick={() => setNotifications(true)}
              >
                <Bell size={23} />
              </IconButton>
              {unread > 0 && <span className="notification-dot" />}
            </div>
            <button
              className="account-button"
              aria-label={
                backendMode === "demo"
                  ? "Open demo controls"
                  : "Open account settings"
              }
              onClick={() => setSwitcher(true)}
            >
              <Avatar person={me} size={36} />
              <span>{me.name.split(" ")[0]}</span>
              <CaretDown size={14} />
            </button>
          </div>
        </header>
        {state.mode === "organizer" && (
          <div className="organizer-mode-bar">
            <span>
              <Sliders size={17} />
              Organizer view
            </span>
            <button onClick={() => navigate("/organizer")}>
              Manage events <ArrowRight size={16} />
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                const result = await run(
                  { type: "SET_MODE", mode: "attendee" },
                  true,
                );
                if (!result.error) navigate("/");
              }}
            >
              Attend events
            </button>
          </div>
        )}
        <main id="main-content" tabIndex={-1} className="main-content">
          <motion.div
            key={`${location.pathname}-${me.id}`}
            initial={reduce ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/hackathons" element={<Hackathons />} />
                <Route path="/hackathons/:id" element={<HackathonDetail />} />
                <Route path="/events" element={<Hackathons />} />
                <Route path="/events/:id" element={<HackathonDetail />} />
                <Route path="/teams" element={<Teams />} />
                <Route path="/teams/:id" element={<TeamDetail />} />
                <Route path="/people" element={<People />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/organizer" element={<Organizer />} />
                <Route
                  path="*"
                  element={
                    <Empty
                      title="Let's get you back to your people"
                      description={`This page isn't part of ${BRAND.name}. Your community is one click away.`}
                      action={
                        <Button onClick={() => navigate("/")}>
                          Back to home
                        </Button>
                      }
                    />
                  }
                />
              </Routes>
            </Suspense>
          </motion.div>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span>
              <Icon size={23} />
              {path === "/activity" && invites > 0 && <i />}
            </span>
            <small>
              {label === "My activity"
                ? "Activity"
                : label === "My teams"
                  ? "Teams"
                  : label}
            </small>
          </NavLink>
        ))}
      </nav>
      {switcher && (
        <Modal
          title="Make yourself at home"
          description={
            backendMode === "demo"
              ? `Explore every side of ${BRAND.name} with fictional people. Changes are shared with other demo sessions.`
              : "Your profile and event updates are shared with your community."
          }
          onClose={() => setSwitcher(false)}
          footer={
            <>
              <Button
                variant="text"
                disabled={backendMode !== "demo" || !organizer}
                icon={<ArrowCounterClockwise size={17} />}
                onClick={() => {
                  setSwitcher(false);
                  setReset(true);
                }}
              >
                Reset demo
              </Button>
              {backendMode === "firebase" && (
                <Button variant="text" onClick={() => void logout()}>
                  Sign out
                </Button>
              )}
              <Button onClick={() => setSwitcher(false)}>Done</Button>
            </>
          }
        >
          <div className="demo-controls">
            <div className="mode-picker">
              <button
                disabled={busy}
                onClick={() => {
                  setSwitcher(false);
                  startOrganization();
                }}
              >
                <UsersThree size={24} />
                <span>
                  <strong>Organizations</strong>
                  <small>Create or join a hosting team</small>
                </span>
                <ArrowRight size={20} />
              </button>
              <button
                className={state.mode === "attendee" ? "selected" : ""}
                disabled={busy}
                onClick={async () => {
                  const result = await run(
                    { type: "SET_MODE", mode: "attendee" },
                    true,
                  );
                  if (!result.error) navigate("/");
                }}
              >
                <UserCircle size={24} />
                <span>
                  <strong>Attendee</strong>
                  <small>Find events and teammates</small>
                </span>
                {state.mode === "attendee" && <Check size={20} />}
              </button>
              <button
                className={state.mode === "organizer" ? "selected" : ""}
                hidden={backendMode === "firebase" && !organizer}
                disabled={busy}
                onClick={async () => {
                  const result = await run(
                    { type: "SET_MODE", mode: "organizer" },
                    true,
                  );
                  if (!result.error) navigate("/organizer");
                }}
              >
                <Sliders size={24} />
                <span>
                  <strong>Organizer</strong>
                  <small>Host and review applications</small>
                </span>
                {state.mode === "organizer" && <Check size={20} />}
              </button>
            </div>
            {backendMode === "demo" && (
              <label className="field">
                <span>View as a demo person</span>
                <select
                  aria-label="Demo person"
                  disabled={busy}
                  value={me.id}
                  onChange={(e) =>
                    run({ type: "SET_PERSON", personId: e.target.value }, true)
                  }
                >
                  {state.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.title}
                    </option>
                  ))}
                </select>
                <small>
                  Switch to an invitee to accept an invitation, then to an
                  organizer to approve attendance.
                </small>
              </label>
            )}
            <button
              className="profile-settings-link"
              onClick={() => {
                setSwitcher(false);
                navigate("/profile");
              }}
            >
              <Avatar person={me} />
              <span>
                <strong>Your profile</strong>
                <small>Edit your skills and interests</small>
              </span>
              <ArrowRight size={20} />
            </button>
          </div>
        </Modal>
      )}
      {reset && (
        <Modal
          title="Start a fresh demo?"
          description="This resets the shared demo for everyone, including invitations, profiles and events. The original fictional data will return."
          onClose={() => setReset(false)}
          footer={
            <>
              <Button variant="text" onClick={() => setReset(false)}>
                Keep exploring
              </Button>
              <Button
                onClick={async () => {
                  for (const key of Object.keys(localStorage))
                    if (
                      key.startsWith("gevents-saved-") ||
                      key.startsWith("gdev-saved-")
                    )
                      localStorage.removeItem(key);
                  const result = await run({ type: "RESET" });
                  if (result.error) return;
                  setReset(false);
                  navigate("/");
                }}
              >
                Reset demo
              </Button>
            </>
          }
        >
          <div className="reset-art">
            <BrandMark large />
          </div>
        </Modal>
      )}
      {notifications && (
        <Modal
          title="A little news for you"
          onClose={() => setNotifications(false)}
          footer={
            <>
              <Button
                variant="text"
                onClick={() =>
                  run({ type: "MARK_NOTIFICATIONS_READ", personId: me.id })
                }
              >
                Mark all as read
              </Button>
              <Button onClick={() => setNotifications(false)}>Done</Button>
            </>
          }
        >
          <div className="notification-list">
            {state.notifications
              .filter((n) => n.personId === me.id)
              .map((n) => (
                <button
                  className={n.read ? "" : "unread"}
                  key={n.id}
                  onClick={() => {
                    run(
                      { type: "MARK_NOTIFICATIONS_READ", personId: me.id },
                      true,
                    );
                    setNotifications(false);
                    navigate(n.href);
                  }}
                >
                  <span className="notification-symbol">
                    <Bell size={20} />
                  </span>
                  <span>
                    <strong>{n.title}</strong>
                    <small>{n.body}</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
            {!state.notifications.some((n) => n.personId === me.id) && (
              <Empty
                title="All quiet for now"
                description="Team invitations and event decisions will appear here."
              />
            )}
          </div>
        </Modal>
      )}
      {searchOpen && term && (
        <button
          className="sr-only"
          onClick={() => {
            setSearch("");
            setSearchOpen(false);
          }}
        >
          <X />
          Clear global search
        </button>
      )}
    </div>
  );
}
