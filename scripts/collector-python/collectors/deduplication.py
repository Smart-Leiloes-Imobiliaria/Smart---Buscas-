import re
import unicodedata


AUTOMATIC_MATCH_SCORE = 90


def normalized_text(value):
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(re.findall(r"[a-z0-9]+", ascii_value.lower()))


def text_tokens(value):
    return set(normalized_text(value).split())


def same_value(left, right):
    return left is not None and right is not None and left == right


def same_text(left, right):
    normalized_left = normalized_text(left)
    return bool(normalized_left) and normalized_left == normalized_text(right)


def normalized_street(value):
    tokens = normalized_text(value).split()
    if not tokens:
        return ""

    street_type_aliases = {
        "r": "rua",
        "av": "avenida",
        "al": "alameda",
        "rod": "rodovia",
        "tv": "travessa",
        "pca": "praca",
    }
    tokens[0] = street_type_aliases.get(tokens[0], tokens[0])
    return " ".join(tokens)


def close_number(left, right, tolerance):
    if left is None or right is None:
        return False
    return abs(float(left) - float(right)) <= tolerance


def token_similarity(left, right):
    left_tokens = text_tokens(left)
    right_tokens = text_tokens(right)
    if not left_tokens or not right_tokens:
        return 0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def property_transaction(property_data):
    if property_data.get("rental_price") is not None:
        return "RENT"
    if property_data.get("sale_price") is not None:
        return "SALE"
    return None


def property_similarity(existing, candidate):
    if existing.get("source") == candidate.get("source"):
        return 0
    if not same_text(existing.get("city"), candidate.get("city")):
        return 0
    if not same_text(existing.get("state"), candidate.get("state")):
        return 0
    if existing.get("property_type") != candidate.get("property_type"):
        return 0

    existing_transaction = property_transaction(existing)
    candidate_transaction = property_transaction(candidate)
    if (
        existing_transaction
        and candidate_transaction
        and existing_transaction != candidate_transaction
    ):
        return 0

    identity_score = 0
    existing_street = normalized_street(existing.get("street"))
    candidate_street = normalized_street(candidate.get("street"))
    if existing_street and candidate_street and existing_street != candidate_street:
        return 0
    if existing_street and existing_street == candidate_street:
        identity_score = 65
    elif (
        len(text_tokens(existing.get("description"))) >= 12
        and token_similarity(
            existing.get("description"),
            candidate.get("description"),
        ) >= 0.85
    ):
        identity_score = 65

    if identity_score == 0:
        return 0

    score = identity_score
    if same_text(existing.get("neighborhood"), candidate.get("neighborhood")):
        score += 8
    if close_number(existing.get("usable_area"), candidate.get("usable_area"), 3):
        score += 12
    if same_value(existing.get("bedrooms"), candidate.get("bedrooms")):
        score += 8
    if same_value(existing.get("bathrooms"), candidate.get("bathrooms")):
        score += 5
    if same_value(existing.get("parking_spaces"), candidate.get("parking_spaces")):
        score += 7
    if same_value(existing.get("suites"), candidate.get("suites")):
        score += 5
    return min(score, 100)


def deduplicate_cross_source(properties):
    unique_properties = []
    duplicates = []

    for property_data in properties:
        match = next(
            (
                existing
                for existing in unique_properties
                if property_similarity(existing, property_data)
                >= AUTOMATIC_MATCH_SCORE
            ),
            None,
        )
        if match is None:
            unique_properties.append(property_data)
        else:
            duplicates.append({
                "representative": match,
                "duplicate": property_data,
                "score": property_similarity(match, property_data),
            })

    return unique_properties, duplicates
