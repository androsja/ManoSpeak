"""Embed editor-authored avatar profiles into every published mobile motion."""

from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MOTION_DIRECTORY = REPO_ROOT / "mobile/assets/motions"
REFERENCE_DIRECTORY = REPO_ROOT / "tmp/creator_references"


def profile_from_recipe(recipe: dict[str, object]) -> dict[str, object]:
    profile: dict[str, object] = {
        "activeHand": str(recipe.get("active_hand", "left")),
        "contactAnchor": str(recipe.get("contact_anchor", "none")),
        "contactStartFrame": int(recipe.get("contact_start_frame", recipe.get("contact_frame", -1))),
        "contactEndFrame": int(recipe.get("contact_end_frame", recipe.get("contact_frame", -1))),
        "palmAtContact": str(recipe.get("palm_at_contact", "camera")),
    }
    if "rig_contact_bias" in recipe:
        profile["rigContactBias"] = float(recipe["rig_contact_bias"])
    if "rig_stable_open_hand" in recipe:
        profile["rigStableOpenHand"] = bool(recipe["rig_stable_open_hand"])
    if "rig_soft_hand_curl" in recipe:
        profile["rigSoftHandCurl"] = bool(recipe["rig_soft_hand_curl"])
    if "rig_pointing_hand" in recipe:
        profile["rigPointingHand"] = bool(recipe["rig_pointing_hand"])
    return profile


def newest_recipe_by_gloss() -> dict[str, Path]:
    recipes: dict[str, Path] = {}
    for path in REFERENCE_DIRECTORY.rglob("*.recipe.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            gloss = str(payload.get("gloss", "")).strip().upper()
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            continue
        previous = recipes.get(gloss)
        if gloss and (previous is None or path.stat().st_mtime > previous.stat().st_mtime):
            recipes[gloss] = path
    return recipes


def sync() -> tuple[int, list[str]]:
    published = json.loads((MOTION_DIRECTORY / "published_signs.json").read_text(encoding="utf-8"))
    glosses = {str(value).strip().upper() for value in published.get("publishedGlosses", []) if str(value).strip()}
    recipes = newest_recipe_by_gloss()
    missing: list[str] = []
    updated = 0
    for gloss in sorted(glosses):
        recipe_path = recipes.get(gloss)
        motion_path = MOTION_DIRECTORY / f"{gloss.lower()}.motion.json"
        if recipe_path is None or not motion_path.is_file():
            missing.append(gloss)
            continue
        recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
        motion = json.loads(motion_path.read_text(encoding="utf-8"))
        motion["avatarProfile"] = profile_from_recipe(recipe)
        motion_path.write_text(json.dumps(motion, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        updated += 1
    return updated, missing


if __name__ == "__main__":
    count, missing_glosses = sync()
    print(f"Embedded avatar profiles for {count} published motions.")
    if missing_glosses:
        print("Missing recipe or motion: " + ", ".join(missing_glosses))
