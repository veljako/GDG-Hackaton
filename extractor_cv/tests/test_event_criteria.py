import json
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import event_candidate_finder as events
from contracts import normalize_event_constraints


def criteria(**updates):
    data = dict(skills=["Python"], location="Belgrade", seniority="Junior",
                min_birth_year=None, max_birth_year=None, name=None,
                short_description="Synthetic event.", remote=False, event_type="hackathon")
    data.update(updates)
    return data


class Response:
    status_code = 200
    text = "SYNTHETIC PRIVATE RESPONSE"
    def __init__(self, data):
        self.data = data
        self.body = json.dumps({"response": json.dumps(data)}).encode("utf-8")
        self.headers = {"Content-Length": str(len(self.body))}
    def json(self):
        return {"response": json.dumps(self.data)}
    def close(self):
        pass
    def iter_content(self, chunk_size=8192):
        for index in range(0, len(self.body), chunk_size):
            yield self.body[index:index + chunk_size]


class EventCriteriaTests(unittest.TestCase):
    def test_open_audience_does_not_require_known_age_seniority_or_status(self):
        data = criteria(seniority=None, skills=["Python"], min_age=0, max_age=130,
                        seniorities=["Junior", "Mid", "Senior"],
                        statuses=["Student", "Employed", "Freelancer"])
        with patch.object(events, "_call_json_generate", return_value=data):
            result = events.event_to_json("Python workshop. Open to all professional seniorities and statuses. There are no age restrictions.")
        self.assertIsNone(result["min_age"])
        self.assertIsNone(result["max_age"])
        self.assertEqual(result["seniorities"], [])
        self.assertEqual(result["statuses"], [])
        from matching_eligibility import candidate_eligible
        self.assertTrue(candidate_eligible({"skills": []}, result))

    def test_all_attendees_must_meet_explicit_restrictions_is_not_unrestricted(self):
        data = criteria(seniority="Senior", skills=["Python"], min_age=18, max_age=None,
                        seniorities=["Senior"], statuses=["Student"])
        with patch.object(events, "_call_json_generate", return_value=data):
            result = events.event_to_json("Python workshop. All attendees must have Senior seniority and Student status and be aged 18+.")
        self.assertEqual(result["seniorities"], ["Senior"])
        self.assertEqual(result["statuses"], ["Student"])
        self.assertEqual(result["min_age"], 18)

    def test_explicit_audience_level_and_delivery_language_repair_model_omissions(self):
        data = criteria(seniority=None, skills=["React"], levels=["Beginner"], languages=[])
        with patch.object(events, "_call_json_generate", return_value=data):
            result = events.event_to_json("React hackathon. Audience level: Intermediate. Online event, conducted in English.")
        self.assertEqual(result["levels"], ["Intermediate"])
        self.assertEqual(result["languages"], ["English"])

    def test_legacy_one_sided_bounds_convert_and_version_two_stays_ascending(self):
        self.assertEqual(normalize_event_constraints({"max_birth_year": 2000})["min_birth_year"], 2000)
        self.assertEqual(normalize_event_constraints({"min_birth_year": 2000})["max_birth_year"], 2000)
        record = {"criteria_version": 2, "min_birth_year": 1990, "max_birth_year": 2000}
        self.assertEqual(normalize_event_constraints(record)["min_birth_year"], 1990)
        with self.assertRaises(ValueError):
            normalize_event_constraints({"criteria_version": 2, "min_birth_year": 2000, "max_birth_year": 1990})

    def test_learning_skills_status_and_multiple_levels_round_trip(self):
        data = criteria(skills=["Rust"], topics=["Robotics"], taught_skills=["Rust"], required_skills=[], levels=["Beginner", "Intermediate"], statuses=["Student"], seniorities=[], min_age=18, max_age=None, format="hybrid", event_type="festival")
        with patch.object(events, "_call_json_generate", return_value=data):
            result = events.event_to_json("Hybrid Rust festival teaches Rust and Robotics for students of junior and mid levels aged 18+.")
        for field in ("taught_skills", "required_skills", "levels", "statuses", "seniorities"):
            self.assertEqual(result[field], data[field])
        self.assertEqual(result["format"], "hybrid")
        self.assertTrue(result["remote"])
        self.assertEqual(result["min_age"], 18)
        self.assertEqual(result["event_type"], "festival")

    def test_version_two_unknown_attendance_and_unseen_skill(self):
        data = criteria(skills=["Rust"], format=None, criteria_version=2)
        with patch.object(events, "_call_json_generate", return_value=data):
            result = events.extract_event_criteria("Rust workshop for students.", [dict(skills=["Python"], location=None, seniority=None)], "unused")
        self.assertEqual(result["skills"], ["Rust"])
        self.assertIsNone(result["format"])
        self.assertNotIn("remote", result)

    def test_version_two_ages_are_not_birth_years(self):
        data = criteria(criteria_version=2, min_age=18, max_age=25, min_birth_year=2001, max_birth_year=2008)
        events._normalize_birth_years("Workshop for ages 18 to 25.", data)
        self.assertIsNone(data["min_birth_year"])
        self.assertEqual(data["min_age"], 18)

    def test_hackathon_has_no_invented_age_constraint(self):
        data = criteria(min_birth_year=2008, max_birth_year=2001)
        events._normalize_birth_years("Hackathon for junior Python developers.", data)
        self.assertIsNone(data["min_birth_year"])
        self.assertIsNone(data["max_birth_year"])

    def test_one_sided_birth_year_constraints_survive_normalization(self):
        for field in ("min_birth_year", "max_birth_year"):
            data = criteria(**{field: 2000})
            events._normalize_birth_years("Participants born in or after 2000.", data)
            self.assertEqual(data[field], 2000)
            other = "max_birth_year" if field == "min_birth_year" else "min_birth_year"
            self.assertIsNone(data[other])

    def test_invalid_birth_year_bounds_are_rejected(self):
        for value in (1899, date.today().year + 1, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                events._normalize_birth_years("Participants born in 1800.", criteria(min_birth_year=value))

    def test_prompt_preserves_numeric_ages_without_year_conversion(self):
        with patch.object(events, "date", create=True) as fake_date:
            fake_date.today.return_value.year = 2034
            prompt = events.build_event_prompt("People aged 20 to 25.", [])
        self.assertNotIn("The current year is 2034", prompt)
        self.assertIn("NEVER compute birth years from ages", prompt)
        self.assertNotIn("A hackathon always", prompt)
        self.assertIn("null for both", prompt)
        self.assertIn("one-sided", prompt)

    def test_online_registration_does_not_enable_remote_attendance(self):
        for text in ("In-person only. Remote participation is not available. Registration is online.",
                     "Registration is online for the conference at the venue.",
                     "Conference is not online or remote. Tickets available online."):
            with self.subTest(text=text):
                data = criteria(remote=False)
                events._normalize_remote(text, data)
                self.assertFalse(data["remote"])

    def test_explicit_remote_negation_overrides_incorrect_true(self):
        data = criteria(remote=True)
        events._normalize_remote("In-person only; remote participation is not available.", data)
        self.assertFalse(data["remote"])

    def test_structured_remote_attendance_is_preserved(self):
        data = criteria(remote=True)
        events._normalize_remote("Conference with physical venue and attendance through a browser.", data)
        self.assertTrue(data["remote"])

    def test_negated_skills_are_never_reintroduced(self):
        data = criteria(skills=["Python"])
        events._merge_scraped_skills("No Docker or Kubernetes experience is required. We need Python.", data, {})
        self.assertEqual(data["skills"], ["Python"])

    def test_incidental_skill_mentions_do_not_override_structured_extraction(self):
        data = criteria(skills=["Python"])
        events._merge_scraped_skills("Docker sponsors this Python workshop.", data, {})
        self.assertEqual(data["skills"], ["Python"])

    def test_negated_skill_is_removed_from_incorrect_structured_result(self):
        data = criteria(skills=["Python", "Docker", "Kubernetes"])
        events._merge_scraped_skills("Python workshop. No Docker or Kubernetes knowledge needed.", data, {})
        self.assertEqual(data["skills"], ["Python"])

    def test_comma_positive_skill_clause_does_not_inherit_prior_negation(self):
        data = criteria(skills=["Python", "Docker"])
        events._merge_scraped_skills("No Docker knowledge is required, Python is mandatory.", data, {})
        self.assertEqual(data["skills"], ["Python"])

    def test_comma_positive_remote_clause_does_not_inherit_skill_negation(self):
        data = criteria(remote=True)
        events._normalize_remote("No Docker experience is required, remote attendance is available.", data)
        self.assertTrue(data["remote"])

    def test_completed_negative_predicate_does_not_cancel_following_positive_skill(self):
        data = criteria(skills=["Python", "Docker", "Kubernetes"])
        events._merge_scraped_skills("No Docker or Kubernetes knowledge is required and Python is mandatory.", data, {})
        self.assertEqual(data["skills"], ["Python"])

    def test_negative_comma_skill_list_remains_excluded(self):
        data = criteria(skills=["Python", "Docker", "Kubernetes"])
        events._merge_scraped_skills("No Docker, Kubernetes or Python knowledge is needed.", data, {})
        self.assertEqual(data["skills"], [])

    def test_selected_event_type_is_preserved_when_multiple_types_mentioned(self):
        data = criteria(event_type="conference")
        events._normalize_event_type("After last year's hackathon, we are running a conference.", data)
        self.assertEqual(data["event_type"], "conference")

    def test_end_to_end_criteria_has_no_ages_or_negated_skills(self):
        data = criteria(skills=["Python"])
        with patch.object(events.requests, "post", return_value=Response(data)):
            result = events.extract_event_criteria("Python hackathon in Belgrade. No Docker needed. In-person only; registration online.", [], "http://localhost/generate")
        self.assertEqual(result["skills"], ["Python"])
        self.assertIsNone(result["min_birth_year"])
        self.assertIsNone(result["max_birth_year"])
        self.assertFalse(result["remote"])

    def test_matching_one_sided_bounds_keeps_open_end_and_rejects_unknown(self):
        self.assertTrue(events._years_match(2005, criteria(max_birth_year=2000)))
        self.assertFalse(events._years_match(1999, criteria(max_birth_year=2000)))
        self.assertTrue(events._years_match(1990, criteria(min_birth_year=2000)))
        self.assertFalse(events._years_match(2005, criteria(min_birth_year=2000)))
        self.assertFalse(events._years_match(None, criteria(min_birth_year=2000)))

    def test_unconstrained_hackathon_can_match_missing_birth_year(self):
        cvs = [dict(source="Synthetic", skills=["Python"], location="Belgrade", seniority="Junior", birth_year=None)]
        self.assertEqual(len(events.match_people(cvs, criteria())), 1)

    def test_cyrillic_location_alias_matches(self):
        self.assertTrue(events._location_matches("Београд", "Belgrade"))

    def test_common_one_sided_age_wording_keeps_extracted_bound(self):
        for text in ("Hackathon for participants over 18.", "Hackathon for ages 18+.",
                     "Hakaton za učesnike starije od 18 godina."):
            data = criteria(min_birth_year=date.today().year - 18)
            events._normalize_birth_years(text, data)
            self.assertEqual(data["min_birth_year"], date.today().year - 18, text)

    def test_remote_matching_does_not_require_local_city(self):
        cvs = [dict(source="Synthetic", skills=["Python"], location="Novi Sad", seniority="Junior", birth_year=None)]
        self.assertEqual(len(events.match_people(cvs, criteria(remote=True))), 1)

    def test_event_errors_do_not_include_response_or_private_value(self):
        data = criteria(skills=["SYNTHETIC PRIVATE SKILL"])
        with patch.object(events.requests, "post", return_value=Response(data)) as post:
            with self.assertRaises(ValueError) as failed:
                events.extract_event_criteria("Synthetic event", [dict(skills=["Python"], location=None, seniority=None)], "http://localhost/generate")
        self.assertNotIn("PRIVATE", str(failed.exception))
        for call in post.call_args_list:
            self.assertNotIn("PRIVATE", call.kwargs["json"]["prompt"])


if __name__ == "__main__":
    unittest.main()
