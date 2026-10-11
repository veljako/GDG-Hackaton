import { useState } from "react";
import { semanticMatching, type SemanticResponse } from "../backend";
import {
  cvFieldLabel,
  cvReviewValue,
  reviewableCvFields,
  matchingSourceLabel,
} from "../cv-review";
export function MatchingControls({
  route,
  input,
  onResults,
  names,
}: {
  route: string;
  input: Record<string, unknown>;
  onResults?: (result: SemanticResponse) => void;
  names?: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SemanticResponse | null>(null);
  const [error, setError] = useState("");
  async function find() {
    setBusy(true);
    setError("");
    try {
      const r = await semanticMatching(route, input);
      setResult(r);
      onResults?.(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <button type="button" disabled={busy} onClick={find}>
        {busy
          ? "Finding matches…"
          : route === "recommendations"
            ? "Find semantic recommendations"
            : "Find semantic matches"}
      </button>
      <div role="status">
        {error ||
          (result
            ? route === "recommendations" && !result.results.length
              ? "No suitable event right now. Explore all events or update your interests."
              : `${result.results.length} matches · ${matchingSourceLabel(result.source)}`
            : "Use your interests and meaning to find matches.")}
      </div>
      {!!result?.warnings?.length && (
        <p role="status">{result.warnings.join(" ")}</p>
      )}
      {result?.results.map((r, i) => (
        <p key={r.eventId ?? r.personId ?? i}>
          {names?.[r.personId ?? r.eventId ?? ""]} {r.reasons.join(" · ")}
        </p>
      ))}
    </div>
  );
}
export function CvMatchingReview() {
  const [result, setResult] = useState<SemanticResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function extract(existing = false) {
    setBusy(true);
    setMessage("");
    try {
      const r = await semanticMatching(existing ? "cv/proposal" : "cv/extract");
      setResult(r);
      setSelected(reviewableCvFields(r.proposal ?? {}).map(([key]) => key));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!result) return;
    setBusy(true);
    try {
      await semanticMatching("cv/confirm", {
        confirmed_fields: Object.fromEntries(
          selected.map((k) => [k, result.proposal![k]]),
        ),
        expected_profile_updated_at: result.expected_profile_updated_at ?? null,
        expected_extraction_hash: result.extraction_hash,
      });
      setResult(null);
      setMessage("CV fields confirmed. Your profile will refresh shortly.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Review CV extraction">
      <h3>Extract profile fields from your CV</h3>
      <p>Review each field before adding it to your public profile.</p>
      <button type="button" disabled={busy} onClick={() => extract()}>
        {busy ? "Processing…" : "Extract current CV"}
      </button>
      <button type="button" disabled={busy} onClick={() => extract(true)}>
        Review saved extraction
      </button>
      <p role="status">{message}</p>
      {result?.proposal && (
        <>
          <div>
            {reviewableCvFields(result.proposal).map(([k, v]) => (
              <label
                key={k}
                style={{ display: "block", whiteSpace: "pre-line" }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(k)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, k]
                        : selected.filter((x) => x !== k),
                    )
                  }
                />
                {cvFieldLabel(k)}: {cvReviewValue(v)}
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !selected.length}
            onClick={confirm}
          >
            Confirm selected fields
          </button>
        </>
      )}
    </section>
  );
}
