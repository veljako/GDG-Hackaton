"""Explicit eligibility checks; relevance and hometown never imply admission."""
from datetime import date
from contracts import normalize_event_constraints
from event_candidate_finder import seniority_bucket

def candidate_eligible(candidate, event, *, today=None):
    event = normalize_event_constraints(event)
    if today is None and (event.get('min_age') is not None or event.get('max_age') is not None):
        try:
            value = event.get('date')
            if not isinstance(value, str) or len(value) < 10:
                return False
            today = date.fromisoformat(value[:10])
        except ValueError:
            return False
    today = today or date.today()
    def keys(values):
        return {str(v).strip().casefold() for v in values or []}
    if not keys(event.get('required_skills')) <= keys(candidate.get('skills')):
        return False
    for field, evidence in [('seniorities', candidate.get('experience_level')), ('statuses', candidate.get('status'))]:
        allowed = keys(event.get(field) or ([event['seniority']] if field == 'seniorities' and event.get('seniority') else []))
        if field == 'seniorities':
            allowed = {seniority_bucket(v) or v for v in allowed}
            evidence = seniority_bucket(evidence) if evidence else None
        if allowed and (not evidence or evidence.casefold() not in allowed):
            return False
    birth = None
    if candidate.get('birth_date'):
        try:
            birth = date.fromisoformat(candidate['birth_date'])
        except (TypeError, ValueError):
            return False
        if birth > today:
            return False
    year = birth.year if birth else candidate.get('birth_year')
    for field, lower in [('min_birth_year', True), ('max_birth_year',False)]:
        bound = event.get(field)
        if bound is not None and (year is None or (year < bound if lower else year > bound)):
            return False
    if event.get('min_age') is not None or event.get('max_age') is not None:
        if birth:
            youngest = oldest = today.year - birth.year - ((today.month,today.day) < (birth.month,birth.day))
        elif isinstance(year,int) and not isinstance(year,bool):
            youngest, oldest = today.year-year-1, today.year-year
            if today.month == 12 and today.day == 31:
                youngest = oldest
        else:
            return False
        if event.get('min_age') is not None and youngest < event['min_age']:
            return False
        if event.get('max_age') is not None and oldest > event['max_age']:
            return False
    return True
