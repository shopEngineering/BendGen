"""Stock tooling data embedded from BendControl default-entity files."""

from .models import Die, Punch, Material

# Per-material gauge-to-thickness tables (inches)
# Standard steel gauge (Manufacturers' Standard Gauge) for CR and HR steel
_STEEL_GAUGE = {
    7: 0.1793, 8: 0.1644, 9: 0.1495, 10: 0.1345, 11: 0.1196,
    12: 0.1046, 13: 0.0897, 14: 0.0747, 15: 0.0673, 16: 0.0598,
    17: 0.0538, 18: 0.0478, 19: 0.0418, 20: 0.0359, 21: 0.0329,
    22: 0.0299, 23: 0.0269, 24: 0.0239, 25: 0.0209, 26: 0.0179,
    27: 0.0164, 28: 0.0149,
}

# Stainless steel uses a different gauge standard
_STAINLESS_GAUGE = {
    7: 0.1875, 8: 0.1719, 9: 0.1562, 10: 0.1406, 11: 0.1250,
    12: 0.1094, 13: 0.0937, 14: 0.0781, 15: 0.0703, 16: 0.0625,
    17: 0.0562, 18: 0.0500, 19: 0.0437, 20: 0.0375, 21: 0.0344,
    22: 0.0312, 23: 0.0281, 24: 0.0250, 25: 0.0219, 26: 0.0187,
    27: 0.0172, 28: 0.0156,
}

# Aluminum uses Brown & Sharpe (AWG) gauge
_ALUMINUM_GAUGE = {
    7: 0.1443, 8: 0.1285, 9: 0.1144, 10: 0.1019, 11: 0.0907,
    12: 0.0808, 13: 0.0720, 14: 0.0641, 15: 0.0571, 16: 0.0508,
    17: 0.0453, 18: 0.0403, 19: 0.0359, 20: 0.0320, 21: 0.0285,
    22: 0.0253, 23: 0.0226, 24: 0.0201, 25: 0.0179, 26: 0.0159,
    27: 0.0142, 28: 0.0126,
}

STOCK_DIES = [
    Die(id="1e6b5316-9b51-49bc-93e5-e0193d7ddef5", name="Acute 26mm 30\u00b0 Die [LS-PBRK-9355]", heightInch=1.862, vdieOpeningInch=1.024),
    Die(id="ddb2ffd7-12ce-4fa9-a552-e51db4dae29b", name="Acute 16.5mm 30\u00b0 Die [LS-PBRK-9858]", heightInch=1.862, vdieOpeningInch=0.65),
    Die(id="4186cbfd-8e3f-40f4-b9a4-68c03fccdf76", name="Acute 8mm Die 30\u00b0 Die [LS-PBRK-5623]", heightInch=1.862, vdieOpeningInch=0.315),
    Die(id="0885240c-c7d5-439c-bc36-2fadf53ff88d", name="Acute 2in 35\u00b0 Die [LS-PBRK-2288]", heightInch=3.004, vdieOpeningInch=1.949),
    Die(id="35a9cdc8-8eb3-4417-9749-5b7258e74f97", name="4 Way Die (0.630in) + Riser [LS-PBRK-4387]", heightInch=2.612, vdieOpeningInch=0.63),
    Die(id="401907fa-5763-43e7-996e-a3406b1454b9", name="4 Way Die (0.866in) + Riser [LS-PBRK-4387]", heightInch=2.612, vdieOpeningInch=0.866),
    Die(id="b5c3fa29-2584-4e9a-8b39-cfcc988bf511", name="4 Way Die (1.378in) + Riser [LS-PBRK-4387]", heightInch=2.612, vdieOpeningInch=1.378),
    Die(id="d77d2c5e-1e8e-4d8a-8cb3-48bff73f1f1b", name="4 Way Die (1.969in) + Riser [LS-PBRK-4387]", heightInch=2.612, vdieOpeningInch=1.969),
    Die(id="3bba7d44-96da-45ab-8bcd-971cdbae31fc", name="4 Way Die (0.630in) [LS-PBRK-4387]", heightInch=2.362, vdieOpeningInch=0.63),
    Die(id="1c1b4345-d9bd-4338-b0aa-27da63d8f28a", name="4 Way Die (0.866in) [LS-PBRK-4387]", heightInch=2.362, vdieOpeningInch=0.866),
    Die(id="708fa2d2-19ac-44fe-962b-96bab6a78344", name="4 Way Die (1.378in) [LS-PBRK-4387]", heightInch=2.362, vdieOpeningInch=1.378),
    Die(id="fec0ea38-3e8c-4f50-83ed-5ab2d8d87d81", name="4 Way Die (1.969in) [LS-PBRK-4387]", heightInch=2.362, vdieOpeningInch=1.969),
]

STOCK_PUNCHES = [
    Punch(id="f2d6994c-50ef-4f6f-996b-48f383b75462", name="Acute 30\u00b0 Punch [LS-PBRK-9302]", heightInch=4.61),
    Punch(id="357513b0-0d19-428a-b4ab-9f58de5cd685", name="Standard 30\u00b0 Punch [LS-PBRK-3169]", heightInch=4.059),
    Punch(id="1923a1f1-ab16-41f6-96af-7141105259f6", name="Standard 35\u00b0 Punch [LS-PBRK-2287]", heightInch=4.098),
    Punch(id="28790284-76e9-482d-9a1a-091b56e3b885", name="Gooseneck 88\u00b0 Punch [LS-PBRK-8392]", heightInch=3.744),
    Punch(id="895a8956-93e7-4b16-932f-063bd16b1551", name="Extreme Gooseneck 85\u00b0 Punch [LS-PBRK-3924]", heightInch=4.531),
]

STOCK_MATERIALS = [
    Material(id="87fb9b69-fa8d-43c4-9237-f39aa06a7f91", name="Cold Rolled Steel (e.g. A1008)", materialTensileStrengthPsi=45000.0, insideRadiusRuleOfThumb=0.15, materialSpringback=0.7, gaugeThickness=_STEEL_GAUGE),
    Material(id="d6355caf-3606-4a94-9029-7ebd9534bf75", name="Hot Rolled Steel (e.g. A36)", materialTensileStrengthPsi=60000.0, insideRadiusRuleOfThumb=0.14, materialSpringback=1.0, gaugeThickness=_STEEL_GAUGE),
    Material(id="baa62102-6b1a-478b-bc16-e07fc7813a6c", name="Stainless Steel (e.g. 304)", materialTensileStrengthPsi=70000.0, insideRadiusRuleOfThumb=0.2, materialSpringback=3.0, gaugeThickness=_STAINLESS_GAUGE),
    Material(id="b0c40a55-3088-4743-9455-f2d96f8b34b2", name="Soft Aluminum (e.g. 3003 H14)", materialTensileStrengthPsi=26000.0, insideRadiusRuleOfThumb=0.15, materialSpringback=1.0, gaugeThickness=_ALUMINUM_GAUGE),
]


def find_die(query: str) -> Die | None:
    """Find a stock die by partial name match (case-insensitive)."""
    q = query.lower()
    for die in STOCK_DIES:
        if q in die.name.lower():
            return die
    return None


def find_punch(query: str) -> Punch | None:
    """Find a stock punch by partial name match (case-insensitive)."""
    q = query.lower()
    for punch in STOCK_PUNCHES:
        if q in punch.name.lower():
            return punch
    return None


def find_material(query: str) -> Material | None:
    """Find a stock material by partial name match (case-insensitive)."""
    q = query.lower()
    for mat in STOCK_MATERIALS:
        if q in mat.name.lower():
            return mat
    return None
