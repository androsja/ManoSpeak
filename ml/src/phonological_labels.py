"""
Phonological label table for ManoSpeak — 94 LSC signs.

Maps each gloss string → (handshape, location, movement) integer triple.

Coordinate ranges (must match PhonSSM head sizes):
  handshape  h ∈ [0, 63]  (64 classes)
  location   l ∈ [0, 31]  (32 classes)
  movement   m ∈ [0, 31]  (32 classes)

All 94 triples are unique — enforced at module import time.

Location codes (l)
-------------------
  0  Neutral space (mid-level, forward)
  2  Forehead
  3  Eye / nose level
  5  Mouth
  6  Chin
  9  Chest / sternum
  10 Abdomen
  12 Side of head
  13 Temple / side-face
  14 Cheek
  16 Dactylology space (hand-level, in front)
  17 Upper body / shoulder envelope

Movement codes (m)
-------------------
  0  Static hold
  1  Forward / outward
  3  Upward
  4  Downward
  5  Lateral sweep
  6  Circular / arc
  7  Wrist rotation / flexion
  8  Hand opening / spread
  9  Hand closing / contract
  10 Repeated linear motion
  11 Wave / oscillation
  12 Trace-path (letter drawn in air)
  13 Alternating hands
"""

PHONOLOGICAL_LABELS: dict[str, tuple[int, int, int]] = {
    # ------------------------------------------------------------------
    # DACTYLOLOGY — Letters A-Z + NN  (h=0–26, l=16)
    # ------------------------------------------------------------------
    "A":  ( 0, 16,  0),
    "B":  ( 1, 16,  0),
    "C":  ( 2, 16,  0),
    "D":  ( 3, 16,  0),
    "E":  ( 4, 16,  0),
    "F":  ( 5, 16,  0),
    "G":  ( 6, 16,  0),
    "H":  ( 7, 16,  0),
    "I":  ( 8, 16,  0),
    "J":  ( 9, 16, 12),   # J drawn in air
    "K":  (10, 16,  0),
    "L":  (11, 16,  0),
    "M":  (12, 16,  0),
    "N":  (13, 16,  0),
    "NN": (14, 16,  0),   # NN digraph
    "O":  (15, 16,  0),
    "P":  (16, 16,  0),
    "Q":  (17, 16,  0),
    "R":  (18, 16,  0),
    "S":  (19, 16,  0),
    "T":  (20, 16,  0),
    "U":  (21, 16,  0),
    "V":  (22, 16,  0),
    "W":  (23, 16,  0),
    "X":  (24, 16,  0),
    "Y":  (25, 16,  0),
    "Z":  (26, 16, 12),   # Z drawn in air

    # ------------------------------------------------------------------
    # NUMBERS  (h=27–37, l=16)
    # ------------------------------------------------------------------
    "1":      (27, 16,  0),
    "4":      (28, 16,  0),
    "5":      (29, 16,  0),
    "6":      (30, 16,  0),
    "7":      (31, 16,  0),
    "8":      (32, 16,  0),
    "9":      (33, 16,  0),
    "10":     (34, 16,  0),
    "MIL":    (35, 16,  0),
    "MILLON": (36, 16,  0),
    "ANNOS":  (37, 16,  5),   # years — lateral sweep

    # ------------------------------------------------------------------
    # GREETINGS — open flat hand  (h=38)
    # ------------------------------------------------------------------
    "HOLA":  (38, 17, 11),   # wave at shoulder level
    "ADIOS": (38, 17,  1),   # outward sweep-wave
    "BIEN":  (38,  9,  0),   # flat hand at chest, static

    # ------------------------------------------------------------------
    # PRONOUNS — index pointing  (h=39)
    # ------------------------------------------------------------------
    "YO":      (39,  9,  0),   # index to own chest
    "TU":      (39,  0,  1),   # index forward
    "USTEDES": (39,  0,  6),   # circular sweep (plural you)
    "QUIEN":   (39,  0,  5),   # lateral WH-pointing

    # ------------------------------------------------------------------
    # POLITENESS — B-hand at chin / chest  (h=40)
    # ------------------------------------------------------------------
    "GRACIAS":  (40,  6,  1),   # flat hand chin → forward
    "PORFAVOR": (40,  9,  0),   # flat hand chest, static
    "PERDON":   (40,  6,  4),   # flat hand chin → downward
    "CONGUSTO": (40,  9,  5),   # flat hand chest, lateral

    # ------------------------------------------------------------------
    # QUANTITY — open 5-hand  (h=41)
    # ------------------------------------------------------------------
    "MUCHO":     (41,  0,  8),   # hands spread
    "POCO":      (41,  0,  9),   # hands contract
    "TODOS":     (41,  0,  6),   # circular sweep
    "FAMILIA":   (41,  0, 10),   # repeated arc
    "DIFERENTE": (41,  0, 13),   # alternating hands
    "PERSONAS":  (41, 17, 10),   # repeated at shoulder level

    # ------------------------------------------------------------------
    # EATING / SENSATION — C-hand near mouth / chest  (h=42)
    # ------------------------------------------------------------------
    "COMER":  (42,  5,  7),   # C-hand to mouth, flex
    "HAMBRE": (42,  9,  7),   # C-hand chest, rub
    "GUSTAR": (42,  9,  0),   # C-hand chest, static

    # ------------------------------------------------------------------
    # EMOTIONS — fist / chest contact  (h=43)
    # ------------------------------------------------------------------
    "MAL":      (43,  9,  7),   # fist rotation at chest
    "CONTENTO": (43,  9,  0),   # fist chest, static
    "FELIZ":    (43,  9,  3),   # fist chest, upward release
    "ABURRIDO": (43,  5,  4),   # near mouth, downward

    # ------------------------------------------------------------------
    # WH-QUESTIONS  (h=44, h=45)
    # ------------------------------------------------------------------
    "COMO":     (44,  0,  5),   # lateral question sweep
    "COMOESTAS":(44,  0,  6),   # circular social question
    "QUE":      (44,  0, 10),   # repeated forward
    "DONDE":    (44,  0,  1),   # outward pointing
    "CUANDO":   (44,  2,  5),   # forehead lateral sweep

    "PORQUE":   (45,  0,  3),   # neutral upward
    "MASOMENOS":(45,  0,  5),   # lateral rocking
    "NUNCA":    (45,  0,  4),   # outward-downward sweep

    # ------------------------------------------------------------------
    # HEAD AREA / COGNITIVE  (h=46)
    # ------------------------------------------------------------------
    "JUCIOSO": (46,  2,  0),   # forehead, static (rational)
    "HOMBRE":  (46, 13,  0),   # temple touch, static
    "MUJER":   (46, 14,  0),   # cheek touch, static

    # ------------------------------------------------------------------
    # FEELINGS  (h=47)
    # ------------------------------------------------------------------
    "TRISTE": (47,  9,  4),   # dragging down from chest
    "SENTIR": (47,  9,  6),   # circular at chest

    # ------------------------------------------------------------------
    # FAMILY KINSHIP  (h=48)
    # ------------------------------------------------------------------
    "ABUELO":  (48,  2,  0),   # forehead, static
    "TIO":     (48, 12,  0),   # side of head, static
    "HERMANO": (48, 17,  5),   # upper body, lateral

    # ------------------------------------------------------------------
    # CHILD / SIZE  (h=49)
    # ------------------------------------------------------------------
    "NIÑO": (49, 10,  0),   # abdomen level, static
    "NIÑA": (49, 10, 10),   # abdomen level, repeated

    # ------------------------------------------------------------------
    # IDENTITY / LANGUAGE  (h=50)
    # ------------------------------------------------------------------
    "NOMBRE":  (50,  6,  3),   # chin-to-up motion
    "SEÑA":    (50,  9,  0),   # chest, static (sign / language)
    "PERMISO": (50,  0,  1),   # neutral, forward

    # ------------------------------------------------------------------
    # TIME-OF-DAY GREETINGS (part 1)  (h=51)
    # ------------------------------------------------------------------
    "BUENAS": (51,  6,  0),   # general greeting — chin
    "DIAS":   (51,  3,  0),   # days — eye level
    "NOCHES": (51,  2,  0),   # nights — forehead

    # ------------------------------------------------------------------
    # TIME-OF-DAY GREETINGS (part 2)  (h=52)
    # ------------------------------------------------------------------
    "BUENOSDIAS":   (52,  6,  0),   # good morning
    "BUENASTARDES": (52, 12,  0),   # good afternoon — side of head
    "BUENASNOCHES": (52, 12, 10),   # good night — side of head, repeated
    "TARDES":       (52,  3,  0),   # afternoons

    # ------------------------------------------------------------------
    # WORK / LIFE / CONSUMPTION  (h=53)
    # ------------------------------------------------------------------
    "TRABAJAR": (53, 17, 10),   # upper body, repeated action
    "VIVIR":    (53,  9,  0),   # chest, static
    "LICOR":    (53,  5,  0),   # near mouth, static

    # ------------------------------------------------------------------
    # SOCIAL WELCOME  (h=54)
    # ------------------------------------------------------------------
    "BIENVENIDO": (54, 17,  3),   # sweeping inward-upward welcome
}

# Runtime uniqueness assertion — catches future label collisions immediately.
def _validate() -> None:
    seen: set[tuple[int, int, int]] = set()
    for gloss, triple in PHONOLOGICAL_LABELS.items():
        h, l, m = triple
        assert 0 <= h <= 63, f"{gloss}: h={h} out of range [0,63]"
        assert 0 <= l <= 31, f"{gloss}: l={l} out of range [0,31]"
        assert 0 <= m <= 31, f"{gloss}: m={m} out of range [0,31]"
        assert triple not in seen, f"Duplicate triple {triple} for gloss '{gloss}'"
        seen.add(triple)


_validate()
