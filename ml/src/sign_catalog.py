"""Curated learning path for the VOZUAL LSC sign library."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import TypedDict


@dataclass(frozen=True)
class SignCatalogEntry:
    """One suggested LSC gloss grouped by the user's communication need."""

    category: str
    gloss: str

    @property
    def recommended_duration_seconds(self) -> float:
        """Return the local playback and recording duration suggested for this sign."""

        return RECOMMENDED_DURATION_SECONDS.get(self.gloss, 1.2)


@dataclass(frozen=True)
class UsefulPhrasePreset:
    """One Spanish coverage goal and the LSC concepts it needs reviewed."""

    category: str
    spoken_text: str
    required_glosses: tuple[str, ...]


def _unique_forms(*groups: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    """Keep spoken variants ordered while avoiding duplicate recognition keys."""
    return tuple(dict.fromkeys(form.strip() for group in groups for form in group if form.strip()))


def _regular_verb_forms(infinitive: str) -> tuple[str, ...]:
    """Return the core simple indicative forms for a regular Spanish verb."""
    stem, ending = infinitive[:-2], infinitive[-2:]
    endings = {
        "ar": (
            ("o", "as", "a", "amos", "áis", "an"),
            ("é", "aste", "ó", "amos", "asteis", "aron"),
            ("aba", "abas", "aba", "ábamos", "abais", "aban"),
        ),
        "er": (
            ("o", "es", "e", "emos", "éis", "en"),
            ("í", "iste", "ió", "imos", "isteis", "ieron"),
            ("ía", "ías", "ía", "íamos", "íais", "ían"),
        ),
        "ir": (
            ("o", "es", "e", "imos", "ís", "en"),
            ("í", "iste", "ió", "imos", "isteis", "ieron"),
            ("ía", "ías", "ía", "íamos", "íais", "ían"),
        ),
    }
    if ending not in endings:
        return (infinitive,)
    present, preterite, imperfect = endings[ending]
    preterite_forms = [stem + suffix for suffix in preterite]
    # Preserve Spanish spelling before the accented first-person preterite.
    # Without this, mechanically generated entries such as PAGAR and BUSCAR
    # expose the invalid forms ``pagé`` and ``buscé`` to speech matching.
    if ending == "ar" and infinitive.endswith(("car", "gar", "zar")):
        spelling = {"c": "qu", "g": "gu", "z": "c"}[stem[-1]]
        preterite_forms[0] = stem[:-1] + spelling + "é"
    future_stem = infinitive
    future = ("é", "ás", "á", "emos", "éis", "án")
    conditional = ("ía", "ías", "ía", "íamos", "íais", "ían")
    return _unique_forms(
        (infinitive,),
        tuple(stem + suffix for suffix in present),
        tuple(preterite_forms),
        tuple(stem + suffix for suffix in imperfect),
        tuple(future_stem + suffix for suffix in future),
        tuple(future_stem + suffix for suffix in conditional),
    )


def _negative_forms(forms: tuple[str, ...]) -> tuple[str, ...]:
    """Turn one verb inventory into spoken negative phrase variants."""
    return _unique_forms(tuple(f"no {form}" for form in forms))


def _gender_number_forms(masculine: str, feminine: str | None = None) -> tuple[str, ...]:
    """Return an explicitly approved Spanish gender/number family.

    This helper is deliberately used only for concepts whose four surface
    forms have been reviewed as names for the same recorded LSC sign. It must
    not be applied automatically to arbitrary nouns or animal names.
    """
    feminine_form = feminine or f"{masculine[:-1]}a"
    return (
        masculine,
        feminine_form,
        f"{masculine}s",
        f"{feminine_form}s",
    )


# These forms are recognition aliases for one canonical LSC lexical concept.
# They deliberately do not claim that semantically different Spanish words have
# the same sign; an author can still adjust them in the editor when a regional
# LSC variant requires it.
VERB_SPEECH_FORMS: dict[str, tuple[str, ...]] = {
    "AYUDAR": _regular_verb_forms("ayudar") + (
        "ayuda",
        "ayúdame",
        "ayúdeme",
        "ayudando",
        "ayudado",
        "ayudada",
    ),
    "NECESITAR": _regular_verb_forms("necesitar") + ("requerir", "requiero", "requiere"),
    "HABLAR": _regular_verb_forms("hablar") + ("conversar", "converso", "conversa"),
    "DECIR": (
        "decir", "digo", "dices", "dice", "decimos", "decís", "dicen",
        "dije", "dijiste", "dijo", "dijimos", "dijisteis", "dijeron",
        "decía", "decías", "decíamos", "decían", "diré", "dirás", "dirá", "diremos", "dirán",
        "diría", "dirías", "diríamos", "dirían", "expresar", "expreso", "expresa",
    ),
    "PREGUNTAR": _regular_verb_forms("preguntar"),
    "RESPONDER": _regular_verb_forms("responder") + ("contestar", "contesto", "contesta"),
    "CONOCER": _regular_verb_forms("conocer"),
    "QUERER": (
        "querer", "quiero", "quieres", "quiere", "queremos", "queréis", "quieren",
        "quise", "quisiste", "quiso", "quisimos", "quisisteis", "quisieron",
        "quería", "querías", "queríamos", "queríais", "querían",
        "querré", "querrás", "querrá", "querremos", "querréis", "querrán",
        "querría", "querrías", "querríamos", "querríais", "querrían", "desear", "deseo", "desea",
    ),
    "TENER": (
        "tener", "tengo", "tienes", "tiene", "tenemos", "tenéis", "tienen",
        "tuve", "tuviste", "tuvo", "tuvimos", "tuvisteis", "tuvieron",
        "tenía", "tenías", "teníamos", "teníais", "tenían",
        "tendré", "tendrás", "tendrá", "tendremos", "tendréis", "tendrán",
        "tendría", "tendrías", "tendríamos", "tendríais", "tendrían",
    ),
    "IR": (
        "ir", "voy", "vas", "va", "vamos", "vais", "van",
        "fui", "fuiste", "fue", "fuimos", "fuisteis", "fueron",
        "iba", "ibas", "íbamos", "ibais", "iban",
        "iré", "irás", "irá", "iremos", "iréis", "irán",
        "iría", "irías", "iríamos", "iríais", "irían",
    ),
    "CAMINAR": _regular_verb_forms("caminar") + (
        "camine", "camines", "caminemos", "caminéis", "caminen",
        "caminando", "caminado", "caminada",
    ),
    "VENIR": (
        "venir", "vengo", "vienes", "viene", "venimos", "venís", "vienen",
        "vine", "viniste", "vino", "vinimos", "vinisteis", "vinieron",
        "venía", "venías", "veníamos", "veníais", "venían",
        "vendré", "vendrás", "vendrá", "vendremos", "vendréis", "vendrán",
        "vendría", "vendrías", "vendríamos", "vendríais", "vendrían",
    ),
    "HACER": (
        "hacer", "hago", "haces", "hace", "hacemos", "hacéis", "hacen",
        "hice", "hiciste", "hizo", "hicimos", "hicisteis", "hicieron",
        "hacía", "hacías", "hacíamos", "hacíais", "hacían",
        "haré", "harás", "hará", "haremos", "haréis", "harán",
        "haría", "harías", "haríamos", "haríais", "harían",
    ),
    "VER": (
        "ver", "veo", "ves", "ve", "vemos", "veis", "ven",
        "vi", "viste", "vio", "vimos", "visteis", "vieron",
        "veía", "veías", "veíamos", "veíais", "veían",
        "veré", "verás", "verá", "veremos", "veréis", "verán",
        "vería", "verías", "veríamos", "veríais", "verían",
    ),
    "SABER": (
        "saber", "sé", "sabes", "sabe", "sabemos", "sabéis", "saben",
        "supe", "supiste", "supo", "supimos", "supisteis", "supieron",
        "sabía", "sabías", "sabíamos", "sabíais", "sabían",
        "sabré", "sabrás", "sabrá", "sabremos", "sabréis", "sabrán",
        "sabría", "sabrías", "sabríamos", "sabríais", "sabrían",
    ),
    "PODER": (
        "poder", "puedo", "puedes", "puede", "podemos", "podéis", "pueden",
        "pude", "pudiste", "pudo", "pudimos", "pudisteis", "pudieron",
        "podía", "podías", "podíamos", "podíais", "podían",
        "podré", "podrás", "podrá", "podremos", "podréis", "podrán",
        "podría", "podrías", "podríamos", "podríais", "podrían",
    ),
    "GUSTAR": _regular_verb_forms("gustar") + ("me gusta", "te gusta", "le gusta", "nos gusta", "les gusta"),
    "PENSAR": (
        "pensar", "pienso", "piensas", "piensa", "pensamos", "pensáis", "piensan",
        "pensé", "pensaste", "pensó", "pensamos", "pensasteis", "pensaron",
        "pensaba", "pensabas", "pensábamos", "pensabais", "pensaban",
        "pensaré", "pensarás", "pensará", "pensaremos", "pensaréis", "pensarán",
        "pensaría", "pensarías", "pensaríamos", "pensaríais", "pensarían",
    ),
    "BUSCAR": _regular_verb_forms("buscar") + ("busqué",),
    "LLEGAR": _regular_verb_forms("llegar") + ("llegué",),
    "SALIR": _regular_verb_forms("salir") + ("salgo", "saldré", "saldrás", "saldrá", "saldremos", "saldréis", "saldrán"),
    "DAR": (
        "dar", "doy", "das", "da", "damos", "dais", "dan",
        "di", "diste", "dio", "dimos", "disteis", "dieron",
        "daba", "dabas", "dábamos", "dabais", "daban",
        "daré", "darás", "dará", "daremos", "daréis", "darán",
        "daría", "darías", "daríamos", "daríais", "darían",
    ),
    "TOMAR": _regular_verb_forms("tomar"),
    "APRENDER": _regular_verb_forms("aprender"),
    "ESTUDIAR": _regular_verb_forms("estudiar"),
    # One LSC action sign covers work as an action and its close employment
    # wording. Keep the noun forms because they frequently activate the same
    # recorded sign in ordinary Spanish conversation.
    "TRABAJAR": (
        _regular_verb_forms("trabajar")
        + _regular_verb_forms("emplear")
        + ("trabajo", "empleo")
    ),
    "VIVIR": _regular_verb_forms("vivir"),
    "LLAMAR": _regular_verb_forms("llamar") + (
        "llame", "llames", "llamemos", "llaméis", "llamen",
    ),
    "ESPERAR": _regular_verb_forms("esperar"),
    "ESCRIBIR": _regular_verb_forms("escribir") + (
        "escriba",
        "escribas",
        "escribamos",
        "escribáis",
        "escriban",
        "escríbeme",
        "escríbame",
        "escribiendo",
        "escrito",
        "escrita",
    ),
    "ENTRAR": _regular_verb_forms("entrar") + (
        "entre", "entres", "entremos", "entréis", "entren", "entrando", "entrado",
    ),
    "ABRIR": _regular_verb_forms("abrir") + (
        "abra", "abras", "abramos", "abráis", "abran", "abriendo", "abierto", "abierta",
    ),
    "COMPRAR": _regular_verb_forms("comprar"),
    "PAGAR": _regular_verb_forms("pagar"),
    "COMER": _regular_verb_forms("comer") + _regular_verb_forms("alimentar") + ("comida", "alimento"),
    "ENTENDER": (
        "entender", "entiendo", "entiendes", "entiende", "entendemos", "entendéis", "entienden",
        "entendí", "entendiste", "entendió", "entendimos", "entendisteis", "entendieron",
        "entendía", "entendías", "entendíamos", "entendíais", "entendían",
        "entenderé", "entenderás", "entenderá", "entenderemos", "entenderéis", "entenderán",
        "entendería", "entenderías", "entenderíamos", "entenderíais", "entenderían",
    ),
    "REPETIR": (
        "repetir", "repito", "repites", "repite", "repetimos", "repetís", "repiten",
        "repetí", "repetiste", "repitió", "repetimos", "repetisteis", "repitieron",
        "repetía", "repetías", "repetíamos", "repetíais", "repetían",
        "repetiré", "repetirás", "repetirá", "repetiremos", "repetiréis", "repetirán",
        "repetiría", "repetirías", "repetiríamos", "repetiríais", "repetirían",
        "repita", "repitas", "repitamos", "repitáis", "repitan",
    ),
}


# These are complete spoken Spanish phrases that resolve to one reviewed LSC
# recording. They are not split into an invented grammatical subject marker.
FIXED_EXPRESSION_SPEECH_FORMS: dict[str, tuple[str, ...]] = {
    "NO ENTIENDO": _unique_forms(
        _negative_forms(VERB_SPEECH_FORMS["ENTENDER"]),
        (
            "no comprender", "no comprendo", "no comprendes", "no comprende",
            "no comprendemos", "no comprendéis", "no comprenden",
            "no comprendí", "no comprendiste", "no comprendió", "no comprendimos",
            "no comprendisteis", "no comprendieron", "no comprendía", "no comprendías",
            "no comprendíamos", "no comprendíais", "no comprendían", "no comprenderé",
            "no comprenderás", "no comprenderá", "no comprenderemos", "no comprenderéis",
            "no comprenderán", "no comprendería", "no comprenderías", "no comprenderíamos",
            "no comprenderíais", "no comprenderían", "no lo entiendo", "no te entiendo",
            "no le entiendo", "no los entiendo", "no las entiendo", "no entiendo nada",
            "no entiendo bien", "no entendí nada", "no comprendí nada",
        ),
    ),
}


NOUN_SPEECH_EQUIVALENTS: dict[str, tuple[str, ...]] = {
    "AMIGO": _gender_number_forms("amigo"),
    "HERMANO": _gender_number_forms("hermano"),
    "NIÑO": _gender_number_forms("niño"),
    "MAMÁ": ("mamá", "mama", "madre", "madres"),
    "PAPÁ": ("papá", "papa", "padre", "padres"),
    "MÉDICO": (
        "médico", "médica", "médicos", "médicas",
        "doctor", "doctora", "doctores", "doctoras",
    ),
    "AGUA": ("agua", "aguas"),
    "BAÑO": ("baño", "baños"),
    "DOLOR": ("dolor", "dolores"),
    "EMERGENCIA": ("emergencia", "emergencias"),
    "AMBULANCIA": ("ambulancia", "ambulancias"),
    "POLICÍA": ("policía", "policías"),
    "PELIGRO": ("peligro", "peligros"),
    "MEDICINA": ("medicina", "medicinas", "medicamento", "medicamentos"),
    "ALERGIA": ("alergia", "alergias"),
    "FARMACIA": ("farmacia", "farmacias", "droguería", "droguerías"),
    "INTÉRPRETE": ("intérprete", "intérpretes"),
    "LENGUA DE SEÑAS": (
        "lengua de señas",
        "lenguaje de señas",
        "lengua de señas colombiana",
        "lsc",
    ),
    "NOMBRE": ("nombre", "nombres"),
    "CASA": ("casa", "casas", "hogar", "hogares"),
    "ESCUELA": ("escuela", "escuelas", "colegio", "colegios"),
    "HOSPITAL": ("hospital", "hospitales"),
    "DINERO": ("dinero", "plata"),
    "TELÉFONO": ("teléfono", "teléfonos", "celular", "celulares"),
    "TRANSPORTE": ("transporte", "transportes"),
    "DIRECCIÓN": ("dirección", "direcciones"),
    "PRECIO": ("precio", "precios"),
    "TARJETA": ("tarjeta", "tarjetas"),
    "EFECTIVO": ("efectivo", "dinero en efectivo"),
    "DOCUMENTO": ("documento", "documentos"),
    "CITA": ("cita", "citas"),
    "TURNO": ("turno", "turnos"),
    "AEROPUERTO": ("aeropuerto", "aeropuertos"),
    "AUTOBÚS": ("autobús", "autobuses", "bus", "buses"),
    "TAXI": ("taxi", "taxis"),
    "INTERNET": ("internet",),
    "MENSAJE": ("mensaje", "mensajes"),
    "CABALLO": ("caballo", "caballos"),
    "CARNE": ("carne", "carnes"),
    "COLORES": ("color", "colores"),
    "GATO": ("gato", "gata", "gatos", "gatas"),
    "PÁJARO": ("pájaro", "pájaros", "ave", "aves"),
    "PERRO": ("perro", "perra", "perros", "perras"),
    "PEZ": ("pez", "peces"),
    "VACA": ("vaca", "vacas"),
}


ADJECTIVE_SPEECH_EQUIVALENTS: dict[str, tuple[str, ...]] = {
    "SORDO": _gender_number_forms("sordo"),
    "OYENTE": ("oyente", "oyentes"),
    "ENFERMO": _gender_number_forms("enfermo"),
    "MUCHO": _gender_number_forms("mucho"),
    "POCO": _gender_number_forms("poco"),
    "BLANCO": _gender_number_forms("blanco"),
    "FELIZ": ("feliz", "felices", "contento", "contenta", "contentos", "contentas"),
    "TRISTE": ("triste", "tristes"),
    "CANSADO": _gender_number_forms("cansado"),
    "PREOCUPADO": _gender_number_forms("preocupado"),
    "ENOJADO": _gender_number_forms("enojado"),
    "ROJO": _gender_number_forms("rojo"),
    "TRANQUILO": (
        "tranquilo", "tranquila", "tranquilos", "tranquilas",
        "calmado", "calmada", "calmados", "calmadas",
    ),
}


# Historical aliases that became ambiguous after their own distinct sign was
# published. Keeping them would make recognition depend on catalog row order.
DISALLOWED_SPEECH_FORMS_BY_GLOSS: dict[str, frozenset[str]] = {
    "VENIR": frozenset({"llegar"}),
}


SIMPLE_SPEECH_FORMS: dict[str, tuple[str, ...]] = {
    "ADIÓS": ("adiós", "adios", "chao", "hasta luego"),
    "AYER": ("ayer",),
    "AQUÍ": ("aquí", "acá"),
    "ALLÁ": ("allá", "allí"),
    "CERCA": ("cerca",),
    "LEJOS": ("lejos",),
    "DESPACIO": ("despacio", "lentamente"),
    "BUENAS NOCHES": ("buenas noches",),
    "BUENAS TARDES": ("buenas tardes",),
    "BUENOS DÍAS": ("buenos días", "buenos dias"),
    "CUÁNDO": ("cuándo", "cuando"),
    "CUÁNTO": ("cuánto", "cuánta", "cuántos", "cuántas"),
    "QUIÉN": ("quién", "quien", "quiénes", "quienes"),
    "DÓNDE": ("dónde", "donde"),
    "CÓMO": ("cómo",),
    "POR QUÉ": ("por qué",),
    "CUÁL": ("cuál", "cual", "cuáles", "cuales"),
    "DINERO": ("dinero", "plata"),
    "ELLA": ("ella",),
    "GRACIAS": ("gracias", "muchas gracias", "te agradezco"),
    "HOLA": ("hola",),
    "HOY": ("hoy",),
    "NO": ("no",),
    "POR FAVOR": ("por favor", "porfa"),
    "PERDÓN": ("perdón", "perdon", "disculpa", "disculpe"),
    "QUÉ": ("qué", "que"),
    "SÍ": ("sí", "si"),
    "TRES": ("tres",),
    "CERO": ("cero",),
    "UNO": ("uno",),
    "DOS": ("dos",),
    "CUATRO": ("cuatro",),
    "CINCO": ("cinco",),
    "TÚ": ("tú", "tu", "usted"),
    "YO": ("yo",),
    "ÉL": ("él", "el"),
    "MAÑANA": ("mañana",),
    "AHORA": ("ahora",),
    "BIEN": ("bien",),
    "MAL": ("mal",),
    "¿CÓMO ESTÁS?": ("¿cómo estás?", "cómo estás", "como estas"),
}


LEXICAL_CLASS_BY_GLOSS: dict[str, str] = {
    **{gloss: "adjective" for gloss in ADJECTIVE_SPEECH_EQUIVALENTS},
    **{gloss: "noun" for gloss in NOUN_SPEECH_EQUIVALENTS},
    "ADIÓS": "fixed_expression",
    "BUENAS NOCHES": "fixed_expression",
    "BUENAS TARDES": "fixed_expression",
    "BUENOS DÍAS": "fixed_expression",
    "GRACIAS": "fixed_expression",
    "HOLA": "fixed_expression",
    "NO ENTIENDO": "fixed_expression",
    "PERDÓN": "fixed_expression",
    "POR FAVOR": "fixed_expression",
    "¿CÓMO ESTÁS?": "fixed_expression",
    "YO": "pronoun",
    "TÚ": "pronoun",
    "ÉL": "pronoun",
    "ELLA": "pronoun",
    "NO": "negation",
    "QUÉ": "question",
    "QUIÉN": "question",
    "DÓNDE": "question",
    "CÓMO": "question",
    "POR QUÉ": "question",
    "CUÁL": "question",
    "CUÁNDO": "question",
    "CUÁNTO": "question",
    "SÍ": "affirmation",
    "AYER": "temporal_adverb",
    "AHORA": "temporal_adverb",
    "HOY": "temporal_adverb",
    "MAÑANA": "temporal_adverb",
    "AQUÍ": "adverb",
    "ALLÁ": "adverb",
    "CERCA": "adverb",
    "LEJOS": "adverb",
    "DESPACIO": "adverb",
    "TRES": "numeral",
    "CERO": "numeral",
    "UNO": "numeral",
    "DOS": "numeral",
    "CUATRO": "numeral",
    "CINCO": "numeral",
    "BIEN": "adverb",
    "MAL": "adverb",
}


# Fixed expressions and movements with more than one clear phase need more
# time than short, isolated signs. The editor keeps capture and playback at
# this same value so recordings are never silently compressed.
RECOMMENDED_DURATION_SECONDS: dict[str, float] = {
    "BUENOS DÍAS": 1.8,
    "BUENAS TARDES": 1.8,
    "BUENAS NOCHES": 1.8,
    "POR FAVOR": 1.5,
    "NO ENTIENDO": 2.0,
    "EMERGENCIA": 1.6,
    "CUÁNTO": 1.5,
    "CÓMO": 1.5,
    "NECESITAR": 1.5,
    "TRABAJAR": 1.5,
    "HOSPITAL": 1.5,
    "CANSADO": 1.5,
}


# These are Spanish written labels for isolated LSC signs or fixed expressions.
# A qualified LSC signer must approve the regional variant before publication.
SIGN_LEARNING_PATH: tuple[SignCatalogEntry, ...] = (
    SignCatalogEntry("Saludos y cortesía", "HOLA"),
    SignCatalogEntry("Saludos y cortesía", "BUENOS DÍAS"),
    SignCatalogEntry("Saludos y cortesía", "BUENAS TARDES"),
    SignCatalogEntry("Saludos y cortesía", "BUENAS NOCHES"),
    SignCatalogEntry("Saludos y cortesía", "ADIÓS"),
    SignCatalogEntry("Saludos y cortesía", "GRACIAS"),
    SignCatalogEntry("Saludos y cortesía", "POR FAVOR"),
    SignCatalogEntry("Saludos y cortesía", "PERDÓN"),
    SignCatalogEntry("Saludos y cortesía", "¿CÓMO ESTÁS?"),
    SignCatalogEntry("Personas y familia", "YO"),
    SignCatalogEntry("Personas y familia", "TÚ"),
    SignCatalogEntry("Personas y familia", "ÉL"),
    SignCatalogEntry("Personas y familia", "ELLA"),
    SignCatalogEntry("Personas y familia", "MAMÁ"),
    SignCatalogEntry("Personas y familia", "PAPÁ"),
    SignCatalogEntry("Personas y familia", "AMIGO"),
    SignCatalogEntry("Personas y familia", "HERMANO"),
    SignCatalogEntry("Personas y familia", "NIÑO"),
    SignCatalogEntry("Accesibilidad y comunicación", "SORDO"),
    SignCatalogEntry("Accesibilidad y comunicación", "OYENTE"),
    SignCatalogEntry("Accesibilidad y comunicación", "INTÉRPRETE"),
    SignCatalogEntry("Accesibilidad y comunicación", "LENGUA DE SEÑAS"),
    SignCatalogEntry("Accesibilidad y comunicación", "DESPACIO"),
    SignCatalogEntry("Accesibilidad y comunicación", "ESCRIBIR"),
    SignCatalogEntry("Necesidades y emergencia", "AYUDAR"),
    SignCatalogEntry("Necesidades y emergencia", "AGUA"),
    SignCatalogEntry("Necesidades y emergencia", "COMER"),
    SignCatalogEntry("Necesidades y emergencia", "BAÑO"),
    SignCatalogEntry("Necesidades y emergencia", "DOLOR"),
    SignCatalogEntry("Necesidades y emergencia", "MÉDICO"),
    SignCatalogEntry("Necesidades y emergencia", "EMERGENCIA"),
    SignCatalogEntry("Necesidades y emergencia", "AMBULANCIA"),
    SignCatalogEntry("Necesidades y emergencia", "POLICÍA"),
    SignCatalogEntry("Necesidades y emergencia", "PELIGRO"),
    SignCatalogEntry("Necesidades y emergencia", "ENFERMO"),
    SignCatalogEntry("Necesidades y emergencia", "MEDICINA"),
    SignCatalogEntry("Necesidades y emergencia", "ALERGIA"),
    SignCatalogEntry("Necesidades y emergencia", "FARMACIA"),
    SignCatalogEntry("Necesidades y emergencia", "NO ENTIENDO"),
    SignCatalogEntry("Alimentos y bebidas", "CARNE"),
    SignCatalogEntry("Preguntas y respuestas", "SÍ"),
    SignCatalogEntry("Preguntas y respuestas", "NO"),
    SignCatalogEntry("Preguntas y respuestas", "QUÉ"),
    SignCatalogEntry("Preguntas y respuestas", "QUIÉN"),
    SignCatalogEntry("Preguntas y respuestas", "DÓNDE"),
    SignCatalogEntry("Preguntas y respuestas", "CUÁNDO"),
    SignCatalogEntry("Preguntas y respuestas", "CUÁNTO"),
    SignCatalogEntry("Preguntas y respuestas", "CÓMO"),
    SignCatalogEntry("Preguntas y respuestas", "POR QUÉ"),
    SignCatalogEntry("Preguntas y respuestas", "CUÁL"),
    SignCatalogEntry("Conversación cotidiana", "ENTENDER"),
    SignCatalogEntry("Conversación cotidiana", "REPETIR"),
    SignCatalogEntry("Conversación cotidiana", "HABLAR"),
    SignCatalogEntry("Conversación cotidiana", "DECIR"),
    SignCatalogEntry("Conversación cotidiana", "PREGUNTAR"),
    SignCatalogEntry("Conversación cotidiana", "RESPONDER"),
    SignCatalogEntry("Conversación cotidiana", "NOMBRE"),
    SignCatalogEntry("Conversación cotidiana", "CONOCER"),
    SignCatalogEntry("Verbos frecuentes", "QUERER"),
    SignCatalogEntry("Verbos frecuentes", "TENER"),
    SignCatalogEntry("Verbos frecuentes", "IR"),
    SignCatalogEntry("Verbos frecuentes", "CAMINAR"),
    SignCatalogEntry("Verbos frecuentes", "VENIR"),
    SignCatalogEntry("Verbos frecuentes", "HACER"),
    SignCatalogEntry("Verbos frecuentes", "VER"),
    SignCatalogEntry("Verbos frecuentes", "SABER"),
    SignCatalogEntry("Verbos frecuentes", "NECESITAR"),
    SignCatalogEntry("Verbos frecuentes", "PODER"),
    SignCatalogEntry("Verbos frecuentes", "GUSTAR"),
    SignCatalogEntry("Verbos frecuentes", "PENSAR"),
    SignCatalogEntry("Verbos frecuentes", "BUSCAR"),
    SignCatalogEntry("Verbos frecuentes", "LLEGAR"),
    SignCatalogEntry("Verbos frecuentes", "SALIR"),
    SignCatalogEntry("Verbos frecuentes", "DAR"),
    SignCatalogEntry("Verbos frecuentes", "TOMAR"),
    SignCatalogEntry("Verbos frecuentes", "APRENDER"),
    SignCatalogEntry("Verbos frecuentes", "ESTUDIAR"),
    SignCatalogEntry("Verbos frecuentes", "TRABAJAR"),
    SignCatalogEntry("Verbos frecuentes", "VIVIR"),
    SignCatalogEntry("Verbos frecuentes", "LLAMAR"),
    SignCatalogEntry("Verbos frecuentes", "ESPERAR"),
    SignCatalogEntry("Verbos frecuentes", "ENTRAR"),
    SignCatalogEntry("Verbos frecuentes", "ABRIR"),
    SignCatalogEntry("Tiempo y lugares", "AHORA"),
    SignCatalogEntry("Tiempo y lugares", "HOY"),
    SignCatalogEntry("Tiempo y lugares", "MAÑANA"),
    SignCatalogEntry("Tiempo y lugares", "AYER"),
    SignCatalogEntry("Tiempo y lugares", "CASA"),
    SignCatalogEntry("Tiempo y lugares", "ESCUELA"),
    SignCatalogEntry("Tiempo y lugares", "HOSPITAL"),
    SignCatalogEntry("Tiempo y lugares", "AQUÍ"),
    SignCatalogEntry("Tiempo y lugares", "ALLÁ"),
    SignCatalogEntry("Tiempo y lugares", "CERCA"),
    SignCatalogEntry("Tiempo y lugares", "LEJOS"),
    SignCatalogEntry("Tiempo y lugares", "AEROPUERTO"),
    SignCatalogEntry("Vida diaria", "COMPRAR"),
    SignCatalogEntry("Vida diaria", "PAGAR"),
    SignCatalogEntry("Vida diaria", "DINERO"),
    SignCatalogEntry("Vida diaria", "TELÉFONO"),
    SignCatalogEntry("Vida diaria", "TRANSPORTE"),
    SignCatalogEntry("Vida diaria", "DIRECCIÓN"),
    SignCatalogEntry("Vida diaria", "PRECIO"),
    SignCatalogEntry("Vida diaria", "TARJETA"),
    SignCatalogEntry("Vida diaria", "EFECTIVO"),
    SignCatalogEntry("Vida diaria", "DOCUMENTO"),
    SignCatalogEntry("Vida diaria", "CITA"),
    SignCatalogEntry("Vida diaria", "TURNO"),
    SignCatalogEntry("Vida diaria", "AUTOBÚS"),
    SignCatalogEntry("Vida diaria", "TAXI"),
    SignCatalogEntry("Vida diaria", "INTERNET"),
    SignCatalogEntry("Vida diaria", "MENSAJE"),
    SignCatalogEntry("Números y cantidades", "CERO"),
    SignCatalogEntry("Números y cantidades", "UNO"),
    SignCatalogEntry("Números y cantidades", "DOS"),
    SignCatalogEntry("Números y cantidades", "TRES"),
    SignCatalogEntry("Números y cantidades", "CUATRO"),
    SignCatalogEntry("Números y cantidades", "CINCO"),
    SignCatalogEntry("Números y cantidades", "MUCHO"),
    SignCatalogEntry("Números y cantidades", "POCO"),
    SignCatalogEntry("Colores", "COLORES"),
    SignCatalogEntry("Colores", "BLANCO"),
    SignCatalogEntry("Colores", "ROJO"),
    SignCatalogEntry("Animales", "PERRO"),
    SignCatalogEntry("Animales", "GATO"),
    SignCatalogEntry("Animales", "PÁJARO"),
    SignCatalogEntry("Animales", "PEZ"),
    SignCatalogEntry("Animales", "CABALLO"),
    SignCatalogEntry("Animales", "VACA"),
    SignCatalogEntry("Emociones y cualidades", "FELIZ"),
    SignCatalogEntry("Emociones y cualidades", "TRISTE"),
    SignCatalogEntry("Emociones y cualidades", "BIEN"),
    SignCatalogEntry("Emociones y cualidades", "MAL"),
    SignCatalogEntry("Emociones y cualidades", "CANSADO"),
    SignCatalogEntry("Emociones y cualidades", "HAMBRE"),
    SignCatalogEntry("Emociones y cualidades", "PREOCUPADO"),
    SignCatalogEntry("Emociones y cualidades", "ENOJADO"),
    SignCatalogEntry("Emociones y cualidades", "TRANQUILO"),
)

CATEGORY_ALL = "Todas las categorías"
CATEGORIES = (CATEGORY_ALL,) + tuple(
    dict.fromkeys(entry.category for entry in SIGN_LEARNING_PATH)
)

_CATEGORY_KEYS = {
    "Saludos y cortesía": "saludos_cortesia",
    "Personas y familia": "personas_familia",
    "Accesibilidad y comunicación": "accesibilidad_comunicacion",
    "Necesidades y emergencia": "necesidades",
    "Preguntas y respuestas": "preguntas_respuestas",
    "Conversación cotidiana": "conversacion_cotidiana",
    "Verbos frecuentes": "verbos_acciones",
    "Tiempo y lugares": "tiempo_lugares",
    "Vida diaria": "vida_diaria",
    "Números y cantidades": "numeros_cantidades",
    "Animales": "animales",
    "Emociones y cualidades": "emociones_cualidades",
    "Alimentos y bebidas": "alimentos_bebidas",
    "Colores": "colores",
}


# These are Spanish coverage goals, not claims about LSC word order. The
# editor uses them to expose which isolated concepts still need recording; a
# Deaf LSC reviewer remains responsible for the final grammatical sequence.
USEFUL_PHRASE_PRESETS: tuple[UsefulPhrasePreset, ...] = (
    UsefulPhrasePreset(
        "Emergencia",
        "Necesito ayuda",
        ("NECESITAR", "AYUDAR"),
    ),
    UsefulPhrasePreset(
        "Emergencia",
        "Llame a una ambulancia",
        ("LLAMAR", "AMBULANCIA"),
    ),
    UsefulPhrasePreset(
        "Emergencia",
        "Estoy en peligro, llame a la policía",
        ("PELIGRO", "LLAMAR", "POLICÍA"),
    ),
    UsefulPhrasePreset(
        "Salud",
        "Estoy enfermo y necesito medicina",
        ("ENFERMO", "NECESITAR", "MEDICINA"),
    ),
    UsefulPhrasePreset(
        "Salud",
        "Tengo alergia a esta medicina",
        ("TENER", "ALERGIA", "MEDICINA"),
    ),
    UsefulPhrasePreset(
        "Salud",
        "¿Dónde está la farmacia?",
        ("DÓNDE", "FARMACIA"),
    ),
    UsefulPhrasePreset(
        "Accesibilidad",
        "Soy sordo y necesito un intérprete",
        ("SORDO", "NECESITAR", "INTÉRPRETE"),
    ),
    UsefulPhrasePreset(
        "Accesibilidad",
        "Hablo lengua de señas",
        ("HABLAR", "LENGUA DE SEÑAS"),
    ),
    UsefulPhrasePreset(
        "Accesibilidad",
        "Por favor, escriba despacio",
        ("POR FAVOR", "ESCRIBIR", "DESPACIO"),
    ),
    UsefulPhrasePreset(
        "Accesibilidad",
        "No entiendo, repita por favor",
        ("NO ENTIENDO", "REPETIR", "POR FAVOR"),
    ),
    UsefulPhrasePreset(
        "Familia",
        "Mi hermana es sorda",
        ("HERMANO", "SORDO"),
    ),
    UsefulPhrasePreset(
        "Servicios",
        "¿Dónde está el baño?",
        ("DÓNDE", "BAÑO"),
    ),
    UsefulPhrasePreset(
        "Servicios",
        "¿Cuál es el precio?",
        ("CUÁL", "PRECIO"),
    ),
    UsefulPhrasePreset(
        "Pagos",
        "Quiero pagar con tarjeta",
        ("QUERER", "PAGAR", "TARJETA"),
    ),
    UsefulPhrasePreset(
        "Pagos",
        "Quiero pagar en efectivo",
        ("QUERER", "PAGAR", "EFECTIVO"),
    ),
    UsefulPhrasePreset(
        "Servicios",
        "Tengo una cita, ¿cuál es mi turno?",
        ("TENER", "CITA", "CUÁL", "TURNO"),
    ),
    UsefulPhrasePreset(
        "Servicios",
        "Aquí está mi documento",
        ("AQUÍ", "DOCUMENTO"),
    ),
    UsefulPhrasePreset(
        "Transporte",
        "¿Dónde está el aeropuerto?",
        ("DÓNDE", "AEROPUERTO"),
    ),
    UsefulPhrasePreset(
        "Transporte",
        "Necesito un taxi",
        ("NECESITAR", "TAXI"),
    ),
    UsefulPhrasePreset(
        "Transporte",
        "Necesito ir en autobús",
        ("NECESITAR", "IR", "AUTOBÚS"),
    ),
    UsefulPhrasePreset(
        "Ubicación",
        "Entre aquí, por favor",
        ("ENTRAR", "AQUÍ", "POR FAVOR"),
    ),
    UsefulPhrasePreset(
        "Ubicación",
        "Abra aquí, por favor",
        ("ABRIR", "AQUÍ", "POR FAVOR"),
    ),
    UsefulPhrasePreset(
        "Tecnología",
        "Necesito internet",
        ("NECESITAR", "INTERNET"),
    ),
    UsefulPhrasePreset(
        "Tecnología",
        "Escríbame un mensaje",
        ("ESCRIBIR", "MENSAJE"),
    ),
)

# Older recordings may still be stored under the surface noun ``TRABAJO``.
# They represent the same action concept and receive the verb's complete
# speech inventory when opened in the editor. The motion file itself is kept
# untouched until the author republishes it.
_LEGACY_CONCEPT_GLOSSES = {
    "TRABAJO": "TRABAJAR",
    "MAMA": "MAMÁ",
    "PAPA": "PAPÁ",
}


class AuthoringMetadata(TypedDict):
    categories: list[str]
    lexical_class: str
    verb_type: str
    review_status: str
    speech_aliases: list[str]


def authoring_linguistic_defaults(gloss: str) -> AuthoringMetadata:
    """Return safe authoring metadata for a curated, not-yet-published gloss."""
    normalized = gloss.strip().upper()
    concept_gloss = _LEGACY_CONCEPT_GLOSSES.get(normalized, normalized)
    entry = next((item for item in SIGN_LEARNING_PATH if item.gloss == concept_gloss), None)
    category = _CATEGORY_KEYS.get(entry.category, "sin_clasificar") if entry else "sin_clasificar"
    if concept_gloss in VERB_SPEECH_FORMS:
        return {
            "categories": [category],
            "lexical_class": "verb",
            "verb_type": "plain",
            "review_status": "draft",
            "speech_aliases": list(_unique_forms(VERB_SPEECH_FORMS[concept_gloss])),
        }
    if concept_gloss in FIXED_EXPRESSION_SPEECH_FORMS:
        return {
            "categories": [category],
            "lexical_class": "fixed_expression",
            "verb_type": "none",
            "review_status": "draft",
            "speech_aliases": list(FIXED_EXPRESSION_SPEECH_FORMS[concept_gloss]),
        }
    lexical_class = LEXICAL_CLASS_BY_GLOSS.get(concept_gloss, "noun")
    equivalents = ADJECTIVE_SPEECH_EQUIVALENTS.get(
        concept_gloss,
        NOUN_SPEECH_EQUIVALENTS.get(
            concept_gloss,
            SIMPLE_SPEECH_FORMS.get(concept_gloss, (normalized.lower(),)),
        ),
    )
    return {
        "categories": [category],
        "lexical_class": lexical_class,
        "verb_type": "none",
        "review_status": "draft",
        "speech_aliases": list(_unique_forms(equivalents)),
    }


def _normalize_gloss(gloss: str) -> str:
    """Normalize a motion label while preserving its lexical identity."""
    return "".join(
        character
        for character in unicodedata.normalize("NFD", gloss.strip().upper())
        if unicodedata.category(character) != "Mn"
    )


def missing_glosses_for_phrase(
    phrase: UsefulPhrasePreset, existing_glosses: set[str]
) -> tuple[str, ...]:
    """Return the phrase concepts that have not been recorded or published."""
    normalized_existing = {_normalize_gloss(gloss) for gloss in existing_glosses}
    return tuple(
        gloss
        for gloss in phrase.required_glosses
        if _normalize_gloss(gloss) not in normalized_existing
    )


def example_phrase_for_gloss(gloss: str) -> str | None:
    """Return the first coverage phrase that gives one concept useful context."""
    normalized_gloss = _normalize_gloss(gloss)
    return next(
        (
            phrase.spoken_text
            for phrase in USEFUL_PHRASE_PRESETS
            if any(
                _normalize_gloss(required) == normalized_gloss
                for required in phrase.required_glosses
            )
        ),
        None,
    )


def suggested_signs(
    existing_glosses: set[str], category: str = CATEGORY_ALL
) -> tuple[SignCatalogEntry, ...]:
    """Return unpublished/uncreated suggestions in the curated learning order."""

    normalized_existing = {_normalize_gloss(gloss) for gloss in existing_glosses}
    return tuple(
        entry
        for entry in SIGN_LEARNING_PATH
        if _normalize_gloss(entry.gloss) not in normalized_existing
        and (category == CATEGORY_ALL or entry.category == category)
    )
