import { useState } from "react";
import {
  ArrowRight,
  FilePdf,
  GithubLogo,
  GraduationCap,
  LinkedinLogo,
  MapPin,
  PencilSimple,
  Sparkle,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useDemo } from "../store";
import { isPastTeam } from "../domain";
import {
  Avatar,
  Badge,
  Button,
  Field,
  Modal,
  PageTitle,
  SectionTitle,
  submitHandler,
} from "../components/ui";
import type { Person, Role } from "../types";
import { eventKinds, goals, levels, formats } from "../discovery";
import type { EventKind, Goal, EventFormat, Level } from "../types";
import "../discovery.css";
import { downloadCv } from "../backend";
import { toast } from "sonner";
import { CvMatchingReview } from "../components/MatchingControls";

const roles: Role[] = ["Participant", "Mentor", "Speaker", "Judge"];
const list = (value: string) => [
  ...new Set(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
type ImportPreview = {
  source: "Sample CV" | "LinkedIn" | "Kaggle";
  changes: Partial<Person>;
};
const fieldNames: Record<string, string> = {
  title: "Headline",
  bio: "About you",
  skills: "Skills",
  experience: "Experience",
  interests: "Interests",
  linkedin: "LinkedIn link",
  kaggle: "Kaggle link",
  cv: "CV filename",
};
const displayValue = (value: unknown) =>
  Array.isArray(value) ? value.join(", ") : String(value || "Not added yet");

export function Profile() {
  const { me } = useDemo();
  return <ProfileContent key={me.id} />;
}

function ProfileContent() {
  const { me, state, run, saveCv, busy, backendMode } = useDemo();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [downloading, setDownloading] = useState(false);
  async function download() {
    setDownloading(true);
    try {
      const blob = await downloadCv();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = me.cv_document?.filename ?? "cv.pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDownloading(false);
    }
  }
  const connections = state.connections.filter((connection) =>
    connection.split(":").includes(me.id),
  ).length;
  const profileTeams = state.teams.filter(
    (t) => !isPastTeam(state, t) && t.memberIds.includes(me.id),
  );

  function makePreview(source: ImportPreview["source"]) {
    if (source === "Sample CV")
      setPreview({
        source,
        changes: {
          cv: "gevents-fictional-sample-cv.pdf",
          bio: "Fictional sample: I enjoy building thoughtful community tools and learning with people from different backgrounds.",
          skills: list(
            [...me.skills, "Collaboration", "Prototyping"].join(","),
          ),
          experience: `${me.experience} Fictional sample: contributed to a community event prototype.`,
        },
      });
    if (source === "LinkedIn")
      setPreview({
        source,
        changes: {
          title: "Community-minded builder · fictional sample",
          experience:
            "Fictional sample: three years building web products, mentoring peers, and volunteering at local meetups.",
          skills: list(
            [...me.skills, "Project planning", "Teamwork"].join(","),
          ),
          linkedin: "https://example.com/fictional-linkedin-profile",
        },
      });
    if (source === "Kaggle")
      setPreview({
        source,
        changes: {
          skills: list(
            [...me.skills, "Python", "Data visualization"].join(","),
          ),
          interests: list(
            [...me.interests, "Open data", "Machine learning"].join(","),
          ),
          kaggle: "https://example.com/fictional-kaggle-profile",
        },
      });
  }

  return (
    <>
      {me.cv_document && <CvMatchingReview />}
      <PageTitle
        title="Your profile."
        description="Show your skills, interests and next steps."
        action={
          <Button
            icon={<PencilSimple size={18} />}
            onClick={() => setEditing(true)}
          >
            Edit profile
          </Button>
        }
      />
      <div className="profile-layout">
        <section className="panel own-profile">
          <div className={`profile-cover cover-${me.color}`}>
            <span className="cover-circle" />
            <span className="cover-pill" />
            <span className="cover-triangle" />
          </div>
          <div className="person-profile-header">
            <Avatar person={me} size={88} />
            <div>
              <h2>{me.name}</h2>
              <p>{me.title}</p>
            </div>
            <Badge color={me.lookingForTeam ? "green" : "blue"} dot>
              {me.lookingForTeam ? "Open to a team" : "Happy to connect"}
            </Badge>
          </div>
          <div className="profile-body">
            <div className="profile-meta">
              <span>
                <MapPin size={17} />
                {me.city || "City not added"}
              </span>
              <span>
                <GraduationCap size={18} />
                {me.school || "School or organization not added"}
              </span>
            </div>
            <p className="profile-bio">
              {me.bio ||
                "Add a few words about yourself so your next teammates can get to know you."}
            </p>
            <div data-tour="profile-fit">
              <h3 className="detail-label">What I bring</h3>
              <div className="skill-list">
                {me.skills.length ? (
                  me.skills.map((skill) => <span key={skill}>{skill}</span>)
                ) : (
                  <p className="muted">
                    Add your skills when you edit your profile.
                  </p>
                )}
              </div>
              {!!me.learningSkills?.length && (
                <>
                  <h3 className="detail-label">What I want to learn</h3>
                  <div className="skill-list">
                    {me.learningSkills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
            <h3 className="detail-label">My experience</h3>
            <p className="profile-experience">
              {me.experience ||
                "Everyone starts somewhere. Share what you’ve tried so far."}
            </p>
            <div data-tour="profile-roles">
              <h3 className="detail-label">Happy to join as</h3>
              <div className="skill-list">
                {me.roles.map((role) => (
                  <Badge color="blue" key={role}>
                    {role}
                  </Badge>
                ))}
              </div>
            </div>
            <h3 className="detail-label">Things I’m curious about</h3>
            <div className="skill-list">
              {me.interests.length ? (
                me.interests.map((interest) => (
                  <span key={interest}>{interest}</span>
                ))
              ) : (
                <p className="muted">Add the topics you’d like to explore.</p>
              )}
            </div>
            <h3 className="detail-label">My next step</h3>
            <p>
              {me.preferences?.goals.join(" · ") ||
                "Add goals in Edit profile to personalize event discovery."}
            </p>
            <p className="muted">
              Event recommendations:{" "}
              {me.preferences?.notify
                ? "notifications enabled"
                : "notifications off"}
              . Your discovery preferences are private.
            </p>
            <div className="profile-links">
              {me.linkedin && (
                <div>
                  <LinkedinLogo size={20} />
                  <span>
                    <strong>LinkedIn</strong>
                    <span className="profile-link-value">{me.linkedin}</span>
                  </span>
                </div>
              )}
              {me.kaggle && (
                <div>
                  <GithubLogo size={20} />
                  <span>
                    <strong>Kaggle</strong>
                    <span className="profile-link-value">{me.kaggle}</span>
                  </span>
                </div>
              )}
              {!me.linkedin && !me.kaggle && (
                <p className="muted">
                  You can add LinkedIn and Kaggle links in Edit profile.
                </p>
              )}
            </div>
          </div>
        </section>
        <aside className="profile-aside">
          <section className="panel profile-community">
            <SectionTitle title="Your community" />
            <div className="profile-community-stats">
              <div>
                <strong>{connections}</strong>
                <span>Connections</span>
              </div>
              <div>
                <strong>{profileTeams.length}</strong>
                <span>Current teams</span>
              </div>
            </div>
            <Button
              variant="text"
              icon={<ArrowRight size={17} />}
              onClick={() => navigate("/people")}
            >
              Meet more people
            </Button>
          </section>
          <section className="panel cv-panel">
            <SectionTitle title="Your CV" />
            <p className="muted">
              Upload your CV privately. You can replace or remove it anytime.
            </p>
            {me.cv && (
              <div className="cv-file">
                <FilePdf size={27} />
                <span>
                  <strong>{me.cv}</strong>
                  <small>
                    {me.cv_document
                      ? `${Math.ceil(me.cv_document.size_bytes / 1024)} KB · Private PDF`
                      : "Filename only · upload to store the file"}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label="Remove CV attachment"
                  disabled={busy}
                  onClick={() => void saveCv(null)}
                >
                  <Trash size={19} />
                </button>
              </div>
            )}
            <Field
              label={me.cv ? "Replace CV attachment" : "Attach a CV"}
              hint="PDF, up to 5 MB. Only you can download the file."
            >
              <input
                aria-label="Attach CV file"
                type="file"
                accept=".pdf,application/pdf"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void saveCv(file);
                  event.target.value = "";
                }}
              />
            </Field>
            {me.cv_document && (
              <Button
                variant="text"
                disabled={downloading || busy}
                onClick={() => void download()}
              >
                {downloading ? "Downloading…" : "Download your CV"}
              </Button>
            )}
            {me.cv_document && (
              <p className="muted">
                {me.cv_document.extraction_status === "not_started"
                  ? "Your CV is saved. Choose Extract current CV, then review the proposed fields."
                  : `Extraction: ${me.cv_document.extraction_status}`}
              </p>
            )}
            {backendMode === "demo" && !me.cv_document && (
              <Button
                variant="text"
                icon={<FilePdf size={18} />}
                onClick={() => makePreview("Sample CV")}
              >
                Preview sample CV data
              </Button>
            )}
          </section>
          {backendMode === "demo" && (
            <details className="panel import-panel">
              <summary>Sample profile imports</summary>
              <p>
                Review fictional LinkedIn or Kaggle data before applying it.
              </p>
              <div className="import-actions">
                <Button
                  variant="outlined"
                  icon={<LinkedinLogo size={18} />}
                  onClick={() => makePreview("LinkedIn")}
                >
                  Preview LinkedIn sample
                </Button>
                <Button
                  variant="outlined"
                  icon={<UploadSimple size={18} />}
                  onClick={() => makePreview("Kaggle")}
                >
                  Preview Kaggle sample
                </Button>
              </div>
            </details>
          )}
        </aside>
      </div>

      {editing && <ProfileEdit onClose={() => setEditing(false)} />}
      {preview && (
        <Modal
          title={`Review ${preview.source} sample`}
          description="Fictional preview only. Your profile will change only when you choose Apply sample changes. Existing fields not shown here will be kept."
          wide
          onClose={() => setPreview(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setPreview(null)}>
                Keep my profile
              </Button>
              <Button
                icon={<Sparkle size={18} />}
                onClick={async () => {
                  const result = await run({
                    type: "UPDATE_PROFILE",
                    personId: me.id,
                    changes: preview.changes,
                  });
                  if (!result.error) setPreview(null);
                }}
              >
                Apply sample changes
              </Button>
            </>
          }
        >
          <Badge color="yellow">Fictional data · no account connection</Badge>
          <div className="import-diff">
            {Object.entries(preview.changes).map(([key, proposed]) => (
              <div className="import-diff-row" key={key}>
                <h3>{fieldNames[key] ?? key}</h3>
                <div className="import-diff-values">
                  <div>
                    <small>Current</small>
                    <p>{displayValue(me[key as keyof Person])}</p>
                  </div>
                  <div>
                    <small>Proposed sample</small>
                    <p>{displayValue(proposed)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function ProfileEdit({ onClose }: { onClose: () => void }) {
  const { me, run } = useDemo();
  const [chosenRoles, setChosenRoles] = useState<Role[]>(me.roles);
  const [birthDate, setBirthDate] = useState(me.birth_date ?? "");
  const [birthYear, setBirthYear] = useState(String(me.birth_year ?? ""));
  return (
    <Modal
      title="Make your profile yours"
      description="A few useful details help your next teammates find you."
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button form="profile-edit-form" disabled={!chosenRoles.length}>
            Save profile
          </Button>
        </>
      }
    >
      <form
        id="profile-edit-form"
        className="form-stack"
        onSubmit={submitHandler(async (data) => {
          const result = await run({
            type: "UPDATE_PROFILE",
            personId: me.id,
            changes: {
              ...(String(data.get("first_name") ?? "").trim()
                ? { first_name: String(data.get("first_name")).trim() }
                : {}),
              ...(String(data.get("last_name") ?? "").trim()
                ? { last_name: String(data.get("last_name")).trim() }
                : {}),
              phone: String(data.get("phone") ?? "").trim(),
              country: String(data.get("country") ?? "").trim(),
              birth_date: String(data.get("birth_date") ?? "") || null,
              learningSkills: list(String(data.get("learningSkills") ?? "")),
              languages: list(String(data.get("languages") ?? "")),
              status: (String(data.get("status") || "") ||
                null) as Person["status"],
              birth_year: data.get("birth_date")
                ? Number(String(data.get("birth_date")).slice(0, 4))
                : data.get("birth_year")
                  ? Number(data.get("birth_year"))
                  : null,
              experience_level: (String(data.get("experience_level") || "") ||
                null) as Person["experience_level"],
              title: String(data.get("title")).trim(),
              city: String(data.get("city")).trim(),
              school: String(data.get("school")).trim(),
              bio: String(data.get("bio")).trim(),
              experience: String(data.get("experience")).trim(),
              skills: list(String(data.get("skills"))),
              interests: list(String(data.get("interests"))),
              roles: chosenRoles,
              lookingForTeam: data.get("lookingForTeam") === "on",
              linkedin: String(data.get("linkedin")).trim(),
              kaggle: String(data.get("kaggle")).trim(),
              preferences: {
                goals: data.getAll("goals") as Goal[],
                kinds: data.getAll("kinds") as EventKind[],
                formats: data.getAll("formats") as EventFormat[],
                location: String(data.get("preferredLocation") ?? "").trim(),
                ...(data.get("level")
                  ? { level: data.get("level") as Level }
                  : {}),
                maxPrice:
                  data.get("maxPrice") === ""
                    ? null
                    : {
                        amount: Number(data.get("maxPrice")),
                        currency: String(data.get("budgetCurrency") || "EUR")
                          .trim()
                          .toUpperCase(),
                      },
                notify: data.get("notify") === "on",
              },
            },
          });
          if (!result.error) onClose();
        })}
      >
        <div className="form-grid">
          <Field label="First name">
            <input
              name="first_name"
              autoComplete="given-name"
              required
              maxLength={100}
              defaultValue={me.first_name ?? ""}
            />
          </Field>
          <Field label="Last name">
            <input
              name="last_name"
              autoComplete="family-name"
              required
              maxLength={100}
              defaultValue={me.last_name ?? ""}
            />
          </Field>
          <Field
            label="Account email"
            hint="From your sign-in account; private."
          >
            <input type="email" value={me.email ?? ""} readOnly />
          </Field>
          <Field label="Phone" hint="Optional and private.">
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={50}
              defaultValue={me.phone ?? ""}
            />
          </Field>
          <Field label="Country" hint="Optional; helps match event locations.">
            <input
              name="country"
              maxLength={100}
              defaultValue={me.country ?? ""}
              autoComplete="country-name"
            />
          </Field>
          <Field
            label="Exact birth date"
            hint="Optional and private. Resolves age requirements around your birthday."
          >
            <input
              name="birth_date"
              type="date"
              min="1900-01-01"
              max={new Date().toISOString().slice(0, 10)}
              value={birthDate}
              onChange={(e) => {
                setBirthDate(e.target.value);
                if (e.target.value) setBirthYear(e.target.value.slice(0, 4));
              }}
            />
          </Field>
          <Field label="Birth year">
            <input
              name="birth_year"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              value={birthYear}
              onChange={(e) => {
                setBirthYear(e.target.value);
                if (birthDate && birthDate.slice(0, 4) !== e.target.value)
                  setBirthDate("");
              }}
            />
          </Field>
          <Field label="Current status">
            <select name="status" defaultValue={me.status ?? ""}>
              <option value="">Not specified</option>
              {["Student", "Employed", "Freelancer"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Professional experience level">
            <select
              name="experience_level"
              defaultValue={me.experience_level ?? ""}
            >
              <option value="">Not specified</option>
              {["Junior", "Mid", "Senior"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Headline">
            <input
              name="title"
              maxLength={100}
              defaultValue={me.title}
              placeholder="e.g. Frontend developer"
            />
          </Field>
          <Field label="City">
            <input name="city" maxLength={80} defaultValue={me.city} />
          </Field>
          <Field label="School or organization">
            <input name="school" maxLength={120} defaultValue={me.school} />
          </Field>
        </div>
        <Field label="Languages" hint="Separate languages with commas.">
          <input
            name="languages"
            maxLength={400}
            defaultValue={(me.languages ?? []).join(", ")}
          />
        </Field>
        <Field label="About you">
          <textarea
            name="bio"
            rows={3}
            maxLength={1000}
            defaultValue={me.bio}
          />
        </Field>
        <Field label="Skills" hint="Separate skills with commas.">
          <input
            name="skills"
            maxLength={400}
            defaultValue={me.skills.join(", ")}
            placeholder="React, Python, design"
          />
        </Field>
        <Field
          label="Experience"
          hint="Projects, volunteering and first experiments all count."
        >
          <textarea
            name="experience"
            rows={3}
            maxLength={1000}
            defaultValue={me.experience}
          />
        </Field>
        <Field
          label="Skills you want to learn"
          hint="Optional. Separate skills with commas."
        >
          <input
            name="learningSkills"
            maxLength={400}
            defaultValue={(me.learningSkills ?? []).join(", ")}
          />
        </Field>
        <Field label="Interests" hint="Separate topics with commas.">
          <input
            name="interests"
            maxLength={400}
            defaultValue={me.interests.join(", ")}
          />
        </Field>
        <fieldset className="discovery-preferences">
          <legend>Events for your next step</legend>
          <p className="form-note">
            Choose what you want to get out of events. These preferences are
            private.
          </p>
          <div className="form-grid">
            <Field
              label="Maximum event budget"
              hint="Optional. Leave blank for no budget preference; zero means free events."
            >
              <input
                name="maxPrice"
                type="number"
                min="0"
                step="0.01"
                defaultValue={me.preferences?.maxPrice?.amount ?? ""}
              />
            </Field>
            <Field label="Budget currency">
              <input
                name="budgetCurrency"
                minLength={3}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                defaultValue={me.preferences?.maxPrice?.currency ?? "EUR"}
              />
            </Field>
          </div>
          <h3 className="detail-label">Goals</h3>
          <div className="role-checkboxes">
            {goals.map((goal) => (
              <label key={goal}>
                <input
                  type="checkbox"
                  name="goals"
                  value={goal}
                  defaultChecked={me.preferences?.goals.includes(goal)}
                />
                <span>{goal}</span>
              </label>
            ))}
          </div>
          <h3 className="detail-label">Event types</h3>
          <div className="role-checkboxes">
            {eventKinds.map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  name="kinds"
                  value={kind}
                  defaultChecked={me.preferences?.kinds.includes(kind)}
                />
                <span>{kind[0].toUpperCase() + kind.slice(1)}</span>
              </label>
            ))}
          </div>
          <h3 className="detail-label">Formats</h3>
          <div className="role-checkboxes">
            {formats.map((format) => (
              <label key={format}>
                <input
                  type="checkbox"
                  name="formats"
                  value={format}
                  defaultChecked={me.preferences?.formats.includes(format)}
                />
                <span>{format}</span>
              </label>
            ))}
          </div>
          <div className="form-grid">
            <Field
              label="Preferred city"
              hint="Leave blank to use your profile city."
            >
              <input
                name="preferredLocation"
                maxLength={200}
                defaultValue={me.preferences?.location ?? ""}
              />
            </Field>
            <Field label="Experience level">
              <select name="level" defaultValue={me.preferences?.level ?? ""}>
                <option value="">Prefer not to say</option>
                {levels.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              name="notify"
              defaultChecked={me.preferences?.notify ?? false}
            />
            <span>Notify me in GEvents when a relevant event is published</span>
          </label>
        </fieldset>
        <fieldset className="profile-role-field">
          <legend>Happy to join as</legend>
          <div className="role-checkboxes">
            {roles.map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={chosenRoles.includes(role)}
                  onChange={(event) =>
                    setChosenRoles(
                      event.target.checked
                        ? [...chosenRoles, role]
                        : chosenRoles.filter((r) => r !== role),
                    )
                  }
                />
                <span>{role}</span>
              </label>
            ))}
          </div>
          {!chosenRoles.length && (
            <p className="field-error" role="status">
              Choose at least one role.
            </p>
          )}
        </fieldset>
        <label className="checkbox-field">
          <input
            name="lookingForTeam"
            type="checkbox"
            defaultChecked={me.lookingForTeam}
          />
          <span>I’m open to joining a team</span>
        </label>
        <div className="form-grid">
          <Field label="LinkedIn URL">
            <input
              name="linkedin"
              type="url"
              defaultValue={me.linkedin}
              placeholder="https://www.linkedin.com/in/your-profile"
            />
          </Field>
          <Field label="Kaggle URL">
            <input
              name="kaggle"
              type="url"
              defaultValue={me.kaggle}
              placeholder="https://www.kaggle.com/your-profile"
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
