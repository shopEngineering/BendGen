"""Analyze DXF flat-pattern drawings to extract bend definitions.

Convention expected from the designer:
  - Bend lines use the HIDDEN linetype (dashed lines).
  - Each bend line has a nearby TEXT/MTEXT annotation:
        {UP|DOWN}  {angle}°  R {radius}
    Example: "DOWN 90° R 0.06"
  - A title TEXT near the top of the drawing may contain gauge info:
        "18 gauge", "16 ga", etc.  Optionally with material: "18 ga SS"
  - DIMENSION entities between bend lines / edges give backgauge X distances.

If annotations are missing the module falls back to geometric analysis.
"""

import math
import re
from dataclasses import dataclass, field
from uuid import uuid4

try:
    import ezdxf
except ImportError:
    ezdxf = None


# --- Gauge-to-thickness lookup (inches) ---

GAUGE_THICKNESS = {
    7: 0.1793,
    8: 0.1644,
    9: 0.1495,
    10: 0.1345,
    11: 0.1196,
    12: 0.1046,
    13: 0.0897,
    14: 0.0747,
    15: 0.0673,
    16: 0.0598,
    17: 0.0538,
    18: 0.0478,
    19: 0.0418,
    20: 0.0359,
    21: 0.0329,
    22: 0.0299,
    23: 0.0269,
    24: 0.0239,
    25: 0.0209,
    26: 0.0179,
    27: 0.0164,
    28: 0.0149,
}

# Material keyword matching
MATERIAL_KEYWORDS = {
    "ss": "Stainless Steel (e.g. 304)",
    "stainless": "Stainless Steel (e.g. 304)",
    "304": "Stainless Steel (e.g. 304)",
    "cr": "Cold Rolled Steel (e.g. A1008)",
    "cold rolled": "Cold Rolled Steel (e.g. A1008)",
    "crs": "Cold Rolled Steel (e.g. A1008)",
    "a1008": "Cold Rolled Steel (e.g. A1008)",
    "hr": "Hot Rolled Steel (e.g. A36)",
    "hot rolled": "Hot Rolled Steel (e.g. A36)",
    "hrs": "Hot Rolled Steel (e.g. A36)",
    "a36": "Hot Rolled Steel (e.g. A36)",
    "aluminum": "Soft Aluminum (e.g. 3003 H14)",
    "aluminium": "Soft Aluminum (e.g. 3003 H14)",
    "al": "Soft Aluminum (e.g. 3003 H14)",
    "3003": "Soft Aluminum (e.g. 3003 H14)",
}


@dataclass
class DxfBendLine:
    """A bend line extracted from the DXF geometry."""
    x: float  # X position (midpoint for non-vertical lines)
    y_start: float
    y_end: float
    x_start: float = 0.0  # actual start X of the line
    x_end: float = 0.0    # actual end X of the line
    direction: str = ""  # "UP" or "DOWN"
    angle: float = 90.0  # bend angle in degrees
    radius: float = 0.0  # inside bend radius
    label_text: str = ""  # raw label text found nearby


@dataclass
class DxfAnalysis:
    """Result of analyzing a DXF flat-pattern drawing."""
    bend_lines: list[DxfBendLine] = field(default_factory=list)
    gauge: int | None = None
    thickness_inch: float | None = None
    material_keyword: str = ""
    material_match: str = ""  # matched stock material name
    title_text: str = ""
    part_width: float = 0.0  # Y-span of the part (bend width)
    part_length: float = 0.0  # X-span of the part
    x_min: float = 0.0
    x_max: float = 0.0
    y_min: float = 0.0
    y_max: float = 0.0
    outline_lines: list = field(default_factory=list)  # [(start, end), ...]
    arcs: list = field(default_factory=list)  # raw arc data for SVG
    circles: list = field(default_factory=list)  # raw circle data for SVG
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _ensure_ezdxf():
    if ezdxf is None:
        raise ImportError(
            "ezdxf is required for DXF analysis. "
            "Install it with: pip install ezdxf"
        )


def _parse_bend_label(text: str) -> dict:
    """Parse a bend annotation like 'DOWN 90° R 0.06' or 'UP 45° R 0.06'.

    Returns dict with keys: direction, angle, radius (any may be None).
    """
    result = {"direction": None, "angle": None, "radius": None}

    t = text.strip().upper()

    # Direction
    if "UP" in t.split():
        result["direction"] = "UP"
    elif "DOWN" in t.split():
        result["direction"] = "DOWN"

    # Angle — look for number followed by ° or "DEG"
    angle_match = re.search(r'(\d+(?:\.\d+)?)\s*[°\u00b0]', t)
    if not angle_match:
        angle_match = re.search(r'(\d+(?:\.\d+)?)\s*DEG', t)
    if angle_match:
        result["angle"] = float(angle_match.group(1))

    # Radius — look for R followed by number
    r_match = re.search(r'R\s*(\d+(?:\.\d+)?)', t)
    if r_match:
        result["radius"] = float(r_match.group(1))

    return result


def _parse_title_text(text: str) -> dict:
    """Parse a title annotation like '18 gauge' or '18 ga SS'.

    Returns dict with keys: gauge, material_keyword.
    """
    result = {"gauge": None, "material_keyword": ""}
    t = text.strip()

    # Gauge — look for number followed by gauge/ga/g
    ga_match = re.search(r'(\d+)\s*(?:gauge|ga\.?|g)\b', t, re.IGNORECASE)
    if ga_match:
        result["gauge"] = int(ga_match.group(1))

    # Material keyword — check for known keywords in the text
    t_lower = t.lower()
    for keyword, _ in MATERIAL_KEYWORDS.items():
        # Check as whole word for short keywords
        if len(keyword) <= 3:
            if re.search(r'\b' + re.escape(keyword) + r'\b', t_lower):
                result["material_keyword"] = keyword
                break
        else:
            if keyword in t_lower:
                result["material_keyword"] = keyword
                break

    return result


def _find_nearest_text_to_line(texts: list, line_x: float, line_y_mid: float,
                                max_distance: float = 2.0) -> str | None:
    """Find the TEXT entity closest to a bend line's midpoint."""
    best = None
    best_dist = max_distance

    for text_info in texts:
        tx, ty, content = text_info
        dist = math.sqrt((tx - line_x) ** 2 + (ty - line_y_mid) ** 2)
        if dist < best_dist:
            # Only consider texts that look like bend labels
            upper = content.upper().strip()
            if "UP" in upper or "DOWN" in upper:
                best = content
                best_dist = dist

    return best



def _make_bend_from_line(start, end) -> DxfBendLine | None:
    """Create a DxfBendLine from start/end points.

    Accepts either Vec3 objects (.x, .y) or (x, y) tuples.
    Returns None if the line is too short.
    """
    sx, sy = (start[0], start[1]) if isinstance(start, tuple) else (start.x, start.y)
    ex, ey = (end[0], end[1]) if isinstance(end, tuple) else (end.x, end.y)
    dx = abs(ex - sx)
    dy = abs(ey - sy)

    if dx < 0.001:
        # Vertical bend line
        return DxfBendLine(
            x=sx,
            y_start=min(sy, ey),
            y_end=max(sy, ey),
            x_start=sx,
            x_end=sx,
        )
    elif dy < 0.001:
        # Horizontal bend line
        return DxfBendLine(
            x=(sx + ex) / 2,
            y_start=sy,
            y_end=sy,
            x_start=min(sx, ex),
            x_end=max(sx, ex),
        )
    else:
        # Angled line — use midpoint
        return DxfBendLine(
            x=(sx + ex) / 2,
            y_start=min(sy, ey),
            y_end=max(sy, ey),
            x_start=sx,
            x_end=ex,
        )


class _SimplePoint:
    """Minimal point class with .x and .y to match ezdxf Vec3 interface."""
    __slots__ = ("x", "y")
    def __init__(self, x, y):
        self.x = x
        self.y = y


def _bulge_to_arc(x1, y1, x2, y2, bulge):
    """Convert a polyline segment with bulge to arc parameters (cx, cy, r, start_deg, end_deg)."""
    dx = x2 - x1
    dy = y2 - y1
    chord = math.sqrt(dx * dx + dy * dy)
    if chord < 1e-9:
        return None
    sagitta = abs(bulge) * chord / 2
    r = (chord * chord / 4 + sagitta * sagitta) / (2 * sagitta)
    # Midpoint of chord
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    # Unit normal to chord (perpendicular)
    nx, ny = -dy / chord, dx / chord
    # Distance from midpoint to center
    d = r - sagitta
    if bulge > 0:
        cx = mx + d * nx
        cy = my + d * ny
    else:
        cx = mx - d * nx
        cy = my - d * ny
    # Compute start/end angles
    start_angle = math.degrees(math.atan2(y1 - cy, x1 - cx))
    end_angle = math.degrees(math.atan2(y2 - cy, x2 - cx))
    if bulge < 0:
        start_angle, end_angle = end_angle, start_angle
    return (cx, cy, r, start_angle % 360, end_angle % 360)


def debug_dxf(file_bytes: bytes) -> dict:
    """Return raw entity info from a DXF for debugging detection issues."""
    _ensure_ezdxf()
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        doc = ezdxf.readfile(tmp_path)
    finally:
        os.unlink(tmp_path)

    msp = doc.modelspace()
    lines = []
    other_entities = {}
    linetypes_used = set()
    layers_used = set()

    for entity in msp:
        etype = entity.dxftype()
        if etype == "LINE":
            lt = entity.dxf.get("linetype", "")
            lw = entity.dxf.get("lineweight", -1)
            layer = entity.dxf.get("layer", "")
            color = entity.dxf.get("color", -1)
            s, e = entity.dxf.start, entity.dxf.end
            dx = abs(e.x - s.x)
            dy = abs(e.y - s.y)
            length = math.sqrt(dx*dx + dy*dy)
            orient = "vertical" if dx < 0.01 else ("horizontal" if dy < 0.01 else "angled")
            lines.append({
                "linetype": lt, "lineweight": lw, "layer": layer, "color": color,
                "start": [round(s.x, 3), round(s.y, 3)],
                "end": [round(e.x, 3), round(e.y, 3)],
                "length": round(length, 3), "orientation": orient,
            })
            linetypes_used.add(lt or "(empty)")
            layers_used.add(layer or "(default)")
        else:
            other_entities[etype] = other_entities.get(etype, 0) + 1

    # Also list all linetypes defined in the document
    defined_linetypes = []
    for lt in doc.linetypes:
        defined_linetypes.append(lt.dxf.name)

    return {
        "line_count": len(lines),
        "lines": lines,
        "linetypes_used": sorted(linetypes_used),
        "layers_used": sorted(layers_used),
        "defined_linetypes": sorted(defined_linetypes),
        "other_entities": other_entities,
    }


def analyze_dxf(file_path: str = None, file_bytes: bytes = None) -> DxfAnalysis:
    """Analyze a DXF flat-pattern drawing and extract bend information.

    Provide either file_path or file_bytes (not both).
    """
    _ensure_ezdxf()

    analysis = DxfAnalysis()

    try:
        if file_bytes is not None:
            import tempfile
            import os
            # ezdxf.read() expects a text-mode stream; write bytes to a temp file
            with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name
            try:
                doc = ezdxf.readfile(tmp_path)
            finally:
                os.unlink(tmp_path)
        elif file_path is not None:
            doc = ezdxf.readfile(file_path)
        else:
            analysis.errors.append("No file provided")
            return analysis
    except Exception as e:
        analysis.errors.append(f"Failed to read DXF: {e}")
        return analysis

    msp = doc.modelspace()

    # Collect all entities by type
    # Bend line detection:
    #   DOWN bend = HIDDEN linetype, thin (lw != 25)
    #   UP bend   = Continuous linetype, thin (lw != 25), spans most of part height
    #   Outline   = Continuous linetype, heavy (lw = 25)
    down_bend_lines = []  # HIDDEN linetype → DOWN bends
    up_candidate_lines = []  # Continuous + thin → potential UP bends
    outline_lines = []  # Continuous + heavy → part outline
    texts = []  # (x, y, content) tuples
    dimensions = []  # dimension entities
    arcs = []  # (cx, cy, r, start_angle, end_angle)
    circles = []  # (cx, cy, r)

    HEAVY_LW = 25  # lineweight threshold for outline vs bend
    # Linetypes that indicate a dashed/non-continuous line (bend line)
    DASHED_LINETYPES = {"HIDDEN", "DASHED", "DASH", "DASHDOT", "CENTER",
                        "PHANTOM", "DOT", "DIVIDE", "BORDER"}

    for entity in msp:
        etype = entity.dxftype()

        if etype == "LINE":
            linetype = entity.dxf.get("linetype", "").upper()
            lw = entity.dxf.get("lineweight", -1)
            layer = entity.dxf.get("layer", "").upper()
            start = entity.dxf.start
            end = entity.dxf.end

            # Check if linetype is dashed (by name match or substring)
            is_dashed = any(dk in linetype for dk in DASHED_LINETYPES) if linetype else False
            # Also check if the linetype is resolved from the layer
            if not is_dashed and not linetype:
                # Entity inherits linetype from layer — check layer's linetype
                try:
                    layer_obj = doc.layers.get(entity.dxf.get("layer", "0"))
                    layer_lt = (layer_obj.dxf.get("linetype", "") or "").upper()
                    is_dashed = any(dk in layer_lt for dk in DASHED_LINETYPES)
                except Exception:
                    pass

            if is_dashed:
                down_bend_lines.append((start, end))
            elif lw >= HEAVY_LW:
                outline_lines.append((start, end))
            else:
                # Thin continuous line — could be UP bend or other geometry
                up_candidate_lines.append((start, end))

        elif etype in ("TEXT", "MTEXT"):
            if etype == "TEXT":
                insert = entity.dxf.insert
                content = entity.dxf.text
            else:
                insert = entity.dxf.insert
                content = entity.plain_text()
            texts.append((insert.x, insert.y, content))

        elif etype in ("LWPOLYLINE", "POLYLINE"):
            # Decompose polyline into line/arc segments
            linetype = entity.dxf.get("linetype", "").upper()
            lw = entity.dxf.get("lineweight", -1)

            is_dashed = any(dk in linetype for dk in DASHED_LINETYPES) if linetype else False
            if not is_dashed and not linetype:
                try:
                    layer_obj = doc.layers.get(entity.dxf.get("layer", "0"))
                    layer_lt = (layer_obj.dxf.get("linetype", "") or "").upper()
                    is_dashed = any(dk in layer_lt for dk in DASHED_LINETYPES)
                except Exception:
                    pass

            # Get vertices with bulge info
            try:
                if etype == "LWPOLYLINE":
                    pts = list(entity.get_points(format="xyb"))
                else:
                    # POLYLINE — extract vertices
                    pts = [(v.dxf.location.x, v.dxf.location.y, v.dxf.get("bulge", 0))
                           for v in entity.vertices]
            except Exception:
                pts = []

            closed = getattr(entity, "closed", False)
            if closed and len(pts) > 1:
                pts = pts + [pts[0]]  # close the loop

            for i in range(len(pts) - 1):
                x1, y1, bulge = pts[i]
                x2, y2, _ = pts[i + 1]

                if abs(bulge) > 0.001:
                    # Segment with bulge = arc — compute arc params
                    _arc = _bulge_to_arc(x1, y1, x2, y2, bulge)
                    if _arc:
                        arcs.append(_arc)
                        # Also add to outline_lines as a chord for extent calc
                        if not is_dashed:
                            outline_lines.append(((x1, y1), (x2, y2)))
                else:
                    # Straight segment
                    seg = _SimplePoint(x1, y1), _SimplePoint(x2, y2)
                    if is_dashed:
                        down_bend_lines.append(seg)
                    elif lw >= HEAVY_LW:
                        outline_lines.append(((x1, y1), (x2, y2)))
                    else:
                        # Continuous polyline → outline (most polylines are outlines)
                        outline_lines.append(((x1, y1), (x2, y2)))

        elif etype == "DIMENSION":
            dimensions.append(entity)

        elif etype == "ARC":
            arcs.append((
                entity.dxf.center.x, entity.dxf.center.y,
                entity.dxf.radius,
                entity.dxf.start_angle, entity.dxf.end_angle,
            ))

        elif etype == "CIRCLE":
            circles.append((
                entity.dxf.center.x, entity.dxf.center.y,
                entity.dxf.radius,
            ))

    # --- Normalize line data to ((x1,y1),(x2,y2)) tuples ---
    def _pt(p):
        """Extract (x, y) from a Vec3, _SimplePoint, or tuple."""
        if isinstance(p, tuple):
            return p
        return (p.x, p.y)

    outline_lines = [(_pt(s), _pt(e)) for s, e in outline_lines]
    down_bend_lines = [(_pt(s), _pt(e)) for s, e in down_bend_lines]
    up_candidate_lines = [(_pt(s), _pt(e)) for s, e in up_candidate_lines]

    # --- Determine part extents from outline geometry ---
    all_points = []
    for (x1, y1), (x2, y2) in outline_lines:
        all_points.extend([(x1, y1), (x2, y2)])
    for cx, cy, r, _sa, _ea in arcs:
        all_points.extend([(cx - r, cy - r), (cx + r, cy + r)])
    for cx, cy, r in circles:
        all_points.extend([(cx - r, cy - r), (cx + r, cy + r)])
    # Include bend lines in extents too
    for (x1, y1), (x2, y2) in down_bend_lines + up_candidate_lines:
        all_points.extend([(x1, y1), (x2, y2)])

    if not all_points:
        analysis.errors.append("No geometry found in DXF")
        return analysis

    xs = [p[0] for p in all_points]
    ys = [p[1] for p in all_points]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    analysis.part_length = abs(x_max - x_min)
    analysis.part_width = abs(y_max - y_min)
    analysis.x_min = x_min
    analysis.x_max = x_max
    analysis.y_min = y_min
    analysis.y_max = y_max
    # Store geometry for SVG rendering (already normalized to tuples)
    analysis.outline_lines = outline_lines
    analysis.arcs = arcs
    analysis.circles = circles

    # Minimum span for a line to count as a bend line (% of part dimension)
    part_height = abs(y_max - y_min)
    part_width = abs(x_max - x_min)
    min_vert_span = part_height * 0.15  # vertical lines must span 15% of height
    min_horiz_span = part_width * 0.15  # horizontal lines must span 15% of width

    def _line_spans_enough(bend):
        """Check if a bend line spans enough of the part to be a real bend."""
        y_span = abs(bend.y_end - bend.y_start)
        x_span = abs(bend.x_end - bend.x_start)
        # Vertical line: check Y span
        if x_span < 0.01:
            return y_span >= min_vert_span
        # Horizontal line: check X span
        if y_span < 0.01:
            return x_span >= min_horiz_span
        # Angled line: check the longer span
        return max(x_span, y_span) >= min(min_vert_span, min_horiz_span)

    # --- Identify DOWN bend lines (dashed linetype, thin) ---
    for start, end in down_bend_lines:
        bend = _make_bend_from_line(start, end)
        if bend and _line_spans_enough(bend):
            bend.direction = "DOWN"
            analysis.bend_lines.append(bend)

    # --- Identify UP bend lines (Continuous, thin, span most of part) ---
    for start, end in up_candidate_lines:
        bend = _make_bend_from_line(start, end)
        if bend and _line_spans_enough(bend):
            bend.direction = "UP"
            analysis.bend_lines.append(bend)

    if not analysis.bend_lines:
        analysis.warnings.append(
            "No bend lines found. Bend lines should be thin lines "
            "(HIDDEN for DOWN, Continuous for UP) spanning the part."
        )

    # --- Match TEXT annotations to bend lines ---
    for bend in analysis.bend_lines:
        y_mid = (bend.y_start + bend.y_end) / 2
        label = _find_nearest_text_to_line(texts, bend.x, y_mid)
        if label:
            bend.label_text = label
            parsed = _parse_bend_label(label)
            if parsed["direction"]:
                bend.direction = parsed["direction"]
            if parsed["angle"] is not None:
                bend.angle = parsed["angle"]
            if parsed["radius"] is not None:
                bend.radius = parsed["radius"]

    # --- Parse title text for gauge/material ---
    # Title is typically the text with the highest Y (top of drawing)
    # or containing "gauge"/"ga"
    if texts:
        # First try to find text containing gauge info
        for tx, ty, content in texts:
            parsed = _parse_title_text(content)
            if parsed["gauge"]:
                analysis.title_text = content
                analysis.gauge = parsed["gauge"]
                analysis.material_keyword = parsed["material_keyword"]
                break

        # If no gauge text found, use the topmost text as title
        if not analysis.title_text:
            sorted_texts = sorted(texts, key=lambda t: t[1], reverse=True)
            analysis.title_text = sorted_texts[0][2]
            parsed = _parse_title_text(analysis.title_text)
            analysis.gauge = parsed["gauge"]
            analysis.material_keyword = parsed["material_keyword"]

    # Resolve gauge to thickness
    if analysis.gauge and analysis.gauge in GAUGE_THICKNESS:
        analysis.thickness_inch = GAUGE_THICKNESS[analysis.gauge]
    elif analysis.gauge:
        analysis.warnings.append(
            f"Gauge {analysis.gauge} not in lookup table. "
            "Thickness will need to be set manually."
        )

    # Resolve material keyword to stock material name
    if analysis.material_keyword:
        kw = analysis.material_keyword.lower()
        if kw in MATERIAL_KEYWORDS:
            analysis.material_match = MATERIAL_KEYWORDS[kw]

    # Sort bend lines by position (left to right)
    analysis.bend_lines.sort(key=lambda b: b.x)

    return analysis


def compute_bg_x_distances(analysis: DxfAnalysis, ref_edge: str = "left") -> list[float]:
    """Compute backgauge X distance from a reference edge to each bend line.

    ref_edge: "left" (x_min), "right" (x_max), "top" (y_max), "bottom" (y_min).
    Returns list of distances in the same order as analysis.bend_lines.
    """
    if ref_edge == "right":
        return [round(abs(bl.x - analysis.x_max), 3) for bl in analysis.bend_lines]
    elif ref_edge == "top":
        return [round(abs(analysis.y_max - (bl.y_start + bl.y_end) / 2), 3)
                for bl in analysis.bend_lines]
    elif ref_edge == "bottom":
        return [round(abs((bl.y_start + bl.y_end) / 2 - analysis.y_min), 3)
                for bl in analysis.bend_lines]
    else:  # "left"
        return [round(abs(bl.x - analysis.x_min), 3) for bl in analysis.bend_lines]


def generate_svg(analysis: DxfAnalysis, width: int = 600) -> str:
    """Generate an SVG preview of the flat pattern with bend lines highlighted."""
    dx = analysis.x_max - analysis.x_min
    dy = analysis.y_max - analysis.y_min
    if dx < 0.001 or dy < 0.001:
        return ""

    # Compute scale so the SVG fits the desired width
    scale = (width - 40) / dx  # 20px padding each side
    height = int(dy * scale + 40)

    def tx(x):
        return round((x - analysis.x_min) * scale + 20, 2)

    def ty(y):
        # Flip Y (DXF Y-up → SVG Y-down)
        return round((analysis.y_max - y) * scale + 20, 2)

    def tr(r):
        return round(r * scale, 2)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" style="background:#f8f8f0">'
    ]

    # Outline lines
    for (x1, y1), (x2, y2) in analysis.outline_lines:
        parts.append(
            f'<line x1="{tx(x1)}" y1="{ty(y1)}" x2="{tx(x2)}" y2="{ty(y2)}" '
            f'stroke="#333" stroke-width="1.5" />'
        )

    # Arcs
    for cx, cy, r, start_deg, end_deg in analysis.arcs:
        # Convert arc to SVG path
        if end_deg < start_deg:
            end_deg += 360
        sweep = end_deg - start_deg
        if abs(sweep) < 0.1:
            continue
        large_arc = 1 if sweep > 180 else 0

        sa = math.radians(start_deg)
        ea = math.radians(end_deg)
        sx = cx + r * math.cos(sa)
        sy = cy + r * math.sin(sa)
        ex = cx + r * math.cos(ea)
        ey = cy + r * math.sin(ea)

        # SVG arcs go clockwise when Y is flipped
        parts.append(
            f'<path d="M {tx(sx)} {ty(sy)} A {tr(r)} {tr(r)} 0 {large_arc} 0 '
            f'{tx(ex)} {ty(ey)}" fill="none" stroke="#333" stroke-width="1.5" />'
        )

    # Circles
    for cx, cy, r in analysis.circles:
        parts.append(
            f'<circle cx="{tx(cx)}" cy="{ty(cy)}" r="{tr(r)}" '
            f'fill="none" stroke="#333" stroke-width="1" />'
        )

    # Color scheme: UP=blue, DOWN=red
    UP_COLOR = "#2980b9"
    DOWN_COLOR = "#e74c3c"

    # Bend lines — DOWN=dashed red, UP=solid blue, each with data-bend-idx
    for i, bl in enumerate(analysis.bend_lines):
        color = UP_COLOR if bl.direction != "DOWN" else DOWN_COLOR
        dash = 'stroke-dasharray="8,4"' if bl.direction == "DOWN" else ""
        dir_label = bl.direction or "?"

        # SVG coordinates for the actual line endpoints
        sx1, sy1 = tx(bl.x_start), ty(bl.y_start)
        sx2, sy2 = tx(bl.x_end), ty(bl.y_end)
        mid_sx = (sx1 + sx2) / 2
        mid_sy = (sy1 + sy2) / 2

        # Compute line angle in SVG space for label rotation
        svg_dx = sx2 - sx1
        svg_dy = sy2 - sy1
        if abs(svg_dx) < 0.001 and abs(svg_dy) < 0.001:
            svg_angle = -90  # fallback for zero-length
        else:
            svg_angle = math.degrees(math.atan2(svg_dy, svg_dx))
        # Keep text readable (never upside-down)
        if svg_angle > 90:
            svg_angle -= 180
        elif svg_angle < -90:
            svg_angle += 180

        # Offset label perpendicular to the line
        perp_rad = math.radians(svg_angle - 90)
        label_offset = 12
        label_x = round(mid_sx + label_offset * math.cos(perp_rad), 2)
        label_y = round(mid_sy + label_offset * math.sin(perp_rad), 2)
        rot = round(svg_angle, 2)

        # Group for hover highlighting
        parts.append(f'<g class="bend-line-svg" data-bend-idx="{i}">')
        parts.append(
            f'  <line x1="{sx1}" y1="{sy1}" x2="{sx2}" y2="{sy2}" '
            f'stroke="{color}" stroke-width="2.5" {dash} />'
        )
        # Direction + number label — rotated parallel to line
        parts.append(
            f'  <text x="{label_x}" y="{label_y}" '
            f'transform="rotate({rot}, {label_x}, {label_y})" '
            f'font-size="11" font-weight="600" fill="{color}" '
            f'font-family="sans-serif" class="bend-label" '
            f'data-bend-idx="{i}">{i+1}. {dir_label} {bl.angle}\u00b0</text>'
        )
        parts.append('</g>')

    # Edge indicators — colored bars offset outside the outline, label centered
    # Colors: L=green, R=orange, T=purple, B=magenta
    left_x = tx(analysis.x_min)
    right_x = tx(analysis.x_max)
    top_y = ty(analysis.y_max)
    bot_y = ty(analysis.y_min)
    mid_y = (top_y + bot_y) / 2
    mid_x = (left_x + right_x) / 2
    off = 6  # offset from the edge so outline stays visible

    # Left edge — green
    parts.append(
        f'<line x1="{left_x - off}" y1="{top_y}" x2="{left_x - off}" y2="{bot_y}" '
        f'stroke="#27ae60" stroke-width="4" opacity="0.5" class="edge-line" data-edge="left" />'
    )
    parts.append(
        f'<text x="{left_x - off}" y="{mid_y + 4}" text-anchor="middle" '
        f'font-size="11" fill="#27ae60" font-family="sans-serif" font-weight="700">L</text>'
    )

    # Right edge — orange
    parts.append(
        f'<line x1="{right_x + off}" y1="{top_y}" x2="{right_x + off}" y2="{bot_y}" '
        f'stroke="#e67e22" stroke-width="4" opacity="0.5" class="edge-line" data-edge="right" />'
    )
    parts.append(
        f'<text x="{right_x + off}" y="{mid_y + 4}" text-anchor="middle" '
        f'font-size="11" fill="#e67e22" font-family="sans-serif" font-weight="700">R</text>'
    )

    # Detect horizontal bend lines (for conditional T/B indicators)
    has_horiz = any(abs(bl.y_end - bl.y_start) < 0.01 for bl in analysis.bend_lines)
    if has_horiz:
        # Top edge — purple
        parts.append(
            f'<line x1="{left_x}" y1="{top_y - off}" x2="{right_x}" y2="{top_y - off}" '
            f'stroke="#8e44ad" stroke-width="4" opacity="0.5" class="edge-line" data-edge="top" />'
        )
        parts.append(
            f'<text x="{mid_x}" y="{top_y - off + 4}" text-anchor="middle" '
            f'font-size="11" fill="#8e44ad" font-family="sans-serif" font-weight="700">T</text>'
        )

        # Bottom edge — magenta
        parts.append(
            f'<line x1="{left_x}" y1="{bot_y + off}" x2="{right_x}" y2="{bot_y + off}" '
            f'stroke="#e91e90" stroke-width="4" opacity="0.5" class="edge-line" data-edge="bottom" />'
        )
        parts.append(
            f'<text x="{mid_x}" y="{bot_y + off + 4}" text-anchor="middle" '
            f'font-size="11" fill="#e91e90" font-family="sans-serif" font-weight="700">B</text>'
        )

    parts.append('</svg>')
    return "\n".join(parts)


def analysis_to_bend_dicts(
    analysis: DxfAnalysis,
    bend_plan: list[dict] | None = None,
    thickness_override: float | None = None,
    default_punch_id: str | None = None,
    default_die_id: str | None = None,
    default_material_id: str | None = None,
) -> list[dict]:
    """Convert DXF analysis results to bend definition dicts for the API.

    bend_plan: list of {index, edge, angle?} dicts defining bend order, per-bend
               edge assignments, and optional angle overrides. index refers to the
               original bend_lines index.
               If None, uses default left-to-right order with "left" edge.
    thickness_override: if set, overrides the gauge-derived thickness.
    """
    bends = []
    thickness = thickness_override or analysis.thickness_inch or 0.06
    bg_left = compute_bg_x_distances(analysis, "left")
    bg_right = compute_bg_x_distances(analysis, "right")
    bg_top = compute_bg_x_distances(analysis, "top")
    bg_bottom = compute_bg_x_distances(analysis, "bottom")
    bg_map = {"left": bg_left, "right": bg_right, "top": bg_top, "bottom": bg_bottom}

    if bend_plan is None:
        bend_plan = [{"index": i, "edge": "left"} for i in range(len(analysis.bend_lines))]

    for order_num, plan in enumerate(bend_plan):
        idx = plan["index"]
        edge = plan.get("edge", "left")
        angle_override = plan.get("angle")
        if idx < 0 or idx >= len(analysis.bend_lines):
            continue
        bl = analysis.bend_lines[idx]

        bend_angle = angle_override if angle_override is not None else bl.angle

        # Use explicit bendWidth from plan (e.g. merged bends) if provided
        plan_width = plan.get("bendWidth")
        if plan_width and plan_width > 0:
            bend_width = plan_width
        else:
            bend_width = abs(bl.y_end - bl.y_start)
            if bend_width < 0.01:
                bend_width = analysis.part_width

        bg_x = bg_map.get(edge, bg_left)[idx]

        # Per-bend tooling overrides (fall back to global defaults)
        die_id = plan.get("dieId") or default_die_id
        punch_id = plan.get("punchId") or default_punch_id
        material_id = plan.get("materialId") or default_material_id
        bg_finger = plan.get("bgFinger", "G54")

        direction_note = plan.get("direction") or bl.direction or "unknown"
        notes_parts = [f"Direction: {direction_note}", f"BG ref: {edge} edge"]
        if bl.label_text:
            notes_parts.append(f"DXF label: {bl.label_text}")

        bend = {
            "id": str(uuid4()),
            "name": f"Bend {order_num + 1} ({direction_note} {bend_angle}\u00b0)",
            "notes": "; ".join(notes_parts),
            "desiredBendAngle": bend_angle,
            "angleCompensation": 0.0,
            "angleCompensationReversed": False,
            "materialThickness": thickness,
            "punchToMaterialClearance": 0.1,
            "additionalRetractAfterBend": 0.0,
            "bendWidth": round(bend_width, 1),
            "backGaugeRefEdgeStop": bg_finger,
            "backGaugeRefEdgeStopEnabled": True,
            "backGaugeXPosition": round(bg_x, 3),
            "backGaugeRPosition": 0.0,
            "backGaugeJogSpeed": 0.0,
            "overrideFinalBendPositionEnabled": False,
            "overriddenFinalBendPosition": 0.0,
            "punchId": punch_id,
            "dieId": die_id,
            "materialId": material_id,
        }
        bends.append(bend)

    return bends


def analysis_to_summary(analysis: DxfAnalysis) -> dict:
    """Convert analysis to a JSON-serializable summary for the API response."""
    bg_left = compute_bg_x_distances(analysis, "left")
    bg_right = compute_bg_x_distances(analysis, "right")
    bg_top = compute_bg_x_distances(analysis, "top")
    bg_bottom = compute_bg_x_distances(analysis, "bottom")

    return {
        "bend_count": len(analysis.bend_lines),
        "bends": [
            {
                "index": i,
                "direction": bl.direction or "unknown",
                "angle": bl.angle,
                "radius": bl.radius,
                "bend_width": round(abs(bl.y_end - bl.y_start), 1) or round(abs(bl.x_end - bl.x_start), 1) or round(analysis.part_width, 1),
                "x_position": round(bl.x, 4),
                "y_start": round(bl.y_start, 4),
                "y_end": round(bl.y_end, 4),
                "x_start": round(bl.x_start, 4),
                "x_end": round(bl.x_end, 4),
                "label": bl.label_text,
                "bg_x_from_left": bg_left[i] if i < len(bg_left) else 0,
                "bg_x_from_right": bg_right[i] if i < len(bg_right) else 0,
                "bg_x_from_top": bg_top[i] if i < len(bg_top) else 0,
                "bg_x_from_bottom": bg_bottom[i] if i < len(bg_bottom) else 0,
            }
            for i, bl in enumerate(analysis.bend_lines)
        ],
        "gauge": analysis.gauge,
        "thickness_inch": analysis.thickness_inch,
        "material_keyword": analysis.material_keyword,
        "material_match": analysis.material_match,
        "title": analysis.title_text,
        "part_width": round(analysis.part_width, 4),
        "part_length": round(analysis.part_length, 4),
        "x_min": round(analysis.x_min, 4),
        "x_max": round(analysis.x_max, 4),
        "svg": generate_svg(analysis),
        "has_horizontal_bends": any(
            abs(bl.y_end - bl.y_start) < 0.01 for bl in analysis.bend_lines
        ),
        "warnings": analysis.warnings,
        "errors": analysis.errors,
    }
