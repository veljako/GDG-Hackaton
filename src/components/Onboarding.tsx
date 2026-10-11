import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Person, Education, WorkExperience } from "../types";
import { BRAND } from "../config";
import {
  BackendError,
  getOnboardingDraft,
  saveOnboardingDraft,
  completeOnboarding,
  semanticMatching,
} from "../backend";
import type { Snapshot, SemanticResponse, OnboardingInput } from "../backend";
import { initialReviewedProfile, onboardingMissingFields } from "../onboarding";
import type { ReviewedProfile, OnboardingDraft } from "../onboarding";
import "./onboarding.css";

type Props = {
  person: Person;
  saveCv: (file: File | null) => Promise<boolean>;
  onComplete: (
    snapshot: Snapshot & { matching_sync?: string; message?: string },
  ) => void;
  logout: () => Promise<void>;
};
const steps = ["Account", "Your CV", "Review profile", "Your interests"];
const list = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];
function ListInput({
  values,
  onChange,
  name,
  placeholder,
  invalid,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  name?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(values.join(", "));
  const previous = useRef(values.join(", "));
  useEffect(() => {
    const next = values.join(", ");
    if (next !== previous.current) setText(next);
    previous.current = next;
  }, [values]);
  return (
    <input
      name={name}
      value={text}
      placeholder={placeholder}
      aria-invalid={invalid}
      onChange={(event) => {
        setText(event.target.value);
        const next = list(event.target.value);
        previous.current = next.join(", ");
        onChange(next);
      }}
    />
  );
}
export function Onboarding({ person, saveCv, onComplete, logout }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"cv" | "review" | "interests">("cv");
  const [profile, setProfile] = useState<ReviewedProfile>(() =>
    initialReviewedProfile(person),
  );
  const [budgetCurrency, setBudgetCurrency] = useState(
    person.preferences?.maxPrice?.currency ?? "EUR",
  );
  useEffect(() => {
    if (profile.preferences.maxPrice?.currency)
      setBudgetCurrency(profile.preferences.maxPrice.currency);
  }, [profile.preferences.maxPrice?.currency]);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [source, setSource] = useState<SemanticResponse | null>(null);
  const [busy, setBusy] = useState("Loading your setup…");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const personRef = useRef(person);
  personRef.current = person;
  const operation = useRef(false);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  function fail(cause: unknown) {
    setError((cause as Error).message);
    if (cause instanceof BackendError && cause.status === 409)
      setConflict(true);
  }
  async function extract(active: () => boolean = () => mounted.current) {
    if (!active()) return;
    setBusy("Reading your CV…");
    const result = await semanticMatching("cv/extract");
    if (!result.proposal || !result.extraction_hash)
      throw Error(
        "Your CV could not be read. Retry extraction or replace the document.",
      );
    if (!active()) return;
    setSource(result);
    setConflict(false);
    setError("");
    setDraft(null);
    setProfile(initialReviewedProfile(personRef.current, result.proposal));
    setStep("review");
    setSaved("");
    setMissing([]);
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const stored = await getOnboardingDraft();
        if (cancelled) return;
        if (!personRef.current.cv_document?.storage_path) return;
        if (stored.draft) {
          setDraft(stored.draft);
          setProfile({
            ...initialReviewedProfile(personRef.current),
            ...stored.draft.profile,
          });
          setStep(stored.draft.step);
        }
        let result: SemanticResponse;
        try {
          result = await semanticMatching("cv/proposal");
        } catch (cause) {
          if (cancelled) return;
          if (
            !(cause instanceof BackendError) ||
            !(
              cause.status === 404 ||
              (cause.status === 503 &&
                !stored.draft &&
                personRef.current.cv_document.extraction_status ===
                  "not_started") ||
              (cause.status === 409 &&
                cause.message ===
                  "Extract your current CV before reviewing it.")
            )
          )
            throw cause;
          if (stored.draft)
            throw new BackendError(
              "The saved review no longer matches an available extraction. Your edits are kept here. Replace the CV to start a fresh review.",
              409,
            );
          await extract(() => !cancelled);
          return;
        }
        if (cancelled) return;
        if (!result.proposal || !result.extraction_hash) {
          await extract(() => !cancelled);
          return;
        }
        setSource(result);
        if (
          stored.draft &&
          stored.draft.extraction_hash === result.extraction_hash &&
          stored.draft.cv_path === personRef.current.cv_document.storage_path &&
          stored.draft.expected_profile_updated_at ===
            result.expected_profile_updated_at
        ) {
          setDraft(stored.draft);
          setProfile({
            ...initialReviewedProfile(personRef.current, result.proposal),
            ...stored.draft.profile,
          });
          setStep(stored.draft.step);
          setSaved("Saved setup restored.");
        } else if (stored.draft) {
          setConflict(true);
          setError(
            "Your profile or document changed since this review was saved. Your edits are kept here.",
          );
        } else {
          setProfile(
            initialReviewedProfile(personRef.current, result.proposal),
          );
          setStep("review");
        }
      } catch (cause) {
        if (!cancelled) fail(cause);
      } finally {
        if (!cancelled) setBusy("");
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [person.id]);
  function update<K extends keyof ReviewedProfile>(
    key: K,
    value: ReviewedProfile[K],
  ) {
    setProfile((previous) => ({ ...previous, [key]: value }));
    if (!conflict) setError("");
    setMissing((previous) =>
      previous.filter(
        (field) =>
          field !== key &&
          !(key === "learningSkills" && field === "skills") &&
          !(
            key === "preferences" &&
            ["goals", "kinds", "formats"].includes(field)
          ),
      ),
    );
    setSaved("Changes not saved yet.");
  }
  async function upload(file: File) {
    if (busy || operation.current) return;
    operation.current = true;
    setError("");
    setBusy("Uploading your CV…");
    try {
      if (
        !/\.pdf$/i.test(file.name) ||
        !file.size ||
        file.size > 5 * 1024 * 1024
      )
        throw Error("Choose a PDF up to 5 MiB.");
      if (!(await saveCv(file)))
        throw Error("Your CV could not be uploaded. Try again.");
      if (!mounted.current) return;
      setSource(null);
      setDraft(null);
      setConflict(false);
      await extract();
    } catch (cause) {
      fail(cause);
      setStep("cv");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  function envelope(
    nextStep: "review" | "interests",
    version = draft?.version ?? null,
  ): OnboardingInput {
    if (!source?.extraction_hash)
      throw Error("Read your CV before continuing.");
    return {
      profile,
      step: nextStep,
      expected_extraction_hash: source.extraction_hash,
      expected_profile_updated_at: source.expected_profile_updated_at ?? null,
      expected_draft_version: version,
    };
  }
  async function persist(
    nextStep: "review" | "interests",
    finish = false,
    saveOnly = false,
  ) {
    if (busy || operation.current || conflict) return;
    const labels: Record<string, string> = {
      "First name": "first_name",
      "Last name": "last_name",
      Headline: "title",
      City: "city",
      "About you": "bio",
      Skills: "skills",
      Interests: "interests",
      "Event roles": "roles",
      Goals: "goals",
      "Event types": "kinds",
      "Event formats": "formats",
    };
    const absent = saveOnly
      ? []
      : onboardingMissingFields(profile)
          .map((field) => labels[field] ?? field)
          .filter(
            (field) =>
              finish ||
              ![
                "interests",
                "preferences.goals",
                "preferences.kinds",
                "preferences.formats",
                "roles",
                "goals",
                "kinds",
                "formats",
              ].includes(field),
          );
    setMissing(absent);
    if (absent.length) {
      setError("Complete the highlighted information before continuing.");
      return;
    }
    operation.current = true;
    setBusy(finish ? "Finishing your setup…" : "Saving your review…");
    setError("");
    try {
      const result = await saveOnboardingDraft(envelope(nextStep));
      if (!mounted.current) return;
      setDraft(result.draft);
      setSaved("Your progress is saved.");
      if (finish) {
        const completed = await completeOnboarding(
          envelope(nextStep, result.draft.version),
        );
        if (!mounted.current) return;
        navigate("/", { replace: true });
        onComplete(completed);
      } else if (!saveOnly) setStep(nextStep);
    } catch (cause) {
      fail(cause);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  const field = (
    key: keyof ReviewedProfile,
    label: string,
    multiline = false,
    hint?: string,
  ) => (
    <label className="ob-field" key={key}>
      {label}
      {hint && <small>{hint}</small>}
      {multiline ? (
        <textarea
          name={key}
          value={String(profile[key] ?? "")}
          maxLength={2000}
          onChange={(e) => update(key, e.target.value as never)}
          aria-invalid={missing.includes(key)}
        />
      ) : (
        <input
          name={key}
          value={String(profile[key] ?? "")}
          maxLength={key === "bio" ? 2000 : 200}
          onChange={(e) => update(key, e.target.value as never)}
          aria-invalid={missing.includes(key)}
        />
      )}
      {missing.includes(key) && (
        <small className="ob-invalid">Add {label.toLowerCase()}.</small>
      )}
    </label>
  );
  const records = (key: "education" | "work_experience", title: string) => {
    const entries = (profile[key] ?? []) as (Education | WorkExperience)[];
    const keys =
      key === "education"
        ? [
            "institution",
            "degree",
            "field",
            "start_date",
            "end_date",
            "description",
          ]
        : [
            "company",
            "position",
            "location",
            "start_date",
            "end_date",
            "description",
          ];
    return (
      <fieldset className="ob-records">
        <legend>
          {title} <span>Optional</span>
        </legend>
        {entries.map((record, index) => (
          <div className="ob-record" key={index}>
            <div className="ob-grid">
              {keys.map((property) => (
                <label className="ob-field" key={property}>
                  {property.replace(/_/g, " ")}
                  <input
                    type={property.endsWith("date") ? "month" : "text"}
                    value={String(
                      (record as unknown as Record<string, unknown>)[
                        property
                      ] ?? "",
                    )}
                    maxLength={property === "description" ? 2000 : 200}
                    onChange={(e) =>
                      update(
                        key,
                        entries.map((entry, i) =>
                          i === index
                            ? {
                                ...entry,
                                [property]:
                                  e.target.value ||
                                  (property.endsWith("date") ? null : ""),
                              }
                            : entry,
                        ) as never,
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              className="ob-link"
              onClick={() =>
                update(key, entries.filter((_, i) => i !== index) as never)
              }
            >
              Remove entry {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ob-secondary"
          onClick={() =>
            update(key, [
              ...entries,
              Object.fromEntries(
                keys.map((property) => [
                  property,
                  property.endsWith("date") ? null : "",
                ]),
              ),
            ] as never)
          }
        >
          Add {key === "education" ? "education" : "experience"}
        </button>
        <p className="ob-hint">
          No past {key === "education" ? "studies" : "jobs"}? Leave this empty.
        </p>
      </fieldset>
    );
  };
  const choices = (
    key: "goals" | "kinds" | "formats" | "roles",
    label: string,
    options: string[],
  ) => {
    const selected =
      key === "roles" ? profile.roles : (profile.preferences?.[key] ?? []);
    return (
      <fieldset className="ob-choices">
        <legend>{label}</legend>
        <div>
          {options.map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={(selected as string[]).includes(option)}
              onClick={() => {
                const values = (selected as string[]).includes(option)
                  ? (selected as string[]).filter((value) => value !== option)
                  : [...selected, option];
                if (key === "roles") update("roles", values as never);
                else
                  update("preferences", {
                    ...profile.preferences,
                    [key]: values,
                  } as never);
              }}
            >
              {option}
            </button>
          ))}
        </div>
        {missing.some(
          (value) => value === key || value === `preferences.${key}`,
        ) && <small className="ob-invalid">Choose at least one.</small>}
      </fieldset>
    );
  };
  return (
    <main className="ob-shell">
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
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={
                index === (step === "cv" ? 1 : step === "review" ? 2 : 3)
                  ? "step"
                  : undefined
              }
            >
              <span>{index === 0 ? "✓" : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="ob-art" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <button
          className="ob-link"
          disabled={!!busy}
          onClick={() => void logout()}
        >
          Sign out and resume later
        </button>
      </aside>
      <section className="ob-panel" aria-busy={!!busy}>
        <h2 ref={heading} tabIndex={-1}>
          {step === "cv"
            ? "Bring your background"
            : step === "review"
              ? "Make this profile yours"
              : "What brings you here?"}
        </h2>
        <p className="ob-lede">
          {step === "cv"
            ? "Upload a CV, resume or a PDF summary of your studies, projects and skills. You don’t need a formal work history."
            : step === "review"
              ? "We read your CV. Check the suggestions, correct anything and fill the gaps. Nothing reaches matching until you finish."
              : "Tell us what you want to explore and how you’d like to join in."}
        </p>
        {error && (
          <div className="ob-error" role="alert">
            {error}
            {conflict && (
              <p>
                Your edits remain here. The source changed; replace the document
                to start a fresh review. Copy any edits you want to keep first.
              </p>
            )}
          </div>
        )}
        {busy && (
          <p className="ob-status" role="status">
            <span className="ob-spinner" />
            {busy}
          </p>
        )}
        {step === "cv" ? (
          <>
            <div
              className={`ob-drop ${dragging ? "is-dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void upload(file);
              }}
            >
              <span className="ob-document" aria-hidden="true">
                ↑
              </span>
              <h3>
                {person.cv_document?.filename || "Your story starts here"}
              </h3>
              <p>PDF · up to 5 MiB · up to 20 pages</p>
              <input
                ref={input}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
              <button
                className="ob-primary"
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                {person.cv_document ? "Replace document" : "Choose PDF"}
              </button>
              <p className="ob-hint">Or drag a PDF into this area.</p>
            </div>
            {person.cv_document && (
              <button
                className="ob-secondary"
                disabled={!!busy}
                onClick={() => {
                  setError("");
                  setBusy("Reading your CV…");
                  void extract()
                    .catch(fail)
                    .finally(() => setBusy(""));
                }}
              >
                Retry extraction
              </button>
            )}
            <p className="ob-hint">
              Your document is private. Only the profile you approve is used for
              matching.
            </p>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void persist("interests", step === "interests");
            }}
          >
            <fieldset disabled={!!busy} className="ob-form-body">
              {step === "review" ? (
                <>
                  <h3>About you</h3>
                  <div className="ob-grid">
                    {field("first_name", "First name")}
                    {field("last_name", "Last name")}
                    {field(
                      "title",
                      "Headline or current role",
                      false,
                      "A student or project role works too.",
                    )}
                    {field("city", "City or location")}
                    {field(
                      "country",
                      "Country",
                      false,
                      "Optional; helps match event locations.",
                    )}
                  </div>
                  <label className="ob-field">
                    Account email
                    <input value={person.email ?? ""} readOnly />
                  </label>
                  {field(
                    "bio",
                    "Short description",
                    true,
                    "What are you studying, building or curious about?",
                  )}
                  <div className="ob-grid">
                    {(
                      [
                        [
                          "status",
                          "Current status",
                          ["Student", "Employed", "Freelancer"],
                        ],
                        [
                          "experience_level",
                          "Experience level",
                          ["Junior", "Mid", "Senior"],
                        ],
                      ] as const
                    ).map(([key, label, options]) => (
                      <label className="ob-field" key={key}>
                        {label}
                        <select
                          value={profile[key] ?? ""}
                          onChange={(e) =>
                            update(key, (e.target.value || null) as never)
                          }
                        >
                          <option value="">Unknown / not provided</option>
                          {options.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <label className="ob-field">
                      Birth year
                      <input
                        type="number"
                        min="1900"
                        max={new Date().getFullYear()}
                        value={profile.birth_year ?? ""}
                        onChange={(e) => {
                          update(
                            "birth_year",
                            e.target.value ? Number(e.target.value) : null,
                          );
                          if (
                            profile.birth_date &&
                            Number(profile.birth_date.slice(0, 4)) !==
                              Number(e.target.value)
                          )
                            update("birth_date", null);
                        }}
                      />
                      <small>
                        Leave empty if you prefer not to provide it.
                      </small>
                    </label>
                    <label className="ob-field">
                      Exact birth date
                      <input
                        name="birth_date"
                        type="date"
                        min="1900-01-01"
                        max={new Date().toISOString().slice(0, 10)}
                        value={profile.birth_date ?? ""}
                        onChange={(e) => {
                          update("birth_date", e.target.value || null);
                          if (e.target.value)
                            update(
                              "birth_year",
                              Number(e.target.value.slice(0, 4)),
                            );
                        }}
                      />
                      <small>
                        Optional and private. Resolves age requirements around
                        your birthday.
                      </small>
                    </label>
                    {field("school", "School or organization")}
                  </div>
                  <p className="ob-hint">
                    Unknown eligibility information may prevent matches with
                    events that have corresponding restrictions.
                  </p>
                  <h3>Skills</h3>
                  <label className="ob-field">
                    Skills, separated by commas
                    <ListInput
                      name="skills"
                      values={profile.skills}
                      onChange={(values) => update("skills", values)}
                      invalid={missing.includes("skills")}
                    />
                    <small>
                      Skills you already use. New to this? Add a skill you want
                      to learn below instead.
                    </small>
                    {missing.includes("skills") && (
                      <small className="ob-invalid">
                        Add a skill you have or want to learn.
                      </small>
                    )}
                  </label>
                  <label className="ob-field">
                    Skills you want to learn
                    <ListInput
                      name="learningSkills"
                      values={profile.learningSkills ?? []}
                      onChange={(values) => update("learningSkills", values)}
                      placeholder="Python, public speaking…"
                    />
                    <small>
                      You can start with learning goals and no existing skills.
                    </small>
                  </label>
                  <div className="ob-chips">
                    {profile.skills.map((skill) => (
                      <span key={skill}>
                        {skill}
                        <button
                          type="button"
                          aria-label={`Remove ${skill}`}
                          onClick={() =>
                            update(
                              "skills",
                              profile.skills.filter((value) => value !== skill),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {records("education", "Education")}
                  {records("work_experience", "Experience")}
                  <details className="ob-optional">
                    <summary>Contact, languages and profile links</summary>
                    <div className="ob-grid">
                      {field("phone", "Phone")}
                      {field("linkedin", "LinkedIn link")}
                      {field("kaggle", "Kaggle link")}
                      <label className="ob-field">
                        Languages, separated by commas
                        <ListInput
                          values={profile.languages ?? []}
                          onChange={(values) => update("languages", values)}
                        />
                      </label>
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <label className="ob-field">
                    Topics and interests, separated by commas
                    <ListInput
                      name="interests"
                      values={profile.interests}
                      placeholder="AI, climate, developer tools…"
                      onChange={(values) => update("interests", values)}
                      invalid={missing.includes("interests")}
                    />
                    {missing.includes("interests") && (
                      <small className="ob-invalid">
                        Add at least one interest.
                      </small>
                    )}
                  </label>
                  <label className="ob-field">
                    Skills you want to learn
                    <ListInput
                      name="learningSkills"
                      values={profile.learningSkills ?? []}
                      onChange={(values) => update("learningSkills", values)}
                      placeholder="Python, public speaking…"
                    />
                    <small>
                      Optional; different from skills you already have.
                    </small>
                  </label>
                  <div className="ob-grid">
                    <label className="ob-field">
                      Maximum event budget
                      <input
                        name="maxPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        value={profile.preferences.maxPrice?.amount ?? ""}
                        onChange={(e) =>
                          update("preferences", {
                            ...profile.preferences,
                            maxPrice:
                              e.target.value === ""
                                ? null
                                : {
                                    amount: Number(e.target.value),
                                    currency: budgetCurrency,
                                  },
                          })
                        }
                      />
                      <small>
                        Optional. Leave blank for no preference; zero means free
                        events.
                      </small>
                    </label>
                    <label className="ob-field">
                      Budget currency
                      <input
                        name="budgetCurrency"
                        minLength={3}
                        maxLength={3}
                        pattern="[A-Za-z]{3}"
                        value={budgetCurrency}
                        onChange={(e) => {
                          setBudgetCurrency(e.target.value.toUpperCase());
                          if (profile.preferences.maxPrice)
                            update("preferences", {
                              ...profile.preferences,
                              maxPrice: {
                                ...profile.preferences.maxPrice,
                                currency: e.target.value.toUpperCase(),
                              },
                            });
                        }}
                      />
                    </label>
                  </div>
                  {choices("goals", "Your goals", [
                    "Learning",
                    "Networking",
                    "Building",
                    "Career",
                    "Research",
                  ])}
                  {choices("kinds", "Events you’d join", [
                    "hackathon",
                    "conference",
                    "meetup",
                    "workshop",
                    "festival",
                  ])}
                  {choices("formats", "Preferred formats", [
                    "In person",
                    "Hybrid",
                    "Online",
                  ])}
                  {choices("roles", "How you’d participate", [
                    "Participant",
                    "Mentor",
                    "Speaker",
                    "Judge",
                  ])}
                  <label className="ob-check">
                    <input
                      type="checkbox"
                      checked={profile.lookingForTeam}
                      onChange={(e) =>
                        update("lookingForTeam", e.target.checked)
                      }
                    />
                    I’m looking for a team
                  </label>
                  <label className="ob-check">
                    <input
                      type="checkbox"
                      checked={profile.preferences?.notify ?? false}
                      onChange={(e) =>
                        update("preferences", {
                          ...profile.preferences,
                          notify: e.target.checked,
                        } as never)
                      }
                    />
                    Notify me about recommended events
                  </label>
                  <div className="ob-summary">
                    <h3>
                      {profile.first_name} {profile.last_name}
                    </h3>
                    <p>
                      {profile.title} · {profile.city}
                    </p>
                    <p>{profile.skills.join(", ")}</p>
                    <button
                      type="button"
                      className="ob-link"
                      onClick={() => setStep("review")}
                    >
                      Edit reviewed profile
                    </button>
                  </div>
                </>
              )}
            </fieldset>
            <button
              type="button"
              className="ob-link"
              disabled={!!busy || conflict}
              onClick={() =>
                void persist(
                  step === "review" ? "review" : "interests",
                  false,
                  true,
                )
              }
            >
              Save progress
            </button>
            <div className="ob-actions">
              <button
                type="button"
                className="ob-secondary"
                disabled={!!busy}
                onClick={() => {
                  if (step === "interests") setStep("review");
                  else input.current?.click();
                }}
              >
                {step === "interests" ? "Back to review" : "Replace CV"}
              </button>
              <button
                className="ob-primary"
                disabled={!!busy || conflict}
                type="submit"
              >
                {step === "interests" ? "Finish setup" : "Save and continue"}
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            <p className="ob-hint" role="status">
              {saved || "Progress is saved when you continue."}
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
