import policy from "./recommendation-policy.json";

/** Initial operational floor for the configured embedding model; not a probability. */
export const recommendationPolicy = policy;
export function suitableSemanticSimilarity(score: unknown): score is number {
  return (
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= policy.semanticMinSimilarity &&
    score <= 1
  );
}

export type RecommendationOutcome = "matched" | "no_suitable_event";
export function recommendationOutcome(
  results: readonly unknown[],
): RecommendationOutcome {
  return results.length ? "matched" : "no_suitable_event";
}
