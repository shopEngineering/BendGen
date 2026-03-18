"""Flask web application for bend program generation."""

import base64
import json
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from flask import Flask, render_template, request, jsonify, send_file

from .models import Bend, Program, Die, Punch, Material, validate_bend, LIMITS
from .backup_name import make_backup_filename
from .stock_tooling import STOCK_DIES, STOCK_PUNCHES, STOCK_MATERIALS
from .generator import (
    generate_zip, bend_to_dict, program_to_dict,
    die_to_dict, punch_to_dict, material_to_dict,
)
from .merge import load_from_zip, merge_and_generate_zip
from .dxf_analyzer import analyze_dxf, analysis_to_bend_dicts, analysis_to_summary, debug_dxf
from .image_analyzer import analyze_image, has_ocr

app = Flask(__name__)

# --- Local persistence ---
_DATA_DIR = Path.home() / ".bendgen"
_DATA_FILE = _DATA_DIR / "data.json"


def _save_state():
    """Persist current state to ~/.bendgen/data.json."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "bends": [bend_to_dict(b) for b in _state["bends"]],
        "programs": [program_to_dict(p) for p in _state["programs"]],
        "dies": [die_to_dict(d) for d in _state["dies"]],
        "punches": [punch_to_dict(p) for p in _state["punches"]],
        "materials": [material_to_dict(m) for m in _state["materials"]],
    }
    _DATA_FILE.write_text(json.dumps(data, indent=2))


def _load_state():
    """Load state from ~/.bendgen/data.json if it exists."""
    if not _DATA_FILE.exists():
        return
    try:
        data = json.loads(_DATA_FILE.read_text())
    except Exception as e:
        print(f"Warning: could not load {_DATA_FILE}: {e}")
        return

    # Reconstruct models from saved dicts
    if "dies" in data and data["dies"]:
        _state["dies"] = [
            Die(id=d["id"], name=d["name"], heightInch=d["heightInch"],
                vdieOpeningInch=d["vdieOpeningInch"], stock=d.get("stock", False))
            for d in data["dies"]
        ]
    if "punches" in data and data["punches"]:
        _state["punches"] = [
            Punch(id=p["id"], name=p["name"], heightInch=p["heightInch"],
                  stock=p.get("stock", False))
            for p in data["punches"]
        ]
    if "materials" in data and data["materials"]:
        _state["materials"] = [
            Material(
                id=m["id"], name=m["name"],
                materialTensileStrengthPsi=m["materialTensileStrengthPsi"],
                insideRadiusRuleOfThumb=m["insideRadiusRuleOfThumb"],
                materialSpringback=m["materialSpringback"],
                gaugeThickness={int(k): v for k, v in m.get("gaugeThickness", {}).items()},
                stock=m.get("stock", False),
            )
            for m in data["materials"]
        ]
    if "programs" in data and data["programs"]:
        _state["programs"] = [
            Program(id=p["id"], name=p["name"],
                    bendIds=p.get("bendIds", []), stock=p.get("stock", False))
            for p in data["programs"]
        ]
    if "bends" in data and data["bends"]:
        _state["bends"] = [
            Bend(
                id=b["id"], name=b.get("name", ""),
                notes=b.get("notes", ""),
                desiredBendAngle=b.get("desiredBendAngle", 90.0),
                angleCompensation=b.get("angleCompensation", 0.0),
                angleCompensationReversed=b.get("angleCompensationReversed", False),
                materialThickness=b.get("materialThickness", 0.06),
                punchToMaterialClearance=b.get("punchToMaterialClearance", 0.1),
                additionalRetractAfterBend=b.get("additionalRetractAfterBend", 0.0),
                bendWidth=b.get("bendWidth", 12.0),
                backGaugeRefEdgeStop=b.get("backGaugeRefEdgeStop", "G54"),
                backGaugeRefEdgeStopEnabled=b.get("backGaugeRefEdgeStopEnabled", False),
                backGaugeXPosition=b.get("backGaugeXPosition", 0.0),
                backGaugeRPosition=b.get("backGaugeRPosition", 0.0),
                overrideFinalBendPositionEnabled=b.get("overrideFinalBendPositionEnabled", False),
                overriddenFinalBendPosition=b.get("overriddenFinalBendPosition", 0.0),
                punchId=b.get("punchId"),
                dieId=b.get("dieId"),
                materialId=b.get("materialId"),
            )
            for b in data["bends"]
        ]
    print(f"Loaded state from {_DATA_FILE}: {len(_state['programs'])} programs, "
          f"{len(_state['bends'])} bends, {len(_state['dies'])} dies, "
          f"{len(_state['punches'])} punches, {len(_state['materials'])} materials")


# In-memory session state
_state = {
    "bends": [],       # list[Bend]
    "programs": [],    # list[Program]
    "dies": list(STOCK_DIES),
    "punches": list(STOCK_PUNCHES),
    "materials": list(STOCK_MATERIALS),
    "existing_zip": None,  # bytes | None — imported backup for merging
}

# Load persisted state on startup
_load_state()


def _reset_state():
    _state["bends"] = []
    _state["programs"] = []
    _state["dies"] = list(STOCK_DIES)
    _state["punches"] = list(STOCK_PUNCHES)
    _state["materials"] = list(STOCK_MATERIALS)
    _state["existing_zip"] = None
    _save_state()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/help")
def help_page():
    return render_template("help.html")


@app.route("/api/tooling")
def get_tooling():
    """Return all available tooling for dropdowns."""
    return jsonify({
        "dies": [die_to_dict(d) for d in _state["dies"]],
        "punches": [punch_to_dict(p) for p in _state["punches"]],
        "materials": [material_to_dict(m) for m in _state["materials"]],
        "limits": LIMITS,
    })


@app.route("/api/programs", methods=["GET"])
def get_programs():
    return jsonify({
        "programs": [program_to_dict(p) for p in _state["programs"]],
        "bends": [bend_to_dict(b) for b in _state["bends"]],
    })


@app.route("/api/program", methods=["POST"])
def save_program():
    """Create or update a program with its bends."""
    data = request.json
    program_name = data.get("name", "Untitled Program")
    program_id = data.get("id") or str(uuid4())
    bend_defs = data.get("bends", [])

    new_bends = []
    errors = []

    for i, bd in enumerate(bend_defs):
        bend = Bend(
            id=bd.get("id") or str(uuid4()),
            name=bd.get("name", f"Bend {i + 1}"),
            notes=bd.get("notes", ""),
            desiredBendAngle=float(bd.get("desiredBendAngle", 90.0)),
            angleCompensation=float(bd.get("angleCompensation", 0.0)),
            angleCompensationReversed=bool(bd.get("angleCompensationReversed", False)),
            materialThickness=float(bd.get("materialThickness", 0.06)),
            punchToMaterialClearance=float(bd.get("punchToMaterialClearance", 0.1)),
            additionalRetractAfterBend=float(bd.get("additionalRetractAfterBend", 0.0)),
            bendWidth=float(bd.get("bendWidth", 12.0)),
            backGaugeRefEdgeStop=bd.get("backGaugeRefEdgeStop", "G54"),
            backGaugeRefEdgeStopEnabled=bool(bd.get("backGaugeRefEdgeStopEnabled", False)),
            backGaugeXPosition=float(bd.get("backGaugeXPosition", 0.0)),
            backGaugeRPosition=float(bd.get("backGaugeRPosition", 0.0)),
            backGaugeJogSpeed=bd.get("backGaugeJogSpeed", ""),
            overrideFinalBendPositionEnabled=bool(bd.get("overrideFinalBendPositionEnabled", False)),
            overriddenFinalBendPosition=float(bd.get("overriddenFinalBendPosition", 0.0)),
            punchId=bd.get("punchId"),
            dieId=bd.get("dieId"),
            materialId=bd.get("materialId"),
        )
        bend_errors = validate_bend(bend)
        if bend_errors:
            errors.append({"bend_index": i, "name": bend.name, "errors": bend_errors})
        new_bends.append(bend)

    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    # Remove any old bends/program with same program ID
    _state["programs"] = [p for p in _state["programs"] if str(p.id) != program_id]
    old_bend_ids = set()
    for p in _state["programs"]:
        old_bend_ids.update(str(bid) for bid in p.bendIds)
    # Only remove bends that aren't used by other programs
    new_bend_ids = {str(b.id) for b in new_bends}
    _state["bends"] = [b for b in _state["bends"] if str(b.id) in old_bend_ids or str(b.id) in new_bend_ids]

    # Add the new bends and program
    for bend in new_bends:
        _state["bends"] = [b for b in _state["bends"] if b.id != bend.id]
        _state["bends"].append(bend)

    program = Program(
        id=program_id,
        name=program_name,
        bendIds=[b.id for b in new_bends],
    )
    _state["programs"].append(program)
    _save_state()

    return jsonify({"ok": True, "program": program_to_dict(program)})


@app.route("/api/program/<program_id>", methods=["DELETE"])
def delete_program(program_id):
    """Delete a program and its bends (if not used elsewhere)."""
    program = next((p for p in _state["programs"] if str(p.id) == program_id), None)
    if not program:
        return jsonify({"ok": False, "error": "Program not found"}), 404

    _state["programs"] = [p for p in _state["programs"] if str(p.id) != program_id]

    # Find bend IDs still used by remaining programs
    used_bend_ids = set()
    for p in _state["programs"]:
        used_bend_ids.update(str(bid) for bid in p.bendIds)

    # Remove bends only used by the deleted program
    _state["bends"] = [b for b in _state["bends"] if str(b.id) in used_bend_ids]
    _save_state()

    return jsonify({"ok": True})


@app.route("/api/die", methods=["POST"])
def save_die():
    """Create or update a custom die."""
    data = request.json
    die_id = data.get("id")
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Name is required"}), 400

    height = float(data.get("heightInch", 0))
    opening = float(data.get("vdieOpeningInch", 0))
    lo_h, hi_h = LIMITS["dieHeightInch"]
    lo_o, hi_o = LIMITS["vdieOpeningInch"]
    if not (lo_h <= height <= hi_h):
        return jsonify({"ok": False, "error": f"Height must be between {lo_h} and {hi_h}"}), 400
    if not (lo_o <= opening <= hi_o):
        return jsonify({"ok": False, "error": f"V-die opening must be between {lo_o} and {hi_o}"}), 400

    if die_id:
        # Update existing
        for i, d in enumerate(_state["dies"]):
            if str(d.id) == die_id:
                _state["dies"][i] = Die(id=die_id, name=name, heightInch=height, vdieOpeningInch=opening, stock=d.stock)
                _save_state()
                return jsonify({"ok": True, "die": die_to_dict(_state["dies"][i])})
        return jsonify({"ok": False, "error": "Die not found"}), 404
    else:
        die = Die(name=name, heightInch=height, vdieOpeningInch=opening, stock=False)
        _state["dies"].append(die)
        _save_state()
        return jsonify({"ok": True, "die": die_to_dict(die)})


@app.route("/api/die/<die_id>", methods=["DELETE"])
def delete_die(die_id):
    """Delete a custom die (stock dies cannot be deleted)."""
    die = next((d for d in _state["dies"] if str(d.id) == die_id), None)
    if not die:
        return jsonify({"ok": False, "error": "Die not found"}), 404
    if die.stock:
        return jsonify({"ok": False, "error": "Cannot delete stock tooling"}), 400
    _state["dies"] = [d for d in _state["dies"] if str(d.id) != die_id]
    _save_state()
    return jsonify({"ok": True})


@app.route("/api/punch", methods=["POST"])
def save_punch():
    """Create or update a custom punch."""
    data = request.json
    punch_id = data.get("id")
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Name is required"}), 400

    height = float(data.get("heightInch", 0))
    lo, hi = LIMITS["punchHeightInch"]
    if not (lo <= height <= hi):
        return jsonify({"ok": False, "error": f"Height must be between {lo} and {hi}"}), 400

    if punch_id:
        for i, p in enumerate(_state["punches"]):
            if str(p.id) == punch_id:
                _state["punches"][i] = Punch(id=punch_id, name=name, heightInch=height, stock=p.stock)
                _save_state()
                return jsonify({"ok": True, "punch": punch_to_dict(_state["punches"][i])})
        return jsonify({"ok": False, "error": "Punch not found"}), 404
    else:
        punch = Punch(name=name, heightInch=height, stock=False)
        _state["punches"].append(punch)
        _save_state()
        return jsonify({"ok": True, "punch": punch_to_dict(punch)})


@app.route("/api/punch/<punch_id>", methods=["DELETE"])
def delete_punch(punch_id):
    """Delete a custom punch (stock punches cannot be deleted)."""
    punch = next((p for p in _state["punches"] if str(p.id) == punch_id), None)
    if not punch:
        return jsonify({"ok": False, "error": "Punch not found"}), 404
    if punch.stock:
        return jsonify({"ok": False, "error": "Cannot delete stock tooling"}), 400
    _state["punches"] = [p for p in _state["punches"] if str(p.id) != punch_id]
    _save_state()
    return jsonify({"ok": True})


@app.route("/api/material", methods=["POST"])
def save_material():
    """Create or update a custom material."""
    data = request.json
    mat_id = data.get("id")
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Name is required"}), 400

    tensile = float(data.get("materialTensileStrengthPsi", 0))
    radius_rule = float(data.get("insideRadiusRuleOfThumb", 0))
    springback = float(data.get("materialSpringback", 0))
    lo_s, hi_s = LIMITS["materialSpringback"]
    if tensile <= 0:
        return jsonify({"ok": False, "error": "Tensile strength must be positive"}), 400
    if radius_rule < 0:
        return jsonify({"ok": False, "error": "Inside radius rule of thumb must be non-negative"}), 400
    if not (lo_s <= springback <= hi_s):
        return jsonify({"ok": False, "error": f"Springback must be between {lo_s} and {hi_s}"}), 400

    # Parse gaugeThickness: keys are gauge numbers (int), values are thickness (float)
    raw_gt = data.get("gaugeThickness", {})
    gauge_thickness = {int(k): float(v) for k, v in raw_gt.items() if v}

    if mat_id:
        for i, m in enumerate(_state["materials"]):
            if str(m.id) == mat_id:
                _state["materials"][i] = Material(
                    id=mat_id, name=name,
                    materialTensileStrengthPsi=tensile,
                    insideRadiusRuleOfThumb=radius_rule,
                    materialSpringback=springback,
                    gaugeThickness=gauge_thickness,
                    stock=m.stock,
                )
                _save_state()
                return jsonify({"ok": True, "material": material_to_dict(_state["materials"][i])})
        return jsonify({"ok": False, "error": "Material not found"}), 404
    else:
        mat = Material(
            name=name,
            materialTensileStrengthPsi=tensile,
            insideRadiusRuleOfThumb=radius_rule,
            materialSpringback=springback,
            gaugeThickness=gauge_thickness,
            stock=False,
        )
        _state["materials"].append(mat)
        _save_state()
        return jsonify({"ok": True, "material": material_to_dict(mat)})


@app.route("/api/material/<mat_id>", methods=["DELETE"])
def delete_material(mat_id):
    """Delete a custom material (stock materials cannot be deleted)."""
    mat = next((m for m in _state["materials"] if str(m.id) == mat_id), None)
    if not mat:
        return jsonify({"ok": False, "error": "Material not found"}), 404
    if mat.stock:
        return jsonify({"ok": False, "error": "Cannot delete stock tooling"}), 400
    _state["materials"] = [m for m in _state["materials"] if str(m.id) != mat_id]
    _save_state()
    return jsonify({"ok": True})


@app.route("/api/debug-dxf", methods=["POST"])
def debug_dxf_upload():
    """Debug endpoint: show raw line info from a DXF file."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400
    dxf_bytes = request.files["file"].read()
    try:
        info = debug_dxf(dxf_bytes)
        return jsonify({"ok": True, **info})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/analyze-dxf", methods=["POST"])
def analyze_dxf_upload():
    """Analyze a DXF file and auto-create a program with bends.

    Accepts multipart form with:
      - file: the DXF file
      - ref_edge (optional): "left" or "right" for BG X reference
      - thickness (optional): material thickness override in inches
    """
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400

    dxf_file = request.files["file"]
    filename = dxf_file.filename or "drawing.dxf"
    dxf_bytes = dxf_file.read()

    thickness_str = request.form.get("thickness", "")
    thickness_override = float(thickness_str) if thickness_str else None

    analysis = analyze_dxf(file_bytes=dxf_bytes)

    if analysis.errors:
        return jsonify({"ok": False, "errors": analysis.errors}), 400

    # Try to match material keyword to a stock material ID
    matched_material_id = None
    if analysis.material_match:
        for mat in _state["materials"]:
            if analysis.material_match.lower() in mat.name.lower():
                matched_material_id = str(mat.id)
                break

    # Generate bend dicts from analysis (default order, left edge)
    bend_defs = analysis_to_bend_dicts(
        analysis,
        bend_plan=None,
        thickness_override=thickness_override,
        default_material_id=matched_material_id,
    )

    # Derive program name from filename (strip extension and "Flat-Pattern - " prefix)
    prog_name = filename.rsplit(".", 1)[0]
    for prefix in ("Flat-Pattern - ", "Flat-Pattern-", "FlatPattern-"):
        if prog_name.startswith(prefix):
            prog_name = prog_name[len(prefix):]

    summary = analysis_to_summary(analysis)
    summary["program_name"] = prog_name
    summary["bend_defs"] = bend_defs
    summary["matched_material_id"] = matched_material_id

    # Store DXF bytes in session so edge/thickness changes can re-analyze
    _state["_last_dxf"] = dxf_bytes
    _state["_last_dxf_filename"] = filename

    return jsonify({"ok": True, "analysis": summary})


@app.route("/api/reanalyze-dxf", methods=["POST"])
def reanalyze_dxf():
    """Re-analyze the last uploaded DXF with bend plan and thickness.

    Accepts JSON: {
        bend_plan: [{index, edge}, ...],  // bend order + per-bend edge
        thickness: float | null
    }
    """
    dxf_bytes = _state.get("_last_dxf")
    if not dxf_bytes:
        return jsonify({"ok": False, "error": "No DXF file loaded. Upload one first."}), 400

    data = request.json or {}
    bend_plan = data.get("bend_plan")  # [{index: 0, edge: "left"}, ...]
    thickness_override = data.get("thickness")
    if thickness_override is not None:
        thickness_override = float(thickness_override)

    analysis = analyze_dxf(file_bytes=dxf_bytes)
    if analysis.errors:
        return jsonify({"ok": False, "errors": analysis.errors}), 400

    matched_material_id = None
    if analysis.material_match:
        for mat in _state["materials"]:
            if analysis.material_match.lower() in mat.name.lower():
                matched_material_id = str(mat.id)
                break

    bend_defs = analysis_to_bend_dicts(
        analysis,
        bend_plan=bend_plan,
        thickness_override=thickness_override,
        default_material_id=matched_material_id,
    )

    filename = _state.get("_last_dxf_filename", "drawing.dxf")
    prog_name = filename.rsplit(".", 1)[0]
    for prefix in ("Flat-Pattern - ", "Flat-Pattern-", "FlatPattern-"):
        if prog_name.startswith(prefix):
            prog_name = prog_name[len(prefix):]

    summary = analysis_to_summary(analysis)
    summary["program_name"] = prog_name
    summary["bend_defs"] = bend_defs
    summary["matched_material_id"] = matched_material_id

    return jsonify({"ok": True, "analysis": summary})


@app.route("/api/analyze-image", methods=["POST"])
def analyze_image_upload():
    """Analyze an image of a drawing using local OCR."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400

    img_file = request.files["file"]
    filename = img_file.filename or "drawing.png"
    img_bytes = img_file.read()

    # Determine media type for data URL
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    media_map = {
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
    }
    media_type = media_map.get(ext, "image/png")

    # Run local OCR analysis
    try:
        ocr_result = analyze_image(img_bytes)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Image analysis failed: {e}"}), 500

    # Build image data URL for frontend display
    b64_img = base64.b64encode(img_bytes).decode()
    image_data_url = f"data:{media_type};base64,{b64_img}"

    # Match material to stock
    matched_material_id = None
    ocr_material = ocr_result.get("material")
    if ocr_material:
        ocr_mat_lower = ocr_material.lower()
        for mat in _state["materials"]:
            if ocr_mat_lower in mat.name.lower() or mat.name.lower() in ocr_mat_lower:
                matched_material_id = str(mat.id)
                break

    # Look up thickness from gauge if we have a matched material and gauge
    ocr_gauge = ocr_result.get("gauge")
    ocr_thickness = ocr_result.get("thickness_inch")
    if ocr_gauge and matched_material_id and not ocr_thickness:
        matched_mat = next((m for m in _state["materials"] if str(m.id) == matched_material_id), None)
        if matched_mat and ocr_gauge in matched_mat.gaugeThickness:
            ocr_thickness = matched_mat.gaugeThickness[ocr_gauge]

    # Build bend defs from OCR results
    bends_raw = ocr_result.get("bends", [])
    bend_defs = []
    for i, b in enumerate(bends_raw):
        direction = (b.get("direction") or "UP").upper()
        if direction not in ("UP", "DOWN"):
            direction = "UP"
        angle = float(b.get("angle") or 90)
        label = b.get("label") or f"Bend {i + 1}"

        bend_defs.append({
            "id": str(uuid4()),
            "name": label,
            "notes": f"Direction: {direction}; From image OCR",
            "desiredBendAngle": angle,
            "angleCompensation": 0.0,
            "angleCompensationReversed": direction == "DOWN",
            "materialThickness": ocr_thickness or 0.06,
            "punchToMaterialClearance": 0.1,
            "additionalRetractAfterBend": 0.0,
            "bendWidth": 12.0,
            "backGaugeRefEdgeStop": "G54",
            "backGaugeRefEdgeStopEnabled": False,
            "backGaugeXPosition": 0.0,
            "backGaugeRPosition": 0.0,
            "backGaugeJogSpeed": "",
            "overrideFinalBendPositionEnabled": False,
            "overriddenFinalBendPosition": 0.0,
            "punchId": None,
            "dieId": None,
            "materialId": matched_material_id,
        })

    # Derive program name
    prog_name = ocr_result.get("part_name")
    if not prog_name:
        prog_name = filename.rsplit(".", 1)[0]

    # Build warnings
    warnings = []
    if not ocr_result.get("ocr_available"):
        warnings.append("OCR not available — install pytesseract + Tesseract for auto-detection. Add bends manually below.")

    summary = {
        "program_name": prog_name,
        "bend_count": len(bend_defs),
        "bends": [
            {
                "index": i,
                "direction": (b.get("direction") or "UP").upper(),
                "angle": float(b.get("angle") or 90),
                "label": b.get("label") or f"Bend {i + 1}",
                "bend_width": None,
            }
            for i, b in enumerate(bends_raw)
        ],
        "gauge": ocr_gauge,
        "thickness_inch": ocr_thickness,
        "material_match": ocr_material,
        "matched_material_id": matched_material_id,
        "image_data_url": image_data_url,
        "svg": None,
        "part_width": None,
        "part_length": None,
        "has_horizontal_bends": False,
        "warnings": warnings,
        "bend_defs": bend_defs,
        "ocr_text": ocr_result.get("ocr_text", ""),
        "dimensions": ocr_result.get("dimensions", []),
    }

    return jsonify({"ok": True, "analysis": summary})


@app.route("/api/import", methods=["POST"])
def import_backup():
    """Import an existing BendControl backup ZIP for merging."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400

    zip_bytes = request.files["file"].read()
    try:
        existing = load_from_zip(zip_bytes)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Invalid ZIP: {e}"}), 400

    _state["existing_zip"] = zip_bytes
    _state["dies"] = existing["dies"] if existing["dies"] else list(STOCK_DIES)
    _state["punches"] = existing["punches"] if existing["punches"] else list(STOCK_PUNCHES)
    _state["materials"] = existing["materials"] if existing["materials"] else list(STOCK_MATERIALS)

    # Load existing bends and programs into the editor
    _state["bends"] = existing["bends"]
    _state["programs"] = existing["programs"]
    _save_state()

    return jsonify({
        "ok": True,
        "counts": {
            "bends": len(existing["bends"]),
            "programs": len(existing["programs"]),
            "dies": len(_state["dies"]),
            "punches": len(_state["punches"]),
            "materials": len(_state["materials"]),
        },
    })


@app.route("/api/export", methods=["POST"])
def export_zip():
    """Generate and download a backup ZIP with all current data."""
    zip_bytes = generate_zip(
        _state["bends"],
        _state["programs"],
        _state["dies"],
        _state["punches"],
        _state["materials"],
    )
    filename = make_backup_filename()
    return send_file(
        BytesIO(zip_bytes),
        mimetype="application/zip",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/api/reset", methods=["POST"])
def reset():
    """Reset all data to defaults."""
    _reset_state()
    return jsonify({"ok": True})


def main():
    print("BendGen - Bend Program Generator for Langmuir BendControl")
    print("Open http://localhost:5050 in your browser")
    app.run(host="0.0.0.0", port=5050, debug=True)


if __name__ == "__main__":
    main()
