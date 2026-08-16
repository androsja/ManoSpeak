"""Curated learning path for the VOZUAL LSC sign library."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SignCatalogEntry:
    """One suggested LSC gloss grouped by the user's communication need."""

    category: str
    gloss: str

    @property
    def recommended_duration_seconds(self) -> float:
        """Return the local playback and recording duration suggested for this sign."""

        return RECOMMENDED_DURATION_SECONDS.get(self.gloss, 1.2)


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
    "TRABAJO": 1.5,
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
    SignCatalogEntry("Personas y familia", "YO"),
    SignCatalogEntry("Personas y familia", "TÚ"),
    SignCatalogEntry("Personas y familia", "ÉL"),
    SignCatalogEntry("Personas y familia", "ELLA"),
    SignCatalogEntry("Personas y familia", "MAMÁ"),
    SignCatalogEntry("Personas y familia", "PAPÁ"),
    SignCatalogEntry("Personas y familia", "AMIGO"),
    SignCatalogEntry("Personas y familia", "NIÑO"),
    SignCatalogEntry("Necesidades y emergencia", "AYUDA"),
    SignCatalogEntry("Necesidades y emergencia", "AGUA"),
    SignCatalogEntry("Necesidades y emergencia", "COMER"),
    SignCatalogEntry("Necesidades y emergencia", "BAÑO"),
    SignCatalogEntry("Necesidades y emergencia", "DOLOR"),
    SignCatalogEntry("Necesidades y emergencia", "MÉDICO"),
    SignCatalogEntry("Necesidades y emergencia", "EMERGENCIA"),
    SignCatalogEntry("Necesidades y emergencia", "NO ENTIENDO"),
    SignCatalogEntry("Preguntas y respuestas", "SÍ"),
    SignCatalogEntry("Preguntas y respuestas", "NO"),
    SignCatalogEntry("Preguntas y respuestas", "QUÉ"),
    SignCatalogEntry("Preguntas y respuestas", "QUIÉN"),
    SignCatalogEntry("Preguntas y respuestas", "DÓNDE"),
    SignCatalogEntry("Preguntas y respuestas", "CUÁNDO"),
    SignCatalogEntry("Preguntas y respuestas", "CUÁNTO"),
    SignCatalogEntry("Preguntas y respuestas", "CÓMO"),
    SignCatalogEntry("Verbos frecuentes", "QUERER"),
    SignCatalogEntry("Verbos frecuentes", "TENER"),
    SignCatalogEntry("Verbos frecuentes", "IR"),
    SignCatalogEntry("Verbos frecuentes", "VENIR"),
    SignCatalogEntry("Verbos frecuentes", "HACER"),
    SignCatalogEntry("Verbos frecuentes", "VER"),
    SignCatalogEntry("Verbos frecuentes", "SABER"),
    SignCatalogEntry("Verbos frecuentes", "NECESITAR"),
    SignCatalogEntry("Tiempo y lugares", "AHORA"),
    SignCatalogEntry("Tiempo y lugares", "HOY"),
    SignCatalogEntry("Tiempo y lugares", "MAÑANA"),
    SignCatalogEntry("Tiempo y lugares", "AYER"),
    SignCatalogEntry("Tiempo y lugares", "CASA"),
    SignCatalogEntry("Tiempo y lugares", "TRABAJO"),
    SignCatalogEntry("Tiempo y lugares", "ESCUELA"),
    SignCatalogEntry("Tiempo y lugares", "HOSPITAL"),
    SignCatalogEntry("Números y cantidades", "CERO"),
    SignCatalogEntry("Números y cantidades", "UNO"),
    SignCatalogEntry("Números y cantidades", "DOS"),
    SignCatalogEntry("Números y cantidades", "TRES"),
    SignCatalogEntry("Números y cantidades", "CUATRO"),
    SignCatalogEntry("Números y cantidades", "CINCO"),
    SignCatalogEntry("Números y cantidades", "MUCHO"),
    SignCatalogEntry("Números y cantidades", "POCO"),
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
)

CATEGORY_ALL = "Todas las categorías"
CATEGORIES = (CATEGORY_ALL,) + tuple(
    dict.fromkeys(entry.category for entry in SIGN_LEARNING_PATH)
)


def suggested_signs(
    existing_glosses: set[str], category: str = CATEGORY_ALL
) -> tuple[SignCatalogEntry, ...]:
    """Return unpublished/uncreated suggestions in the curated learning order."""

    normalized_existing = {gloss.strip().upper() for gloss in existing_glosses}
    return tuple(
        entry
        for entry in SIGN_LEARNING_PATH
        if entry.gloss not in normalized_existing
        and (category == CATEGORY_ALL or entry.category == category)
    )
