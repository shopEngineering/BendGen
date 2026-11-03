"""Compensation-direction semantics: BendControl's angleCompensationReversed=true is
UNDERBENT (machine bends MORE); false is OVERBENT (bends LESS). The BendGen UI labels
must match (see CreateBendView.java:357, BendCalculator.java:225-226).

Run:  .venv/bin/python tests/test_comp_direction.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def effective_included_angle(desired, springback, comp, reversed_):
    """Re-implementation of the BendCalculator angle term: theta = (desired - springback) + C*d,
    d = -1 when reversed. Smaller included angle = deeper stroke = bends MORE."""
    d = -1 if reversed_ else 1
    return (desired - springback) + comp * d


def check_semantics():
    for c in (0.5, 2, 5):
        t_rev = effective_included_angle(90, 0, c, True)
        t_fwd = effective_included_angle(90, 0, c, False)
        assert t_rev < t_fwd, f"reversed=true must give smaller included angle (C={c}): {t_rev} vs {t_fwd}"
    assert effective_included_angle(90, 0, 0, True) == effective_included_angle(90, 0, 0, False)


def check_html():
    html = read("bendgen/templates/index.html")
    sel = re.search(r'<select name="angleCompensationReversed">(.*?)</select>', html, re.S)
    assert sel, "angleCompensationReversed select not found in index.html"
    opts = dict(re.findall(r'<option value="(true|false)"[^>]*>(.*?)</option>', sel.group(1), re.S))
    assert re.search(r"bend more|underbent", opts["true"], re.I), f'html value "true" label: {opts["true"]!r}'
    assert re.search(r"bend less|overbent", opts["false"], re.I), f'html value "false" label: {opts["false"]!r}'
    assert "bend more" in opts["true"].lower() and "bend less" in opts["false"].lower(), opts
    # old, swapped labels must not be the primary label of the wrong value
    assert not opts["true"].strip().lower().startswith("overbent")
    assert not opts["false"].strip().lower().startswith("underbent")


def check_js():
    js = read("bendgen/static/app.js")
    m = re.search(r'key:\s*"angleCompensationReversed".*?options:\s*\[(.*?)\]\s*\}', js, re.S)
    assert m, "angleCompensationReversed column not found in app.js"
    opts = {v: l for v, l in re.findall(r'value:\s*"(true|false)"\s*,\s*label:\s*"([^"]*)"', m.group(1))}
    assert set(opts) == {"true", "false"}, opts
    assert re.search(r"bend more|underbent", opts["true"], re.I), f'js value "true" label: {opts["true"]!r}'
    assert re.search(r"bend less|overbent", opts["false"], re.I), f'js value "false" label: {opts["false"]!r}'
    assert "bend more" in opts["true"].lower() and "bend less" in opts["false"].lower(), opts


def run():
    check_semantics()
    check_html()
    check_js()
    print("test_comp_direction: all passed")


if __name__ == "__main__":
    run()
