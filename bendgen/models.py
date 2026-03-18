"""Pydantic models matching BendControl entity JSON schemas."""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# --- Validation limits (from limits.json) ---

LIMITS = {
    "desiredBendAngle": (15.0, 170.0),
    "angleCompensation": (0.0, 90.0),
    "materialThickness": (0.01, 2.5),
    "bendWidth": (0.1, 33.3),
    "punchToMaterialClearance": (0.01, 5.0),
    "additionalRetractAfterBend": (0.0, 3.75),
    "vdieOpeningInch": (0.01, 10.0),
    "punchHeightInch": (0.01, 8.5),
    "dieHeightInch": (0.01, 8.5),
    "materialSpringback": (0.0, 8.5),
}


# --- Storage entities ---

class Die(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    heightInch: float
    vdieOpeningInch: float
    stock: bool = True


class Punch(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    heightInch: float
    stock: bool = True


class Material(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    materialTensileStrengthPsi: float
    insideRadiusRuleOfThumb: float
    materialSpringback: float
    gaugeThickness: dict[int, float] = Field(default_factory=dict)  # gauge# -> thickness (in), UI-only
    stock: bool = True


class Bend(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = ""
    notes: str = ""
    dateCreated: Optional[datetime] = None
    desiredBendAngle: float = 90.0
    angleCompensation: float = 0.0
    angleCompensationReversed: bool = False
    materialThickness: float = 0.06
    punchToMaterialClearance: float = 0.1
    additionalRetractAfterBend: float = 0.0
    bendWidth: float = 12.0
    backGaugeRefEdgeStop: str = "G54"
    backGaugeRefEdgeStopEnabled: bool = False
    backGaugeXPosition: float = 0.0
    backGaugeRPosition: float = 0.0
    backGaugeJogSpeed: float = 0.0
    xAxisNotes: str = ""
    rAxisNotes: str = ""
    overrideFinalBendPositionEnabled: bool = False
    overriddenFinalBendPosition: float = 0.0
    punchId: Optional[UUID] = None
    dieId: Optional[UUID] = None
    materialId: Optional[UUID] = None
    stock: bool = False

    def model_post_init(self, __context):
        if self.dateCreated is None:
            self.dateCreated = datetime.now()


class Program(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = ""
    bendIds: list[UUID] = Field(default_factory=list)
    stock: bool = False
    dateCreated: Optional[datetime] = None

    def model_post_init(self, __context):
        if self.dateCreated is None:
            self.dateCreated = datetime.now()


def validate_bend(bend: Bend) -> list[str]:
    """Validate a bend against machine limits. Returns list of error messages."""
    errors = []
    checks = [
        ("desiredBendAngle", bend.desiredBendAngle),
        ("angleCompensation", bend.angleCompensation),
        ("materialThickness", bend.materialThickness),
        ("bendWidth", bend.bendWidth),
        ("punchToMaterialClearance", bend.punchToMaterialClearance),
        ("additionalRetractAfterBend", bend.additionalRetractAfterBend),
    ]
    for field_name, value in checks:
        lo, hi = LIMITS[field_name]
        if not (lo <= value <= hi):
            errors.append(f"{field_name}: {value} is out of range [{lo}, {hi}]")
    if bend.punchId is None:
        errors.append("punchId is required")
    if bend.dieId is None:
        errors.append("dieId is required")
    if bend.materialId is None:
        errors.append("materialId is required")
    return errors
