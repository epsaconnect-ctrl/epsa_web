"""Official Ethiopian BA Psychology blueprint metadata (2015 E.C.)."""

from collections import OrderedDict

THEME_COURSE_OUTCOMES = OrderedDict([
    ("Fundamentals of Psychology and Lifespan Human Development", OrderedDict([
        ("General Psychology", [
            "Concepts, goals, branches, and perspectives of Psychology",
            "Sensation, attention and perception",
            "Memory and forgetting",
            "Motivation and emotion",
        ]),
        ("Personality Psychology", [
            "Major concepts of personality",
            "Factors and determinants of personality",
            "Assessment of personality",
            "Theories of personality (psychoanalytic, trait and humanistic)",
        ]),
        ("Psychology of Childhood", [
            "Principles, domains, and controversies of Human Development",
            "Theories of human development (Freud, Erikson, and Piaget)",
            "Developmental changes during pre and post natal periods",
            "Characteristics and Developmental Tasks",
        ]),
        ("Psychology of Adolescence", [
            "Fundamental changes in Adolescence",
            "Developmental and Psychosocial Problems of Adolescents",
        ]),
    ])),
    ("Psychology of Education and Psychological Assessment", OrderedDict([
        ("Educational Assessment and Evaluation", [
            "Basic concepts of assessment and evaluation",
            "Purpose of assessment and evaluation",
            "Steps in classroom test preparation",
            "Qualities of tests (validity and reliability)",
            "Considerations in test format selection",
        ]),
        ("Educational Psychology", [
            "Focal Areas of Educational Psychology",
            "Factors Affecting Learning",
            "Learning Theories and implications",
            "Instructional strategies and classroom management",
        ]),
    ])),
    ("Research and Statistical Methods and Project in Psychology", OrderedDict([
        ("Statistical Methods", [
            "Basic terms in statistics",
            "Scales of measurement in statistics",
            "Measures of central tendency (mode, mean and median)",
            "Measures of relationship",
        ]),
        ("Research Methods in Psychology", [
            "Classification of research",
            "Steps in research",
            "Sampling techniques",
            "Types of data collection instrument",
        ]),
    ])),
    ("Social Psychology", OrderedDict([
        ("Introduction to Social Psychology", [
            "Basic concepts",
            "Socialization concept, agents and purpose",
            "Impression formation and attribution",
            "Attitude/behavior formation and change",
            "Social influence (conformity, compliance and obedience)",
            "Intergroup relations and attraction (stereotype, prejudice, discrimination, interpersonal relationship)",
            "Pro-social and anti-social behaviors",
        ]),
        ("Industrial/Organizational Psychology", [
            "Concepts of I/O Psychology",
            "Theories of Leadership",
            "Job design",
            "Workforce motivation",
            "Organizational culture",
            "Managing diversity",
        ]),
    ])),
    ("Counseling, Health and Clinical Psychology", OrderedDict([
        ("Introduction to Guidance and Counseling", [
            "Goals of Guidance and Counseling",
            "Ethical and Legal Issues in Counseling",
            "Basic Counseling Skills",
            "The Counseling Process",
        ]),
        ("Theories and Techniques of Counseling", [
            "Goal of Psychotherapy",
            "Theories of counseling (views of human nature and therapeutic techniques)",
        ]),
        ("Psychopathology", [
            "Criteria for Defining Abnormal Behaviours",
            "Etiology of abnormal behaviour",
            "Assessing and Diagnosing Abnormal Behaviour",
            "Classification of abnormal behaviours",
        ]),
    ])),
])

THEME_EXAM_COUNTS = OrderedDict([
    ("Fundamentals of Psychology and Lifespan Human Development", 32),
    ("Psychology of Education and Psychological Assessment", 11),
    ("Research and Statistical Methods and Project in Psychology", 15),
    ("Social Psychology", 18),
    ("Counseling, Health and Clinical Psychology", 24),
])

COURSE_EXAM_COUNTS = OrderedDict([
    ("General Psychology", 7),
    ("Personality Psychology", 9),
    ("Psychology of Childhood", 8),
    ("Psychology of Adolescence", 8),
    ("Educational Assessment and Evaluation", 5),
    ("Educational Psychology", 6),
    ("Statistical Methods", 6),
    ("Research Methods in Psychology", 9),
    ("Introduction to Social Psychology", 10),
    ("Industrial/Organizational Psychology", 8),
    ("Introduction to Guidance and Counseling", 6),
    ("Theories and Techniques of Counseling", 8),
    ("Psychopathology", 10),
])

BLOOM_EXAM_COUNTS = OrderedDict([
    ("Remembering", 19),
    ("Understanding", 22),
    ("Applying", 20),
    ("Analyzing", 3),
    ("Evaluating", 2),
    ("Creating", 1),
])


def build_course_theme_map():
    mapping = {}
    for theme, courses in THEME_COURSE_OUTCOMES.items():
        for course in courses:
            mapping[course] = theme
    return mapping


COURSE_THEME_MAP = build_course_theme_map()


def get_blueprint_payload():
    effective_bloom_counts, bloom_note = get_effective_bloom_counts()
    return {
        "themes": list(THEME_COURSE_OUTCOMES.keys()),
        "hierarchy": [
            {
                "theme": theme,
                "courses": [
                    {"course": course, "outcomes": outcomes}
                    for course, outcomes in courses.items()
                ],
            }
            for theme, courses in THEME_COURSE_OUTCOMES.items()
        ],
        "theme_counts": dict(THEME_EXAM_COUNTS),
        "course_counts": dict(COURSE_EXAM_COUNTS),
        "bloom_counts": dict(BLOOM_EXAM_COUNTS),
        "effective_bloom_counts": dict(effective_bloom_counts),
        "bloom_note": bloom_note,
    }


def is_valid_theme(theme):
    return theme in THEME_COURSE_OUTCOMES


def is_valid_course(theme, course):
    return is_valid_theme(theme) and course in THEME_COURSE_OUTCOMES[theme]


def is_valid_outcome(theme, course, outcome):
    return is_valid_course(theme, course) and outcome in THEME_COURSE_OUTCOMES[theme][course]


def validate_taxonomy(theme, course, outcome):
    if not is_valid_theme(theme):
        return False, "Invalid theme"
    if not is_valid_course(theme, course):
        return False, "Selected course does not belong to the chosen theme"
    if not is_valid_outcome(theme, course, outcome):
        return False, "Selected learning outcome does not belong to the chosen course"
    return True, ""


def build_official_exam_blueprint():
    """Return exact course-weighted blueprint slots with overall Bloom distribution."""
    effective_bloom_counts, _ = get_effective_bloom_counts()
    bloom_remaining = OrderedDict((level, count) for level, count in effective_bloom_counts.items())
    course_remaining = OrderedDict((course, count) for course, count in COURSE_EXAM_COUNTS.items())
    course_bloom_counts = {}
    bloom_levels = list(bloom_remaining.keys())
    bloom_index = 0

    while sum(course_remaining.values()) > 0:
        for course, remaining in list(course_remaining.items()):
            if remaining <= 0:
                continue
            loop_guard = 0
            while bloom_remaining[bloom_levels[bloom_index]] <= 0 and loop_guard < len(bloom_levels):
                bloom_index = (bloom_index + 1) % len(bloom_levels)
                loop_guard += 1
            bloom_level = bloom_levels[bloom_index]
            course_bloom_counts[(course, bloom_level)] = course_bloom_counts.get((course, bloom_level), 0) + 1
            course_remaining[course] -= 1
            bloom_remaining[bloom_level] -= 1
            bloom_index = (bloom_index + 1) % len(bloom_levels)

    slots = []
    for theme, courses in THEME_COURSE_OUTCOMES.items():
        for course in courses:
            for bloom_level in BLOOM_EXAM_COUNTS.keys():
                count = course_bloom_counts.get((course, bloom_level), 0)
                if count > 0:
                    slots.append({
                        "category": theme,
                        "course": course,
                        "bloom_level": bloom_level,
                        "count": count,
                    })
    return slots


def get_effective_bloom_counts():
    bloom_counts = OrderedDict((level, count) for level, count in BLOOM_EXAM_COUNTS.items())
    course_total = sum(COURSE_EXAM_COUNTS.values())
    bloom_total = sum(bloom_counts.values())
    note = ""
    if bloom_total < course_total:
        remainder = course_total - bloom_total
        bloom_counts["Understanding"] += remainder
        note = (
            f"The provided Bloom counts sum to {bloom_total}, not {course_total}. "
            f"The scheduler fills the remaining {remainder} items into Understanding until the source blueprint is clarified."
        )
    elif bloom_total > course_total:
        note = (
            f"The provided Bloom counts sum to {bloom_total}, which exceeds the 100-item course blueprint. "
            f"The scheduler uses course totals as the hard cap."
        )
    return bloom_counts, note
