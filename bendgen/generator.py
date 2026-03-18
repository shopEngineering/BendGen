"""JSON serialization (GSON-compatible) and ZIP packaging."""

import io
import json
import zipfile
from datetime import datetime
from uuid import UUID

from .models import Bend, Program, Die, Punch, Material
from .stock_tooling import STOCK_DIES, STOCK_PUNCHES, STOCK_MATERIALS


def _gson_date(dt: datetime | None) -> str | None:
    """Format a datetime in GSON's default US locale format: 'MMM dd, yyyy, h:mm:ss a'."""
    if dt is None:
        return None
    # GSON uses java.text.DateFormat.DEFAULT which is "MMM d, yyyy, h:mm:ss AM/PM"
    return dt.strftime("%b %d, %Y, %I:%M:%S %p")


def _serialize_uuid(obj):
    """JSON serializer that handles UUID and datetime."""
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return _gson_date(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def bend_to_dict(bend: Bend) -> dict:
    """Convert a Bend to a GSON-compatible dict matching real machine field order."""
    return {
        "materialThickness": bend.materialThickness,
        "desiredBendAngle": bend.desiredBendAngle,
        "angleCompensation": bend.angleCompensation,
        "angleCompensationReversed": bend.angleCompensationReversed,
        "punchToMaterialClearance": bend.punchToMaterialClearance,
        "additionalRetractAfterBend": bend.additionalRetractAfterBend,
        "bendWidth": bend.bendWidth,
        "backGaugeRefEdgeStop": bend.backGaugeRefEdgeStop,
        "backGaugeRefEdgeStopEnabled": bend.backGaugeRefEdgeStopEnabled,
        "backGaugeXPosition": bend.backGaugeXPosition,
        "backGaugeRPosition": bend.backGaugeRPosition,
        "backGaugeJogSpeed": bend.backGaugeJogSpeed,
        "notes": bend.notes,
        "xAxisNotes": bend.xAxisNotes,
        "rAxisNotes": bend.rAxisNotes,
        "overrideFinalBendPositionEnabled": bend.overrideFinalBendPositionEnabled,
        "overriddenFinalBendPosition": bend.overriddenFinalBendPosition,
        "dateCreated": _gson_date(bend.dateCreated),
        "punchId": str(bend.punchId) if bend.punchId else None,
        "dieId": str(bend.dieId) if bend.dieId else None,
        "materialId": str(bend.materialId) if bend.materialId else None,
        "id": str(bend.id),
        "name": bend.name,
        "stock": bend.stock,
    }


def program_to_dict(program: Program) -> dict:
    """Convert a Program to a GSON-compatible dict."""
    return {
        "id": str(program.id),
        "name": program.name,
        "bendIds": [str(bid) for bid in program.bendIds],
        "stock": program.stock,
    }


def die_to_dict(die: Die) -> dict:
    return {
        "heightInch": die.heightInch,
        "vdieOpeningInch": die.vdieOpeningInch,
        "id": str(die.id),
        "name": die.name,
        "stock": die.stock,
    }


def punch_to_dict(punch: Punch) -> dict:
    return {
        "heightInch": punch.heightInch,
        "id": str(punch.id),
        "name": punch.name,
        "stock": punch.stock,
    }


def material_to_dict(mat: Material) -> dict:
    return {
        "materialTensileStrengthPsi": mat.materialTensileStrengthPsi,
        "insideRadiusRuleOfThumb": mat.insideRadiusRuleOfThumb,
        "materialSpringback": mat.materialSpringback,
        "gaugeThickness": {str(k): v for k, v in mat.gaugeThickness.items()},
        "id": str(mat.id),
        "name": mat.name,
        "stock": mat.stock,
    }


def generate_json_files(
    bends: list[Bend],
    programs: list[Program],
    dies: list[Die] | None = None,
    punches: list[Punch] | None = None,
    materials: list[Material] | None = None,
) -> dict[str, str]:
    """Generate all JSON file contents. Returns {filename: json_string}."""
    if dies is None:
        dies = list(STOCK_DIES)
    if punches is None:
        punches = list(STOCK_PUNCHES)
    if materials is None:
        materials = list(STOCK_MATERIALS)

    return {
        "bends.json": json.dumps([bend_to_dict(b) for b in bends], indent=4),
        "programs.json": json.dumps([program_to_dict(p) for p in programs], indent=4),
        "dies.json": json.dumps([die_to_dict(d) for d in dies], indent=4),
        "punches.json": json.dumps([punch_to_dict(p) for p in punches], indent=4),
        "materials.json": json.dumps([material_to_dict(m) for m in materials], indent=4),
    }


def generate_zip(
    bends: list[Bend],
    programs: list[Program],
    dies: list[Die] | None = None,
    punches: list[Punch] | None = None,
    materials: list[Material] | None = None,
) -> bytes:
    """Generate a backup ZIP file compatible with BendControl restore."""
    files = generate_json_files(bends, programs, dies, punches, materials)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, content in files.items():
            zf.writestr(filename, content)
    return buf.getvalue()
