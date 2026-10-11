import { z } from "zod";
import {
  requiresOnboarding,
  onboardingMissingFields,
  type OnboardingDraft,
} from "../src/onboarding";
import type { Repository } from "./repository";
import { DraftConflict } from "./repository";
import { profileSchema } from "./schema";
import { execute, view, type Session } from "./service";
import { MatchingRouteError } from "./matching-routes";
import { queueMatchingSync, type MatchingClient } from "./matching-client";

const editable = profileSchema.omit({ name: true, cv: true });
const envelope = z
  .object({
    profile: editable,
    step: z.enum(["review", "interests"]),
    expected_extraction_hash: z.string().min(1).max(256),
    expected_profile_updated_at: z.string().nullable(),
    expected_draft_version: z.number().int().positive().nullable(),
  })
  .strict();

/** The pending marker is committed with onboarding, so HTTP delivery failure cannot lose work. */
export async function deliverOnboardingMatching(
  repository: Repository,
  matching: MatchingClient | undefined,
  actor: string,
) {
  const person = (await repository.read()).people.find((p) => p.id === actor);
  if (
    person?.onboarding?.status !== "completed" ||
    person.onboarding.matching_sync !== "pending"
  )
    return { matching_sync: "queued" as const };
  const sync = await queueMatchingSync(matching, repository, actor);
  if (sync.matching_sync === "queued") {
    try {
      await repository.update((current) => {
        const me = current.people.find((p) => p.id === actor);
        if (
          me?.onboarding?.status === "completed" &&
          me.onboarding.matching_sync === "pending" &&
          me.updated_at === person.updated_at
        )
          me.onboarding.matching_sync = "queued";
        return { state: current };
      });
    } catch {
      // Delivery is idempotent. Preserve the durable marker if its acknowledgement cannot be saved.
      return {
        matching_sync: "unavailable" as const,
        warnings: [
          "Your profile is saved. Matching updates will retry automatically.",
        ],
      };
    }
  }
  return sync;
}

export function onboardingRoutes(
  repository: Repository,
  matching?: MatchingClient,
) {
  function invalid(message: string, status = 400): never {
    throw new MatchingRouteError(status, message);
  }
  return {
    async handle(
      route: string,
      session: Session,
      raw?: unknown,
    ): Promise<{
      draft?: OnboardingDraft | null;
      state?: ReturnType<typeof view>;
      organizer?: boolean;
      message?: string;
      matching_sync?: string;
      warnings?: string[];
    }> {
      const state = await repository.read();
      const person = state.people.find((p) => p.id === session.personId);
      if (!person) invalid("Profile not found.", 404);
      if (route === "draft" && raw === undefined) {
        const saved =
          (await repository.loadOnboardingDraft?.(person.id)) ?? null;
        const valid =
          requiresOnboarding(person) &&
          saved?.cv_path === person.cv_document?.storage_path &&
          saved?.expected_profile_updated_at === (person.updated_at ?? null);
        return { draft: valid ? saved : null };
      }
      if (route === "retry-matching") {
        if (!z.object({}).strict().safeParse(raw).success)
          invalid("Invalid matching retry.");
        if (person.onboarding?.status !== "completed")
          invalid("Finish your profile setup before finding matches.", 403);
        const sync = await deliverOnboardingMatching(
          repository,
          matching,
          person.id,
        );
        return {
          state: view(await repository.read(), session),
          organizer: session.organizer,
          ...sync,
        };
      }
      if (!["draft", "complete"].includes(route)) invalid("Not found.", 404);
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) invalid("Check your review fields and try again.");
      const input = parsed.data;
      if (route === "complete" && person.onboarding?.status === "completed") {
        const sync = await deliverOnboardingMatching(
          repository,
          matching,
          person.id,
        );
        return {
          state: view(await repository.read(), session),
          organizer: session.organizer,
          message: "Your setup is already complete.",
          ...sync,
        };
      }
      if (!requiresOnboarding(person))
        invalid("This account does not require onboarding.", 409);
      if (!person.cv_document)
        invalid("Upload your CV before reviewing your profile.", 409);
      if ((person.updated_at ?? null) !== input.expected_profile_updated_at)
        invalid("Your profile or CV changed. Reload the review.", 409);
      if (route === "draft") {
        if (!repository.saveOnboardingDraft)
          invalid("Saving your review is unavailable. Try again shortly.", 503);
        try {
          return {
            draft: await repository.saveOnboardingDraft(
              person.id,
              {
                cv_path: person.cv_document.storage_path,
                extraction_hash: input.expected_extraction_hash,
                expected_profile_updated_at: input.expected_profile_updated_at,
                profile: input.profile,
                step: input.step,
              },
              input.expected_draft_version,
            ),
          };
        } catch (error) {
          if (error instanceof DraftConflict) invalid(error.message, 409);
          throw error;
        }
      }
      const missing = onboardingMissingFields(input.profile);
      if (missing.length)
        invalid(`Complete these fields: ${missing.join(", ")}.`);
      // Eligibility values may be explicitly unknown, but must use the existing nullable contract.
      if (
        !["status", "birth_year", "experience_level"].every(
          (key) => key in input.profile,
        )
      )
        invalid(
          "Review your status, birth year and experience level. Unknown values are allowed.",
        );
      if (!repository.supportsCvExtractionGuard)
        invalid(
          "Secure profile confirmation is unavailable. Try again shortly.",
          503,
        );
      if (input.expected_draft_version === null)
        invalid("Save your review before finishing setup.", 409);
      const result = await repository.update(
        (current) => {
          const me = current.people.find((p) => p.id === session.personId);
          if (
            !me ||
            !requiresOnboarding(me) ||
            (me.updated_at ?? null) !== input.expected_profile_updated_at ||
            me.cv_document?.storage_path !== person.cv_document!.storage_path
          )
            return {
              state: current,
              error: "Your profile or CV changed. Reload the review.",
            };
          const applied = execute(current, session, {
            type: "UPDATE_PROFILE",
            personId: me.id,
            changes: input.profile,
          });
          if (!applied.error) {
            const target = applied.state.people.find((p) => p.id === me.id)!;
            const now = new Date().toISOString();
            target.onboarding = {
              version: 1,
              status: "completed",
              completed_at: now,
              matching_sync: "pending",
            };
            target.cv_document!.extraction_status = "completed";
            target.cv_document!.extracted_at = now;
          }
          return applied;
        },
        {
          personId: person.id,
          storagePath: person.cv_document.storage_path,
          extractionHash: input.expected_extraction_hash,
          sourceUpdatedAt: input.expected_profile_updated_at,
          completeOnboarding: { draftVersion: input.expected_draft_version },
        },
      );
      if (result.error) invalid(result.error, 409);
      const sync = await deliverOnboardingMatching(
        repository,
        matching,
        person.id,
      );
      return {
        state: view(await repository.read(), session),
        organizer: session.organizer,
        message: "Your profile is ready.",
        ...sync,
      };
    },
  };
}
