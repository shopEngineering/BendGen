"""Merge new bend/program data with existing BendControl backup data."""

import json
import zipfile
from io import BytesIO
from uuid import UUID

from .models import Bend, Program, Die, Punch, Material
from .generator import (
    bend_to_dict, program_to_dict, die_to_dict, punch_to_dict, material_to_dict,
    generate_zip,
)
from .stock_tooling import STOCK_DIES, STOCK_PUNCHES, STOCK_MATERIALS


def _strip_unknown(d: dict, model_class) -> dict:
    """Remove keys not in the model to avoid Pydantic validation errors."""
    known = set(model_class.model_fields.keys())
    return {k: v for k, v in d.items() if k in known}


def _parse_die(d: dict) -> Die:
    return Die(**_strip_unknown(d, Die))


def _parse_punch(d: dict) -> Punch:
    return Punch(**_strip_unknown(d, Punch))


def _parse_material(d: dict) -> Material:
    return Material(**_strip_unknown(d, Material))


def _parse_bend(d: dict) -> Bend:
    # Handle UUID fields that may be strings
    for field in ("id", "punchId", "dieId", "materialId"):
        if field in d and d[field] is not None:
            d[field] = str(d[field])
    # dateCreated comes as a GSON string — keep as-is by setting to now
    d.pop("dateCreated", None)
    # backGaugeJogSpeed — coerce to float
    if "backGaugeJogSpeed" in d:
        try:
            d["backGaugeJogSpeed"] = float(d["backGaugeJogSpeed"]) if d["backGaugeJogSpeed"] is not None else 0.0
        except (ValueError, TypeError):
            d["backGaugeJogSpeed"] = 0.0
    # Strip any unknown fields that our model doesn't expect
    known = set(Bend.model_fields.keys())
    d = {k: v for k, v in d.items() if k in known}
    return Bend(**d)


def _parse_program(d: dict) -> Program:
    if "id" in d:
        d["id"] = str(d["id"])
    if "bendIds" in d:
        d["bendIds"] = [str(bid) for bid in d["bendIds"]]
    d.pop("dateCreated", None)
    d = _strip_unknown(d, Program)
    return Program(**d)


def load_from_zip(zip_bytes: bytes) -> dict:
    """Load existing data from a BendControl backup ZIP.

    Returns dict with keys: bends, programs, dies, punches, materials
    """
    result = {"bends": [], "programs": [], "dies": [], "punches": [], "materials": []}
    with zipfile.ZipFile(BytesIO(zip_bytes), "r") as zf:
        for name in zf.namelist():
            data = json.loads(zf.read(name))
            if name == "bends.json":
                result["bends"] = [_parse_bend(d) for d in data]
            elif name == "programs.json":
                result["programs"] = [_parse_program(d) for d in data]
            elif name == "dies.json":
                result["dies"] = [_parse_die(d) for d in data]
            elif name == "punches.json":
                result["punches"] = [_parse_punch(d) for d in data]
            elif name == "materials.json":
                result["materials"] = [_parse_material(d) for d in data]
    return result


def merge_data(
    existing_bends: list[Bend],
    existing_programs: list[Program],
    existing_dies: list[Die],
    existing_punches: list[Punch],
    existing_materials: list[Material],
    new_bends: list[Bend],
    new_programs: list[Program],
    new_dies: list[Die] | None = None,
    new_punches: list[Punch] | None = None,
    new_materials: list[Material] | None = None,
) -> tuple[list[Bend], list[Program], list[Die], list[Punch], list[Material]]:
    """Merge new entities with existing ones. New entities with matching IDs replace existing."""
    def _merge_lists(existing, new):
        by_id = {item.id: item for item in existing}
        for item in new:
            by_id[item.id] = item
        return list(by_id.values())

    dies = _merge_lists(existing_dies, new_dies or [])
    punches = _merge_lists(existing_punches, new_punches or [])
    materials = _merge_lists(existing_materials, new_materials or [])
    bends = _merge_lists(existing_bends, new_bends)
    programs = _merge_lists(existing_programs, new_programs)

    return bends, programs, dies, punches, materials


def merge_and_generate_zip(
    existing_zip_bytes: bytes | None,
    new_bends: list[Bend],
    new_programs: list[Program],
) -> bytes:
    """Merge new bends/programs with an existing backup and generate a new ZIP."""
    if existing_zip_bytes:
        existing = load_from_zip(existing_zip_bytes)
    else:
        existing = {
            "bends": [],
            "programs": [],
            "dies": list(STOCK_DIES),
            "punches": list(STOCK_PUNCHES),
            "materials": list(STOCK_MATERIALS),
        }

    bends, programs, dies, punches, materials = merge_data(
        existing["bends"], existing["programs"],
        existing["dies"], existing["punches"], existing["materials"],
        new_bends, new_programs,
    )

    return generate_zip(bends, programs, dies, punches, materials)
