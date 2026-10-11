"""Shared recommendation-only relevance policy, independent of browse/eligibility."""
import json
import math
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'src/recommendation-policy.json').read_text())
MIN_SIMILARITY = POLICY['semanticMinSimilarity']
if isinstance(MIN_SIMILARITY, bool) or not isinstance(MIN_SIMILARITY, (int, float)) or not math.isfinite(MIN_SIMILARITY) or not 0 < MIN_SIMILARITY <= 1:
    raise ValueError('Invalid semantic recommendation floor.')


def suitable_similarity(score):
    return not isinstance(score, bool) and isinstance(score, (int, float)) and math.isfinite(score) and MIN_SIMILARITY <= score <= 1
