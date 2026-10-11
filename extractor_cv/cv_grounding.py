"""Ground extraction in explicit bilingual CV fields without guessing eligibility."""
import re
import unicodedata

NULL_WORDS = frozenset(('null','none','unknown','unspecified','n/a','not stated','nije navedeno','nepoznato'))

def key(value):
    text = unicodedata.normalize('NFKD', value.casefold())
    return ''.join(c for c in text if not unicodedata.combining(c)).strip()

# Translations of skill names, not rules that infer a skill from a job title.
SKILL_ALIASES = {
    'biologija':'Biology', 'biology':'Biology', 'mikroskopija':'Microscopy', 'microscopy':'Microscopy',
    'masinsko ucenje':'Machine Learning', 'machine learning':'Machine Learning',
    'statistika':'Statistics', 'statistics':'Statistics', 'analiza podataka':'Data Analysis',
    'data analysis':'Data Analysis', 'prototipovanje':'Prototyping', 'prototyping':'Prototyping',
    'korisnicko iskustvo':'UX', 'user experience':'UX',
    'биологија':'Biology', 'микроскопија':'Microscopy', 'машинско учење':'Machine Learning', 'статистика':'Statistics',
}

def skill_name(value):
    return SKILL_ALIASES.get(key(value), value.strip())

def skill_values(value):
    # Some smaller models copy a whole labelled source line as one skill.
    # Recognize only the actual bilingual skill headings; other colons remain.
    labelled = re.fullmatch(r'\s*([^:]{1,40})\s*:\s*(.*?)\s*', value)
    if labelled and key(labelled[1]) in ('skills','vestine','вештине'):
        return [skill_name(part) for part in re.split(r'[,;|]', labelled[2]) if part.strip()]
    return [skill_name(value)]

def explicit_fields(text):
    fields = {}
    labels = {'grad':'location','city':'location','location':'location','mesto':'location','lokacija':'location',
        'град':'location','локација':'location','vestine':'skills','skills':'skills','вештине':'skills',
        'nivo iskustva':'experience_level','experience level':'experience_level','seniority':'experience_level','ниво искуства':'experience_level'}
    for line in text.splitlines():
        match = re.fullmatch(r'\s*([^:\n]{1,40})\s*:\s*(.*?)\s*', line)
        if match and key(match[1]) in labels:
            fields[labels[key(match[1])]] = match[2]
    return fields

def ground_cv(raw, text, *, enforce_seniority=True):
    """Explicit labels repair omitted fields; missing seniority remains unknown."""
    result = dict(raw)
    fields = explicit_fields(text)
    if fields.get('location'):
        result['location'] = None if key(fields['location']) in NULL_WORDS else fields['location']
    stated_skills = [skill_name(s) for s in re.split(r'[,;|]', fields.get('skills','')) if s.strip() and key(s) not in NULL_WORDS]
    skills = [part for s in result.get('skills',[]) if isinstance(s,str) and key(s) not in NULL_WORDS for part in skill_values(s)]
    result['skills'] = list(dict.fromkeys(skills + stated_skills))
    level = fields.get('experience_level')
    if level is not None:
        result['experience_level'] = None if key(level) in NULL_WORDS else level
    elif enforce_seniority:
        # A clear seniority word in a stated role is evidence; projects/age alone are not.
        role_lines = '\n'.join(line for line in text.splitlines() if re.match(r'\s*(current role|trenutna uloga|title|position|pozicija|тренутна улога)\s*:',line,re.I))
        found = re.search(r'\b(junior|mid|senior)\b', role_lines, re.I)
        result['experience_level'] = found[1] if found else None
    return result
