"""Tests for DXF bend-label angle convention (bend vs included angle).

Run:  .venv/bin/python tests/test_label_angle.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ezdxf

from bendgen.dxf_analyzer import analyze_dxf, analysis_to_bend_dicts, analysis_to_summary
from bendgen.models import Bend, validate_bend


def make_dxf(label=None, direction="UP", tmpdir=None):
    """Build a 10x6 plate: heavy outline, one vertical bend line at x=5, optional label."""
    doc = ezdxf.new("R2010", setup=True)
    msp = doc.modelspace()
    pts = [(0, 0), (10, 0), (10, 6), (0, 6), (0, 0)]
    for a, b in zip(pts, pts[1:]):
        msp.add_line(a, b, dxfattribs={"lineweight": 50})
    if direction == "DOWN":
        msp.add_line((5, 0), (5, 6), dxfattribs={"linetype": "HIDDEN", "lineweight": 13})
    else:
        msp.add_line((5, 0), (5, 6), dxfattribs={"lineweight": 13})
    if label:
        msp.add_text(label, height=0.2, dxfattribs={"insert": (5.2, 3.0)})
    msp.add_text("16 ga", height=0.3, dxfattribs={"insert": (0, 7)})
    path = os.path.join(tmpdir, "t.dxf")
    doc.saveas(path)
    with open(path, "rb") as f:
        return f.read()


def angle_for(dxf_bytes, mode=None):
    kw = {} if mode is None else {"label_angle_mode": mode}
    analysis = analyze_dxf(file_bytes=dxf_bytes, **kw)
    assert not analysis.errors, analysis.errors
    assert len(analysis.bend_lines) == 1, analysis.bend_lines
    defs = analysis_to_bend_dicts(analysis)
    return analysis, defs[0]["desiredBendAngle"]


def run():
    with tempfile.TemporaryDirectory() as d:
        # (a) UP 45 -> included 135 by default, 45 when drawing uses included angles
        b = make_dxf("UP 45° R 0.06", "UP", d)
        analysis, ang = angle_for(b)  # default mode
        assert ang == 135, f"default mode: expected 135, got {ang}"
        assert analysis_to_summary(analysis)["bends"][0]["label_angle"] == 45
        assert analysis_to_summary(analysis)["bends"][0]["angle"] == 135
        assert "label 45" in analysis_to_summary(analysis)["svg"]
        _, ang = angle_for(b, "bend")
        assert ang == 135, f"bend mode: expected 135, got {ang}"
        _, ang = angle_for(b, "included")
        assert ang == 45, f"included mode: expected 45, got {ang}"
        # invalid mode falls back to default
        _, ang = angle_for(b, "bogus")
        assert ang == 135, f"bogus mode: expected 135, got {ang}"

        # (b) UP 90 -> 90 in both
        b = make_dxf("UP 90° R 0.06", "UP", d)
        for mode in (None, "bend", "included"):
            analysis, ang = angle_for(b, mode)
            assert ang == 90, f"90 label mode={mode}: got {ang}"
            assert not analysis.warnings, analysis.warnings
            assert "label" not in analysis_to_summary(analysis)["svg"].split("bend-label")[1].split("</text>")[0]

        # (c) DOWN 180 hem -> warning, no crash, value left as-is (0) so validation blocks it
        b = make_dxf("DOWN 180° R0", "DOWN", d)
        analysis, ang = angle_for(b)
        assert ang == 0, f"hem: expected included 0, got {ang}"
        assert any("Bend 1" in w and "hem" in w for w in analysis.warnings), analysis.warnings
        summary = analysis_to_summary(analysis)  # must not crash
        assert summary["bends"][0]["angle"] == 0 and summary["bends"][0]["label_angle"] == 180
        bd = analysis_to_bend_dicts(analysis)[0]
        errs = validate_bend(Bend(**{k: bd[k] for k in ("desiredBendAngle", "materialThickness", "bendWidth")}))
        assert any("desiredBendAngle" in e for e in errs), errs
        # in "included" mode a 180 label is also out of range, still warns
        analysis, ang = angle_for(b, "included")
        assert ang == 180 and analysis.warnings, (ang, analysis.warnings)

        # (d) unlabeled line -> 90 default in both modes, no warnings about angle
        b = make_dxf(None, "UP", d)
        for mode in (None, "bend", "included"):
            analysis, ang = angle_for(b, mode)
            assert ang == 90, f"unlabeled mode={mode}: got {ang}"
            assert analysis_to_summary(analysis)["bends"][0]["label_angle"] is None
    print("test_label_angle: all passed")


if __name__ == "__main__":
    run()
