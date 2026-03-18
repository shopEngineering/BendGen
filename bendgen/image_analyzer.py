"""Local image analysis for extracting bend data from drawing photos/scans.

Uses pytesseract (OCR) when available. Falls back to filename-only parsing
when Tesseract is not installed — the user can still manually add bends
in the preview modal.
"""

import re

try:
    from PIL import Image
    import pytesseract
    _HAS_OCR = True
except ImportError:
    _HAS_OCR = False

# --- Material keyword mapping ---
_MATERIAL_ALIASES = {
    "crs": "Cold Rolled Steel",
    "cold rolled": "Cold Rolled Steel",
    "cold roll": "Cold Rolled Steel",
    "cr steel": "Cold Rolled Steel",
    "hrs": "Hot Rolled Steel",
    "hot rolled": "Hot Rolled Steel",
    "hot roll": "Hot Rolled Steel",
    "hr steel": "Hot Rolled Steel",
    "mild steel": "Hot Rolled Steel",
    "a36": "Hot Rolled Steel",
    "a-36": "Hot Rolled Steel",
    "stainless": "Stainless Steel",
    "ss": "Stainless Steel",
    "304": "Stainless Steel",
    "316": "Stainless Steel",
    "430": "Stainless Steel",
    "aluminum": "Aluminum",
    "aluminium": "Aluminum",
    "al": "Aluminum",
    "6061": "Aluminum",
    "5052": "Aluminum",
    "3003": "Aluminum",
}


def has_ocr():
    """Return True if pytesseract + Tesseract binary are available."""
    if not _HAS_OCR:
        return False
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def analyze_image(image_bytes):
    """Analyze a drawing image. Returns a dict with extracted bend data.

    If OCR is available, extracts text and parses for material, gauge,
    angles, directions. Also scans for rotated dimension text.
    Otherwise returns empty results for manual entry.
    """
    ocr_text = ""
    ocr_available = has_ocr()
    dimensions = []

    if ocr_available:
        try:
            from io import BytesIO
            img = Image.open(BytesIO(image_bytes))

            # Pass 1: Normal OCR for bend annotations, material, gauge
            ocr_text = pytesseract.image_to_string(img, config="--psm 6")

            # Pass 2: Scan for rotated dimensions (common in engineering drawings)
            # Dimensions are often vertical text on the right side or bottom
            dimensions = _extract_rotated_dimensions(img)
        except Exception:
            ocr_text = ""
            ocr_available = False

    result = {
        "ocr_available": ocr_available,
        "ocr_text": ocr_text,
        "part_name": None,
        "material": None,
        "gauge": None,
        "thickness_inch": None,
        "bends": [],
        "dimensions": dimensions,
        "notes": None,
    }

    if not ocr_text.strip():
        return result

    _parse_ocr_text(ocr_text, result)
    # Merge any dimensions found from rotated scan
    if dimensions:
        result["dimensions"] = dimensions
    return result


def _extract_rotated_dimensions(img):
    """Extract dimension values from rotated text in the image.

    Engineering drawings commonly have vertical dimension text.
    Scans the right portion of the image rotated 270° and the bottom
    portion rotated 0° to find decimal dimension values.
    """
    from PIL import ImageOps
    dims = set()
    w, h = img.size

    # Scan right half, rotated 270° (for vertical dimension text)
    for x_start, x_end in [(0.45, 0.85), (0.3, 0.5)]:
        try:
            crop = img.crop((int(w * x_start), 0, int(w * x_end), h))
            rotated = crop.rotate(270, expand=True)
            gray = rotated.convert("L")
            inv = ImageOps.invert(gray)
            bw = inv.point(lambda x: 255 if x > 80 else 0, "1")
            text = pytesseract.image_to_string(bw, config="--psm 6")
            _collect_dimensions(text, dims)
        except Exception:
            pass

    # Scan bottom portion, normal orientation (for horizontal dimension text)
    try:
        crop = img.crop((0, int(h * 0.7), w, h))
        gray = crop.convert("L")
        inv = ImageOps.invert(gray)
        bw = inv.point(lambda x: 255 if x > 80 else 0, "1")
        text = pytesseract.image_to_string(bw, config="--psm 6")
        _collect_dimensions(text, dims)
    except Exception:
        pass

    return sorted(dims)


def _collect_dimensions(text, dims):
    """Extract plausible dimension values from OCR text into a set."""
    for m in re.finditer(r'(\d+\.?\d*)', text):
        try:
            val = float(m.group(1))
            # Plausible dimension: not too tiny, not too huge
            if 0.01 < val < 100:
                dims.add(round(val, 4))
        except ValueError:
            pass


def _parse_ocr_text(text, result):
    """Parse OCR text for bend-relevant data."""
    lines = text.strip().split("\n")
    all_text = " ".join(lines).lower()

    # --- Material detection ---
    for alias, full_name in _MATERIAL_ALIASES.items():
        # Word-boundary match to avoid false positives
        pattern = r'\b' + re.escape(alias) + r'\b'
        if re.search(pattern, all_text):
            result["material"] = full_name
            break

    # --- Gauge detection ---
    # Patterns: "18 GA", "18GA", "18 GAUGE", "#18", "18 ga.", "18ga"
    ga_match = re.search(
        r'(?:#?\s*(\d{1,2})\s*(?:ga\.?|gauge)\b)|'
        r'(?:\b(\d{1,2})\s*ga\.?\b)',
        all_text
    )
    if ga_match:
        gauge_str = ga_match.group(1) or ga_match.group(2)
        gauge = int(gauge_str)
        if 7 <= gauge <= 28:
            result["gauge"] = gauge

    # --- Thickness detection ---
    # Patterns: ".048"", "0.048"", ".048 in", "0.048 inch", "thickness: 0.048"
    thick_match = re.search(
        r'(?:thickness|thk|thkns|mat[\'e]?l?\s*thk?)\s*[:=]?\s*'
        r'(\d*\.?\d+)\s*["\u201d]?',
        all_text
    )
    if not thick_match:
        # Standalone decimal with inch mark: .048" or 0.048"
        thick_match = re.search(r'\b(0?\.\d{2,4})\s*["\u201d]', all_text)
    if thick_match:
        try:
            val = float(thick_match.group(1))
            if 0.005 < val < 2.5:
                result["thickness_inch"] = round(val, 4)
        except ValueError:
            pass

    # --- Bend detection ---
    bends = []

    # Pattern 1: "BEND 1 UP 90°" or "B1 DN 45 DEG" style (numbered bends)
    bend_pattern = re.compile(
        r'(?:bend|b)\s*#?\s*(\d+)\s*'        # bend number
        r'(?:[:\-—]?\s*)?'                      # optional separator
        r'(up|down|dn|u|d)?\s*'               # optional direction
        r'(\d+(?:\.\d+)?)\s*'                 # angle
        r'(?:°|deg(?:rees?)?)?'               # optional degree symbol
        r'(?:\s*r\s*(\d*\.?\d+))?',           # optional radius "R 0.06"
        re.IGNORECASE
    )
    for m in bend_pattern.finditer(text):
        num = int(m.group(1))
        direction = _parse_direction(m.group(2))
        angle = float(m.group(3))
        radius = float(m.group(4)) if m.group(4) else None
        if 10 <= angle <= 180:
            bends.append({
                "number": num,
                "label": f"Bend {num}",
                "angle": angle,
                "direction": direction,
                "inside_radius": radius,
            })

    # Pattern 2: "UP 45° R 0.06" or "DOWN 90° R0.06" style (direction + angle, no bend number)
    # Keep ALL matches — do NOT deduplicate by angle (multiple bends can share an angle)
    if not bends:
        angle_pattern = re.compile(
            r'(up|down|dn)\s+'                    # direction (required to avoid matching dimensions)
            r'(\d+(?:\.\d+)?)\s*'                 # angle
            r'(?:°|deg(?:rees?)?)'                # degree symbol (required)
            r'(?:\s*r\s*o?\s*(\d*\.?\d+))?',      # optional radius "R 0.06" (allow OCR "RO" for "R0")
            re.IGNORECASE
        )
        for m in angle_pattern.finditer(text):
            angle = float(m.group(2))
            if 10 <= angle <= 180:
                direction = _parse_direction(m.group(1))
                radius = float(m.group(3)) if m.group(3) else None
                bends.append({
                    "number": len(bends) + 1,
                    "label": f"Bend {len(bends) + 1}",
                    "angle": angle,
                    "direction": direction,
                    "inside_radius": radius,
                })

    # Pattern 3: Bare angle annotations "90°", "45 DEG" without direction
    if not bends:
        bare_pattern = re.compile(
            r'(\d+(?:\.\d+)?)\s*(?:°|deg(?:rees?)?)',
            re.IGNORECASE
        )
        for m in bare_pattern.finditer(text):
            angle = float(m.group(1))
            if 10 <= angle <= 180:
                bends.append({
                    "number": len(bends) + 1,
                    "label": f"Bend {len(bends) + 1}",
                    "angle": angle,
                    "direction": None,
                    "inside_radius": None,
                })

    # Sort by bend number
    bends.sort(key=lambda b: b["number"])
    result["bends"] = bends

    # --- Dimension detection (for potential bend widths / part dimensions) ---
    dimensions = []
    dim_pattern = re.compile(r'(\d+\.?\d*)\s*["\u201d]?(?:\s|$)', re.MULTILINE)
    for m in dim_pattern.finditer(text):
        try:
            val = float(m.group(1))
            # Filter to plausible dimensions (not angles, not tiny, not huge)
            if 0.1 < val < 100 and val not in {b["angle"] for b in bends}:
                dimensions.append(val)
        except ValueError:
            pass
    result["dimensions"] = dimensions

    # --- Part name: first non-empty line that looks like a title ---
    for line in lines:
        stripped = line.strip()
        # Skip very short or all-numeric lines
        if len(stripped) < 3 or stripped.replace(" ", "").isdigit():
            continue
        # Skip lines that are just measurements or material specs
        if re.match(r'^[\d\s.\-/°"]+$', stripped):
            continue
        # Use as part name if it has some alphabetic content
        if re.search(r'[a-zA-Z]{2,}', stripped):
            result["part_name"] = stripped[:60]
            break


def _parse_direction(d):
    """Normalize direction string to UP/DOWN or None."""
    if not d:
        return None
    d = d.strip().upper()
    if d in ("UP", "U"):
        return "UP"
    if d in ("DOWN", "DN", "D"):
        return "DOWN"
    return None
