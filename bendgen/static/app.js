// BendGen frontend application

let tooling = { dies: [], punches: [], materials: [], limits: {} };
let currentProgramId = null;
let currentView = "table"; // "form" or "table"
let currentUnit = "in"; // "in" or "mm"

const MM_PER_INCH = 25.4;

// Fields that are linear dimensions (need in<->mm conversion)
// Angles and booleans/selects are NOT converted
const LINEAR_FIELDS = new Set([
    "materialThickness",
    "bendWidth",
    "punchToMaterialClearance",
    "additionalRetractAfterBend",
    "backGaugeXPosition",
    "backGaugeRPosition",
    "overriddenFinalBendPosition",
]);

// --- Init ---
document.addEventListener("DOMContentLoaded", async () => {
    await loadTooling();
    await loadPrograms();
    wireEvents();
    wireCustomTooltips();
});

async function loadTooling() {
    const resp = await fetch("/api/tooling");
    tooling = await resp.json();
}

async function loadPrograms() {
    const resp = await fetch("/api/programs");
    const data = await resp.json();
    renderProgramList(data.programs, data.bends);
}

function wireEvents() {
    document.getElementById("addProgramBtn").addEventListener("click", addNewProgram);
    document.getElementById("addBendBtn").addEventListener("click", () => {
        addBendCard();
        const newCard = document.getElementById("bendList").lastElementChild;
        if (newCard) expandBendCard(newCard);
        syncViewFromForm();
    });
    document.getElementById("saveProgramBtn").addEventListener("click", saveProgram);
    document.getElementById("deleteProgramBtn").addEventListener("click", deleteProgram);
    document.getElementById("exportBtn").addEventListener("click", exportZip);
    document.getElementById("deployBtn").addEventListener("click", deployToTitan);
    document.getElementById("importFromTitanBtn").addEventListener("click", importFromTitan);
    document.getElementById("resetBtn").addEventListener("click", resetAll);
    document.getElementById("checkUpdateBtn").addEventListener("click", checkForUpdates);
    document.getElementById("importFile").addEventListener("change", importBackup);
    document.getElementById("importDxfFile").addEventListener("change", importDxf);
    const importImageEl = document.getElementById("importImageFile");
    if (importImageEl) importImageEl.addEventListener("change", importImage);
    document.getElementById("formViewBtn").addEventListener("click", () => switchView("form"));
    document.getElementById("tableViewBtn").addEventListener("click", () => switchView("table"));
    document.getElementById("sidebarToggle").addEventListener("click", toggleSidebar);
    document.getElementById("unitInBtn").addEventListener("click", () => switchUnit("in"));
    document.getElementById("unitMmBtn").addEventListener("click", () => switchUnit("mm"));
    wireToolingModal();
    // DXF preview modal
    document.getElementById("closeDxfPreview").addEventListener("click", closeDxfPreview);
    document.getElementById("dxfCancelBtn").addEventListener("click", closeDxfPreview);
    document.getElementById("dxfApplyBtn").addEventListener("click", applyDxfImport);
    document.getElementById("dxfPreviewModal").addEventListener("click", (e) => {
        if (e.target.id === "dxfPreviewModal") closeDxfPreview();
    });
    wireDxfResizeHandle();
    wireAccordions();
}

// --- Sidebar accordions ---
function wireAccordions() {
    document.querySelectorAll(".panel-accordion-toggle").forEach(toggle => {
        toggle.addEventListener("click", () => {
            const isActive = toggle.classList.contains("active");
            // Close all
            document.querySelectorAll(".panel-accordion-toggle").forEach(t => {
                t.classList.remove("active");
                const body = t.closest(".panel-accordion").querySelector(".panel-accordion-body");
                if (body) body.classList.add("hidden");
            });
            // Open clicked one (unless it was already open)
            if (!isActive) {
                toggle.classList.add("active");
                const body = toggle.closest(".panel-accordion").querySelector(".panel-accordion-body");
                if (body) body.classList.remove("hidden");
            }
        });
    });
}

// --- DXF split pane resize ---
function wireDxfResizeHandle() {
    const handle = document.getElementById("dxfResizeHandle");
    const layout = document.getElementById("dxfPreviewLayout");
    const svgCol = document.getElementById("dxfSvgColumn");
    if (!handle || !layout || !svgCol) return;

    let dragging = false;

    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragging = true;
        handle.classList.add("active");
        layout.classList.add("resizing");
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const rect = layout.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = (x / rect.width) * 100;
        // Clamp between 15% and 70%
        const clamped = Math.max(15, Math.min(70, pct));
        svgCol.style.width = clamped + "%";
    });

    document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove("active");
        layout.classList.remove("resizing");
    });
}

// --- Unit conversion ---
function switchUnit(unit) {
    if (unit === currentUnit) return;
    const oldUnit = currentUnit;
    currentUnit = unit;

    document.getElementById("unitInBtn").classList.toggle("active", unit === "in");
    document.getElementById("unitMmBtn").classList.toggle("active", unit === "mm");

    // Update all unit labels in the DOM
    document.querySelectorAll(".unit-label").forEach(el => { el.textContent = unit; });

    // Convert all visible linear inputs in form view
    document.querySelectorAll("#bendList [data-linear]").forEach(input => {
        convertInputValue(input, oldUnit, unit);
        updateLinearMinMax(input);
    });

    // Update min/max on the template too (for new cards)
    document.querySelectorAll("#bendTemplate [data-linear]").forEach(input => {
        updateLinearMinMax(input);
    });

    // Re-render table if active (it reads from form cards)
    if (currentView === "table") {
        renderTableFromForm();
    }

    // Re-render gauge grid if the tooling modal is open
    reRenderGaugeGridForUnit();
}

function updateLinearMinMax(input) {
    const limits = tooling.limits[input.name];
    if (limits) {
        input.min = toDisplay(limits[0]);
        input.max = toDisplay(limits[1]);
    }
    // Adjust step for mm (coarser) vs in (finer)
    if (input.step) {
        const baseStep = parseFloat(input.getAttribute("data-step-in") || input.step);
        if (!input.getAttribute("data-step-in")) input.setAttribute("data-step-in", baseStep);
        input.step = currentUnit === "mm" ? roundSmart(baseStep * MM_PER_INCH, 3) : baseStep;
    }
}

function convertInputValue(input, fromUnit, toUnit) {
    const val = parseFloat(input.value);
    if (isNaN(val) || val === 0) return;
    if (fromUnit === "in" && toUnit === "mm") {
        input.value = roundSmart(val * MM_PER_INCH, 3);
    } else if (fromUnit === "mm" && toUnit === "in") {
        input.value = roundSmart(val / MM_PER_INCH, 4);
    }
}

function toInches(val) {
    if (currentUnit === "mm") return val / MM_PER_INCH;
    return val;
}

function toDisplay(valInches) {
    if (currentUnit === "mm") return roundSmart(valInches * MM_PER_INCH, 3);
    return valInches;
}

function roundSmart(val, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
}

// --- Sidebar collapse ---
function toggleSidebar() {
    const panel = document.getElementById("programsPanel");
    const btn = document.getElementById("sidebarToggle");
    const collapsed = panel.classList.toggle("collapsed");
    btn.classList.toggle("collapsed", collapsed);
    btn.innerHTML = collapsed ? "&rsaquo;" : "&lsaquo;";
}

// --- View toggle ---
function switchView(view) {
    if (view === currentView) return;

    // Sync data from the current view before switching
    if (currentView === "table") {
        syncFormFromTable();
    }

    currentView = view;
    document.getElementById("formViewBtn").classList.toggle("active", view === "form");
    document.getElementById("tableViewBtn").classList.toggle("active", view === "table");
    document.getElementById("bendList").classList.toggle("hidden", view === "table");
    document.getElementById("bendTable").classList.toggle("hidden", view === "form");

    if (view === "table") {
        renderTableFromForm();
    }
}

function syncViewFromForm() {
    if (currentView === "table") {
        renderTableFromForm();
    }
}

// --- Program list ---
function renderProgramList(programs, bends) {
    const list = document.getElementById("programList");
    list.innerHTML = "";
    programs.forEach(p => {
        const li = document.createElement("li");
        li.dataset.id = p.id;
        if (p.id === currentProgramId) li.classList.add("active");
        li.innerHTML = `
            <div class="prog-main">
                <div class="prog-name">${escHtml(p.name || "Untitled")}</div>
                <div class="prog-info">${p.bendIds.length} bend${p.bendIds.length !== 1 ? "s" : ""}</div>
            </div>
            <div class="prog-actions">
                <button class="prog-action-btn prog-dup-btn" title="Duplicate this program">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
                <button class="prog-action-btn prog-del-btn" title="Delete this program">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                </button>
            </div>
        `;
        li.querySelector(".prog-main").addEventListener("click", () => selectProgram(p.id));
        li.querySelector(".prog-dup-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            duplicateProgramById(p.id);
        });
        li.querySelector(".prog-del-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteProgramById(p.id, p.name);
        });
        list.appendChild(li);
    });
}

async function duplicateProgramById(programId) {
    const resp = await fetch("/api/programs");
    const data = await resp.json();
    const program = data.programs.find(p => p.id === programId);
    if (!program) return;

    const programBends = program.bendIds.map(bid => {
        const bend = data.bends.find(b => b.id === bid);
        if (!bend) return null;
        const copy = { ...bend };
        copy.id = crypto.randomUUID();
        return copy;
    }).filter(Boolean);

    const saveResp = await fetch("/api/program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: program.name + " (Copy)",
            bends: programBends,
        }),
    });
    const result = await saveResp.json();
    if (result.ok) {
        await loadPrograms();
        showStatus(`Duplicated "${program.name}"`, "success");
    }
}

async function deleteProgramById(programId, programName) {
    if (!confirm(`Delete "${programName || "Untitled"}" and its bends?`)) return;
    await fetch(`/api/program/${programId}`, { method: "DELETE" });
    if (currentProgramId === programId) {
        currentProgramId = null;
        document.getElementById("programEditor").classList.add("hidden");
        document.getElementById("noSelection").classList.remove("hidden");
        document.getElementById("bendTable").innerHTML = "";
    }
    await loadPrograms();
    showStatus("Program deleted", "info");
}

async function selectProgram(programId) {
    currentProgramId = programId;
    const resp = await fetch("/api/programs");
    const data = await resp.json();
    renderProgramList(data.programs, data.bends);

    const program = data.programs.find(p => p.id === programId);
    if (!program) return;

    document.getElementById("noSelection").classList.add("hidden");
    document.getElementById("programEditor").classList.remove("hidden");
    document.getElementById("programName").value = program.name;

    const bendList = document.getElementById("bendList");
    bendList.innerHTML = "";
    program.bendIds.forEach((bendId, i) => {
        const bend = data.bends.find(b => b.id === bendId);
        if (bend) addBendCard(null, bend, i);
    });

    if (currentView === "table") {
        renderTableFromForm();
    }
}

function addNewProgram() {
    currentProgramId = crypto.randomUUID();
    document.getElementById("noSelection").classList.add("hidden");
    document.getElementById("programEditor").classList.remove("hidden");
    document.getElementById("programName").value = "";
    document.getElementById("bendList").innerHTML = "";
    document.getElementById("bendTable").innerHTML = "";
    addBendCard();
    syncViewFromForm();
}

// --- Bend cards (form view) ---
function addBendCard(event, existingBend, index) {
    const template = document.getElementById("bendTemplate");
    const card = template.content.cloneNode(true).querySelector(".bend-card");
    const bendList = document.getElementById("bendList");
    const num = index !== undefined ? index + 1 : bendList.children.length + 1;

    card.querySelector(".bend-number").textContent = num;
    card.dataset.bendId = existingBend ? existingBend.id : crypto.randomUUID();

    populateSelect(card.querySelector('[name="dieId"]'), tooling.dies, "id", "name",
        existingBend ? existingBend.dieId : null);
    populateSelect(card.querySelector('[name="punchId"]'), tooling.punches, "id", "name",
        existingBend ? existingBend.punchId : null);
    populateSelect(card.querySelector('[name="materialId"]'), tooling.materials, "id", "name",
        existingBend ? existingBend.materialId : null);

    if (existingBend) {
        card.querySelector(".bend-name").value = existingBend.name || "";
        setField(card, "desiredBendAngle", existingBend.desiredBendAngle);
        setFieldLinear(card, "materialThickness", existingBend.materialThickness);
        setFieldLinear(card, "bendWidth", existingBend.bendWidth);
        setFieldLinear(card, "punchToMaterialClearance", existingBend.punchToMaterialClearance);
        setField(card, "angleCompensation", existingBend.angleCompensation);
        setFieldLinear(card, "additionalRetractAfterBend", existingBend.additionalRetractAfterBend);
        setFieldLinear(card, "backGaugeXPosition", existingBend.backGaugeXPosition);
        setFieldLinear(card, "backGaugeRPosition", existingBend.backGaugeRPosition);
        setFieldLinear(card, "overriddenFinalBendPosition", existingBend.overriddenFinalBendPosition);
        setSelect(card, "angleCompensationReversed", String(existingBend.angleCompensationReversed));
        setSelect(card, "backGaugeRefEdgeStop", existingBend.backGaugeRefEdgeStop);
        // BG enabled is now a checkbox
        const bgCheck = card.querySelector('.bg-toggle');
        if (bgCheck) {
            bgCheck.checked = existingBend.backGaugeRefEdgeStopEnabled === true || existingBend.backGaugeRefEdgeStopEnabled === "true";
            updateBgFieldsState(card);
        }
        const overrideCheck = card.querySelector('.override-toggle');
        if (overrideCheck) overrideCheck.checked = existingBend.overrideFinalBendPositionEnabled === true || existingBend.overrideFinalBendPositionEnabled === "true";
        const notes = card.querySelector('[name="notes"]');
        if (notes) notes.value = existingBend.notes || "";
    } else if (currentUnit === "mm") {
        // Convert template defaults (hardcoded in inches) to mm
        card.querySelectorAll("[data-linear]").forEach(input => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && val !== 0) input.value = roundSmart(val * MM_PER_INCH, 3);
        });
    }

    // Update unit labels in this card
    card.querySelectorAll(".unit-label").forEach(el => { el.textContent = currentUnit; });

    // Wire BG toggle to enable/disable BG fields
    const bgToggle = card.querySelector('.bg-toggle');
    if (bgToggle) {
        updateBgFieldsState(card);
        bgToggle.addEventListener("change", () => updateBgFieldsState(card));
    }

    // Wire View DXF button if this bend came from a DXF import
    if (existingBend && existingBend._dxfSourceId) {
        card.dataset.dxfSourceId = existingBend._dxfSourceId;
        card.dataset.dxfPlanIndex = existingBend._dxfPlanIndex;
        const viewDxfBtn = card.querySelector(".bend-view-dxf");
        viewDxfBtn.classList.remove("hidden");
        viewDxfBtn.addEventListener("click", () => {
            openDxfViewer(existingBend._dxfSourceId, existingBend._dxfPlanIndex);
        });
    }

    // Add summary span to header (shown when collapsed)
    const summarySpan = document.createElement("span");
    summarySpan.className = "bend-header-summary";
    card.querySelector(".bend-header").insertBefore(summarySpan, card.querySelector(".bend-toggle"));

    // Wire toggle, duplicate, and remove
    card.querySelector(".bend-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        card.querySelector(".bend-advanced").classList.toggle("hidden");
    });
    card.querySelector(".bend-duplicate").addEventListener("click", (e) => {
        e.stopPropagation();
        duplicateBendCard(card);
    });
    card.querySelector(".bend-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        card.remove();
        renumberBends();
        syncViewFromForm();
    });

    // Accordion: click header to expand/collapse
    card.querySelector(".bend-header").addEventListener("click", (e) => {
        // Don't toggle when clicking input fields or buttons
        if (e.target.closest("input, button, .bend-view-dxf")) return;
        if (card.classList.contains("collapsed")) {
            expandBendCard(card);
        } else {
            card.classList.add("collapsed");
            _updateBendSummary(card);
        }
    });

    // Drag and drop
    card.setAttribute("draggable", "true");
    card.addEventListener("dragstart", (e) => {
        if (card.classList.contains("collapsed")) { e.preventDefault(); return; }
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        document.querySelectorAll(".bend-card.drag-over").forEach(c => c.classList.remove("drag-over"));
        renumberBends();
    });
    card.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = document.querySelector(".bend-card.dragging");
        if (dragging && dragging !== card) card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");
        const dragging = document.querySelector(".bend-card.dragging");
        if (dragging && dragging !== card) bendList.insertBefore(dragging, card);
    });

    card.querySelectorAll("input[type=number]").forEach(input => {
        input.addEventListener("input", () => validateField(input));
    });

    bendList.appendChild(card);

    // Accordion state: first card expanded with advanced shown, others collapsed
    const isFirst = bendList.children.length === 1;
    if (isFirst) {
        card.classList.remove("collapsed");
        card.querySelector(".bend-advanced").classList.remove("hidden");
    } else {
        card.classList.add("collapsed");
        _updateBendSummary(card);
    }
}

function expandBendCard(card) {
    // Collapse all other cards first
    document.querySelectorAll("#bendList .bend-card").forEach(c => {
        if (c !== card) {
            c.classList.add("collapsed");
            _updateBendSummary(c);
        }
    });
    card.classList.remove("collapsed");
    // Show advanced when expanding
    card.querySelector(".bend-advanced").classList.remove("hidden");
}

function _updateBendSummary(card) {
    const summary = card.querySelector(".bend-header-summary");
    if (!summary) return;
    const angle = card.querySelector('[name="desiredBendAngle"]')?.value || "90";
    const thickness = card.querySelector('[name="materialThickness"]')?.value || "";
    const width = card.querySelector('[name="bendWidth"]')?.value || "";
    const unit = currentUnit;
    const parts = [`${angle}\u00B0`];
    if (thickness) parts.push(`T: ${thickness}${unit}`);
    if (width) parts.push(`W: ${width}${unit}`);
    const die = card.querySelector('[name="dieId"]');
    if (die && die.value) {
        const opt = die.options[die.selectedIndex];
        if (opt) parts.push(opt.textContent.split("[")[0].trim().substring(0, 20));
    }
    summary.textContent = "\u2014 " + parts.join(", ");
}

function duplicateBendCard(sourceCard) {
    const bendData = collectBendFromCard(sourceCard);
    bendData.id = crypto.randomUUID();
    bendData.name = bendData.name ? bendData.name + " (copy)" : "Copy";
    addBendCard(null, bendData);
    // Expand the new card
    const newCard = document.getElementById("bendList").lastElementChild;
    if (newCard) expandBendCard(newCard);
    renumberBends();
    syncViewFromForm();
}

function collectBendFromCard(card) {
    const get = (name) => {
        const el = card.querySelector(`[name="${name}"]`);
        return el ? el.value : undefined;
    };
    const lin = (name, fallback) => {
        const v = parseFloat(get(name));
        return toInches(isNaN(v) ? fallback : v);
    };
    return {
        id: card.dataset.bendId,
        name: card.querySelector(".bend-name").value,
        notes: get("notes") || "",
        desiredBendAngle: parseFloat(get("desiredBendAngle")) || 90,
        angleCompensation: parseFloat(get("angleCompensation")) || 0,
        angleCompensationReversed: get("angleCompensationReversed") === "true",
        materialThickness: lin("materialThickness", 0.06),
        punchToMaterialClearance: lin("punchToMaterialClearance", 0.1),
        additionalRetractAfterBend: lin("additionalRetractAfterBend", 0),
        bendWidth: lin("bendWidth", 12),
        backGaugeRefEdgeStop: get("backGaugeRefEdgeStop") || "G54",
        backGaugeRefEdgeStopEnabled: !!card.querySelector('.bg-toggle')?.checked,
        backGaugeXPosition: lin("backGaugeXPosition", 0),
        backGaugeRPosition: lin("backGaugeRPosition", 0),
        backGaugeJogSpeed: parseFloat(get("backGaugeJogSpeed")) || 0,
        overrideFinalBendPositionEnabled: !!card.querySelector('.override-toggle')?.checked,
        overriddenFinalBendPosition: lin("overriddenFinalBendPosition", 0),
        punchId: get("punchId") || null,
        dieId: get("dieId") || null,
        materialId: get("materialId") || null,
        _dxfSourceId: card.dataset.dxfSourceId || null,
        _dxfPlanIndex: card.dataset.dxfPlanIndex != null ? parseInt(card.dataset.dxfPlanIndex) : null,
    };
}

function updateBgFieldsState(card) {
    const bgCheck = card.querySelector('.bg-toggle');
    const enabled = bgCheck && bgCheck.checked;
    card.querySelectorAll('.bg-field input, .bg-field select').forEach(el => {
        el.disabled = !enabled;
    });
}

function populateSelect(select, items, valueKey, labelKey, selectedValue) {
    select.innerHTML = '<option value="">-- Select --</option>';
    items.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item[valueKey];
        opt.textContent = item[labelKey];
        if (item[valueKey] === selectedValue) opt.selected = true;
        select.appendChild(opt);
    });
}

function setField(card, name, value) {
    const input = card.querySelector(`[name="${name}"]`);
    if (input && value !== undefined && value !== null) input.value = value;
}

function setFieldLinear(card, name, valueInches) {
    const input = card.querySelector(`[name="${name}"]`);
    if (input && valueInches !== undefined && valueInches !== null) {
        input.value = toDisplay(valueInches);
    }
}

function setSelect(card, name, value) {
    const sel = card.querySelector(`[name="${name}"]`);
    if (sel && value !== undefined) sel.value = value;
}

function renumberBends() {
    document.querySelectorAll("#bendList .bend-card").forEach((card, i) => {
        card.querySelector(".bend-number").textContent = i + 1;
    });
}

function validateField(input) {
    const name = input.name;
    const limits = tooling.limits[name];
    if (!limits) return;
    const val = parseFloat(input.value);
    let [min, max] = limits;
    if (LINEAR_FIELDS.has(name)) {
        min = toDisplay(min);
        max = toDisplay(max);
    }
    if (isNaN(val) || val < min || val > max) {
        input.classList.add("invalid");
    } else {
        input.classList.remove("invalid");
    }
}

// --- Table view ---

const TABLE_COLUMNS = [
    { key: "_actions",                  label: "",            type: "actions" },
    { key: "#",                         label: "#",           type: "drag" },
    { key: "name",                      label: "Name",        type: "text" },
    { key: "desiredBendAngle",          label: "Angle (\u00b0)",     type: "number", step: "0.1" },
    { key: "materialThickness",         label: "Thickness",   type: "number", step: "0.001" },
    { key: "bendWidth",                 label: "Width",       type: "number", step: "0.1" },
    { key: "backGaugeRefEdgeStopEnabled", label: "BG ?",      type: "bool" },
    { key: "backGaugeXPosition",        label: "BG X",        type: "number", step: "0.001" },
    { key: "dieId",                     label: "Die",         type: "select", source: "dies" },
    { key: "punchId",                   label: "Punch",       type: "select", source: "punches" },
    { key: "materialId",                label: "Material",    type: "select", source: "materials" },
    { key: "angleCompensationReversed", label: "Comp Dir",    type: "select", options: [
        { value: "false", label: "Underbent" }, { value: "true", label: "Overbent" }
    ]},
    { key: "angleCompensation",         label: "Comp (\u00b0)",      type: "number", step: "0.1" },
    { key: "punchToMaterialClearance",  label: "Clearance",   type: "number", step: "0.01" },
    { key: "additionalRetractAfterBend",label: "Retract",     type: "number", step: "0.01" },
    { key: "backGaugeRPosition",        label: "BG R",        type: "number", step: "0.001" },
    { key: "backGaugeRefEdgeStop",      label: "BG Ref",      type: "select", options: [
        { value: "G54", label: "G54 - Lower" }, { value: "G55", label: "G55 - Upper" },
        { value: "G56", label: "G56" }, { value: "G57", label: "G57" },
        { value: "G58", label: "G58" }, { value: "G59", label: "G59" }
    ]},
];

function renderTableFromForm() {
    const bends = collectBendsFromForm();
    const wrap = document.getElementById("bendTable");
    wrap.innerHTML = "";

    const table = document.createElement("table");
    table.className = "bend-table";

    // Header
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    TABLE_COLUMNS.forEach(col => {
        const th = document.createElement("th");
        if (LINEAR_FIELDS.has(col.key)) {
            th.textContent = col.label + " (" + currentUnit + ")";
        } else {
            th.textContent = col.label;
        }
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    bends.forEach((bend, i) => {
        const tr = buildTableRow(bend, i);
        tbody.appendChild(tr);
    });

    // Always append an empty row for quick entry
    const emptyBend = makeEmptyBend();
    const emptyRow = buildTableRow(emptyBend, bends.length);
    emptyRow.classList.add("empty-row");
    tbody.appendChild(emptyRow);

    table.appendChild(tbody);
    wrap.appendChild(table);
}

function makeEmptyBend() {
    return {
        id: crypto.randomUUID(),
        name: "",
        notes: "",
        desiredBendAngle: 90,
        angleCompensation: 0,
        angleCompensationReversed: false,
        materialThickness: 0.06,
        punchToMaterialClearance: 0.1,
        additionalRetractAfterBend: 0,
        bendWidth: 12,
        backGaugeRefEdgeStop: "G54",
        backGaugeRefEdgeStopEnabled: false,
        backGaugeXPosition: 0,
        backGaugeRPosition: 0,
        backGaugeJogSpeed: 0,
        overrideFinalBendPositionEnabled: false,
        overriddenFinalBendPosition: 0,
        punchId: null,
        dieId: null,
        materialId: null,
    };
}

function buildTableRow(bend, index) {
    const tr = document.createElement("tr");
    tr.dataset.bendId = bend.id;
    tr.setAttribute("draggable", "true");

    // Row drag
    tr.addEventListener("dragstart", (e) => {
        tr.classList.add("dragging-row");
        e.dataTransfer.effectAllowed = "move";
    });
    tr.addEventListener("dragend", () => {
        tr.classList.remove("dragging-row");
        document.querySelectorAll(".drag-over-row").forEach(r => r.classList.remove("drag-over-row"));
        renumberTableRows();
        syncFormFromTable();
    });
    tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = document.querySelector(".dragging-row");
        if (dragging && dragging !== tr) tr.classList.add("drag-over-row");
    });
    tr.addEventListener("dragleave", () => tr.classList.remove("drag-over-row"));
    tr.addEventListener("drop", (e) => {
        e.preventDefault();
        tr.classList.remove("drag-over-row");
        const dragging = document.querySelector(".dragging-row");
        if (dragging && dragging !== tr) {
            tr.parentElement.insertBefore(dragging, tr);
        }
    });

    TABLE_COLUMNS.forEach(col => {
        const td = document.createElement("td");

        if (col.type === "drag") {
            const num = document.createElement("span");
            num.className = "row-num";
            num.textContent = index + 1;
            td.appendChild(num);
        } else if (col.type === "text") {
            const input = document.createElement("input");
            input.type = "text";
            input.name = col.key;
            input.value = bend[col.key] || "";
            td.appendChild(input);
        } else if (col.type === "number") {
            const input = document.createElement("input");
            input.type = "number";
            input.name = col.key;
            const rawVal = bend[col.key] ?? "";
            input.value = (rawVal !== "" && LINEAR_FIELDS.has(col.key)) ? toDisplay(rawVal) : rawVal;
            if (col.step) input.step = col.step;
            const limits = tooling.limits[col.key];
            if (limits) {
                if (LINEAR_FIELDS.has(col.key)) {
                    input.min = toDisplay(limits[0]);
                    input.max = toDisplay(limits[1]);
                } else {
                    input.min = limits[0];
                    input.max = limits[1];
                }
            }
            input.addEventListener("input", () => validateField(input));
            td.appendChild(input);
        } else if (col.type === "select" && col.source) {
            const select = document.createElement("select");
            select.name = col.key;
            const items = tooling[col.source] || [];
            populateSelect(select, items, "id", "name", bend[col.key]);
            td.appendChild(select);
        } else if (col.type === "select" && col.options) {
            const select = document.createElement("select");
            select.name = col.key;
            col.options.forEach(opt => {
                const o = document.createElement("option");
                o.value = opt.value;
                o.textContent = opt.label;
                if (opt.value === bend[col.key]) o.selected = true;
                select.appendChild(o);
            });
            td.appendChild(select);
        } else if (col.type === "bool") {
            td.classList.add("col-bool");
            const lbl = document.createElement("label");
            lbl.className = "tbl-toggle";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.name = col.key;
            cb.checked = bend[col.key] === true || bend[col.key] === "true";
            const track = document.createElement("span");
            track.className = "tbl-toggle-track";
            lbl.appendChild(cb);
            lbl.appendChild(track);
            td.appendChild(lbl);
        } else if (col.type === "actions") {
            td.innerHTML = `<div class="row-actions">
                <button class="icon-btn tbl-dup" title="Duplicate row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
                <button class="icon-btn icon-btn-danger tbl-del" title="Delete row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>`;
            td.querySelector(".tbl-dup").addEventListener("click", () => {
                duplicateTableRow(tr);
            });
            td.querySelector(".tbl-del").addEventListener("click", () => {
                tr.remove();
                renumberTableRows();
                syncFormFromTable();
            });
        }

        tr.appendChild(td);
    });

    // If any field is edited in an empty row, promote it and add a new empty row below
    tr.addEventListener("input", () => {
        if (tr.classList.contains("empty-row")) {
            tr.classList.remove("empty-row");
            const tbody = tr.parentElement;
            const newEmpty = buildTableRow(makeEmptyBend(), tbody.children.length);
            newEmpty.classList.add("empty-row");
            tbody.appendChild(newEmpty);
            renumberTableRows();
        }
    });
    tr.addEventListener("change", () => {
        if (tr.classList.contains("empty-row")) {
            tr.classList.remove("empty-row");
            const tbody = tr.parentElement;
            const newEmpty = buildTableRow(makeEmptyBend(), tbody.children.length);
            newEmpty.classList.add("empty-row");
            tbody.appendChild(newEmpty);
            renumberTableRows();
        }
    });

    return tr;
}

function duplicateTableRow(sourceRow) {
    const bend = collectBendFromTableRow(sourceRow);
    bend.id = crypto.randomUUID();
    bend.name = bend.name ? bend.name + " (copy)" : "Copy";
    const tbody = sourceRow.parentElement;
    const newIndex = Array.from(tbody.children).indexOf(sourceRow) + 1;
    const newRow = buildTableRow(bend, newIndex);
    sourceRow.after(newRow);
    renumberTableRows();
    syncFormFromTable();
}

function collectBendFromTableRow(tr) {
    const get = (name) => {
        const el = tr.querySelector(`[name="${name}"]`);
        return el ? el.value : undefined;
    };
    const lin = (name, fallback) => {
        const v = parseFloat(get(name));
        return toInches(isNaN(v) ? fallback : v);
    };
    return {
        id: tr.dataset.bendId,
        name: get("name") || "",
        notes: "",
        desiredBendAngle: parseFloat(get("desiredBendAngle")) || 90,
        angleCompensation: parseFloat(get("angleCompensation")) || 0,
        angleCompensationReversed: get("angleCompensationReversed") === "true",
        materialThickness: lin("materialThickness", 0.06),
        punchToMaterialClearance: lin("punchToMaterialClearance", 0.1),
        additionalRetractAfterBend: lin("additionalRetractAfterBend", 0),
        bendWidth: lin("bendWidth", 12),
        backGaugeRefEdgeStop: get("backGaugeRefEdgeStop") || "G54",
        backGaugeRefEdgeStopEnabled: !!tr.querySelector('[name="backGaugeRefEdgeStopEnabled"]')?.checked,
        backGaugeXPosition: lin("backGaugeXPosition", 0),
        backGaugeRPosition: lin("backGaugeRPosition", 0),
        backGaugeJogSpeed: parseFloat(get("backGaugeJogSpeed")) || 0,
        overrideFinalBendPositionEnabled: false,
        overriddenFinalBendPosition: 0,
        punchId: get("punchId") || null,
        dieId: get("dieId") || null,
        materialId: get("materialId") || null,
    };
}

function renumberTableRows() {
    document.querySelectorAll("#bendTable tbody tr").forEach((tr, i) => {
        const num = tr.querySelector(".row-num");
        if (num) num.textContent = i + 1;
    });
}

function syncFormFromTable() {
    // Collect all data from table, skip empty rows
    const rows = document.querySelectorAll("#bendTable tbody tr:not(.empty-row)");
    const bends = Array.from(rows).map(tr => collectBendFromTableRow(tr));

    const bendList = document.getElementById("bendList");
    bendList.innerHTML = "";
    bends.forEach((bend, i) => addBendCard(null, bend, i));
}

// --- Collect bends from whichever view is active ---
function collectBendsFromForm() {
    const cards = document.querySelectorAll("#bendList .bend-card");
    return Array.from(cards).map(card => collectBendFromCard(card));
}

function collectBendsFromActiveView() {
    if (currentView === "table") {
        const rows = document.querySelectorAll("#bendTable tbody tr:not(.empty-row)");
        return Array.from(rows).map(tr => collectBendFromTableRow(tr));
    }
    return collectBendsFromForm();
}

// --- Save / Delete ---
async function saveProgram() {
    const name = document.getElementById("programName").value.trim();
    if (!name) {
        showStatus("Please enter a program name", "error");
        return;
    }
    const bends = collectBendsFromActiveView();
    if (bends.length === 0) {
        showStatus("Add at least one bend", "error");
        return;
    }

    const resp = await fetch("/api/program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentProgramId, name, bends }),
    });
    const data = await resp.json();

    if (data.ok) {
        showStatus(`Program "${name}" saved with ${bends.length} bend(s)`, "success");
        await loadPrograms();
        await selectProgram(currentProgramId);
    } else {
        const errMsgs = data.errors.map(e =>
            `Bend "${e.name}": ${e.errors.join(", ")}`
        ).join("\n");
        showStatus("Validation errors:\n" + errMsgs, "error");
    }
}

async function deleteProgram() {
    if (!currentProgramId) return;
    if (!confirm("Delete this program and its bends?")) return;

    await fetch(`/api/program/${currentProgramId}`, { method: "DELETE" });
    currentProgramId = null;
    document.getElementById("programEditor").classList.add("hidden");
    document.getElementById("noSelection").classList.remove("hidden");
    document.getElementById("bendTable").innerHTML = "";
    await loadPrograms();
    showStatus("Program deleted", "info");
}

// --- Import / Export ---
async function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch("/api/import", { method: "POST", body: formData });
    const data = await resp.json();

    if (data.ok) {
        const c = data.counts;
        showStatus(
            `Imported: ${c.bends} bends, ${c.programs} programs, ${c.dies} dies, ${c.punches} punches, ${c.materials} materials`,
            "success"
        );
        currentProgramId = null;
        document.getElementById("programEditor").classList.add("hidden");
        document.getElementById("noSelection").classList.remove("hidden");
        document.getElementById("bendTable").innerHTML = "";
        await loadTooling();
        await loadPrograms();
    } else {
        showStatus("Import failed: " + data.error, "error");
    }
    event.target.value = "";
}

// --- DXF Sources: stored SVG + bend mapping for viewing from program editor ---
// Key: dxfSourceId, Value: { svg, bends (from analysis), programName, bendMapping: [{planIndex, bendIndices}] }
const _dxfSources = {};

// --- Import mode: "dxf" or "image" ---
let _importMode = "dxf";

// --- DXF Import with Preview & Bend Planner ---
let _dxfAnalysis = null;  // current analysis data from server
let _dxfBendPlan = [];    // [{index, edge, mergedIndices?, ...}, ...] — ordered bend plan
let _dxfSelectedRows = new Set();  // order indices selected for merging

function _getBendWidth(plan) {
    // For merged bends, sum the widths of all constituent segments
    const a = _dxfAnalysis;
    if (plan.mergedIndices && plan.mergedIndices.length > 1) {
        return plan.mergedIndices.reduce((sum, idx) => {
            const b = a.bends[idx];
            return sum + (b.bend_width || 0);
        }, 0);
    }
    const b = a.bends[plan.index];
    return b.bend_width || 0;
}

function _mergeSelectedBends() {
    if (_dxfSelectedRows.size < 2) {
        showStatus("Select 2 or more bends to merge", "error");
        return;
    }
    const sortedOrders = Array.from(_dxfSelectedRows).sort((a, b) => a - b);
    const firstOrder = sortedOrders[0];
    const firstPlan = _dxfBendPlan[firstOrder];

    // Collect all original bend indices from all selected rows (handles already-merged rows)
    const allIndices = [];
    sortedOrders.forEach(oi => {
        const p = _dxfBendPlan[oi];
        if (p.mergedIndices) {
            allIndices.push(...p.mergedIndices);
        } else {
            allIndices.push(p.index);
        }
    });

    // Create merged plan entry using the first selected row as the base
    const merged = {
        ...firstPlan,
        mergedIndices: allIndices,
    };

    // Remove selected rows (in reverse to preserve indices) and insert merged
    const newPlan = [];
    let inserted = false;
    _dxfBendPlan.forEach((p, i) => {
        if (_dxfSelectedRows.has(i)) {
            if (!inserted) {
                newPlan.push(merged);
                inserted = true;
            }
            // skip other selected rows
        } else {
            newPlan.push(p);
        }
    });

    _dxfBendPlan = newPlan;
    _dxfSelectedRows.clear();
    renderDxfBendPlanner();
    _updateAllSvgBends();
}

function _splitBend(orderIdx) {
    const plan = _dxfBendPlan[orderIdx];
    if (!plan.mergedIndices || plan.mergedIndices.length <= 1) return;

    // Expand back into individual entries
    const expanded = plan.mergedIndices.map(idx => {
        const b = _dxfAnalysis.bends[idx];
        return {
            index: idx,
            edge: plan.edge,
            angle: b.angle,
            direction: b.direction || plan.direction,
            dieId: plan.dieId,
            punchId: plan.punchId,
            bgFinger: plan.bgFinger,
        };
    });

    _dxfBendPlan.splice(orderIdx, 1, ...expanded);
    _dxfSelectedRows.clear();
    renderDxfBendPlanner();
    _updateAllSvgBends();
}

async function importDxf(event) {
    const file = event.target.files[0];
    if (!file) return;

    showStatus("Analyzing DXF drawing...", "info");

    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch("/api/analyze-dxf", { method: "POST", body: formData });
    const data = await resp.json();
    event.target.value = "";

    if (!data.ok) {
        const errMsg = data.errors ? data.errors.join(", ") : "Unknown error";
        showStatus("DXF analysis failed: " + errMsg, "error");
        return;
    }

    _importMode = "dxf";
    _dxfAnalysis = data.analysis;
    // Default plan: pick closest parallel edge for each bend
    _dxfBendPlan = _dxfAnalysis.bends.map((b, i) => ({
        index: i, edge: _defaultEdgeForBend(b), angle: b.angle,
        direction: b.direction || "UP",
        dieId: null, punchId: null, bgFinger: "G54",
    }));
    // Backend tells us if there are horizontal bend lines needing T/B edges
    _dxfHasHorizontalBends = _dxfAnalysis.has_horizontal_bends || false;
    openDxfPreview();
}

async function importImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    showStatus("Analyzing image...", "info");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const resp = await fetch("/api/analyze-image", { method: "POST", body: formData });
        const data = await resp.json();
        event.target.value = "";

        if (!data.ok) {
            showStatus("Image analysis failed: " + (data.error || "Unknown error"), "error");
            return;
        }

        _importMode = "image";
        _dxfAnalysis = data.analysis;
        _dxfBendPlan = _dxfAnalysis.bends.map((b, i) => ({
            index: i,
            edge: "left",
            angle: b.angle || 90,
            direction: b.direction || "UP",
            bendWidth: 0,
            bgX: 0,
            dieId: null,
            punchId: null,
            bgFinger: "G54",
        }));
        _dxfHasHorizontalBends = false;
        openDxfPreview();
    } catch (err) {
        showStatus("Image analysis failed: " + err.message, "error");
        event.target.value = "";
    }
}

// Check if any bends are oriented horizontally (needing T/B edges)
let _dxfHasHorizontalBends = false;

function _populateDxfSelect(selEl, items, valueKey, labelKey, selectedVal) {
    selEl.innerHTML = '<option value="">— default —</option>';
    items.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item[valueKey];
        opt.textContent = item[labelKey];
        if (selectedVal && item[valueKey] === selectedVal) opt.selected = true;
        selEl.appendChild(opt);
    });
}

function openDxfPreview() {
    const a = _dxfAnalysis;
    const modal = document.getElementById("dxfPreviewModal");
    modal.classList.remove("hidden");

    // Update modal title based on mode
    const modalTitle = modal.querySelector(".modal-header h2");
    if (modalTitle) {
        modalTitle.textContent = _importMode === "image"
            ? "Image Analysis — Bend Planner"
            : "DXF Drawing — Bend Planner";
    }

    // Render SVG or Image
    const svgContainer = document.getElementById("dxfSvgContainer");
    if (_importMode === "image" && a.image_data_url) {
        svgContainer.innerHTML = `<img src="${a.image_data_url}" style="max-width:100%;height:auto;">`;
    } else {
        svgContainer.innerHTML = a.svg || "<p>No preview available</p>";
    }

    // Hint text
    const hintEl = modal.querySelector(".dxf-hint");
    if (hintEl) {
        hintEl.textContent = _importMode === "image"
            ? "Review extracted bend data. Adjust angles, directions, and tooling as needed."
            : "Hover a bend row to highlight it. Click edges in the table to set BG X reference per bend.";
    }

    // Info panel
    let info = `<strong>${a.program_name || "Drawing"}</strong><br>`;
    if (_importMode === "dxf") {
        info += `Part: ${a.part_length}" &times; ${a.part_width}"<br>`;
    }
    info += `Bends: ${a.bend_count}<br>`;
    if (a.gauge) info += `Gauge: ${a.gauge} (${a.thickness_inch}")`;
    if (a.material_match) info += `<br>Material: ${a.material_match}`;
    if (a.dimensions && a.dimensions.length) {
        info += `<br>Dimensions found: <strong>${a.dimensions.join('", "')}"</strong>`;
    }
    if (a.ai_notes) info += `<br><span style="color:var(--text-dim)">Notes: ${a.ai_notes}</span>`;
    if (a.warnings && a.warnings.length) {
        info += `<br><span style="color:var(--warning)">${a.warnings.join("; ")}</span>`;
    }
    document.getElementById("dxfInfo").innerHTML = info;

    // Thickness override
    const thickInput = document.getElementById("dxfThicknessOverride");
    thickInput.value = a.thickness_inch || "";
    thickInput.placeholder = a.thickness_inch ? `${a.thickness_inch}" (from ${a.gauge} ga)` : "Enter thickness";

    // Populate global tooling dropdowns
    const dieEl = document.getElementById("dxfDie");
    const punchEl = document.getElementById("dxfPunch");
    const matEl = document.getElementById("dxfMaterial");
    const gaugeEl = document.getElementById("dxfGauge");
    _populateDxfSelect(dieEl, tooling.dies, "id", "name", null);
    _populateDxfSelect(punchEl, tooling.punches, "id", "name", null);
    _populateDxfSelect(matEl, tooling.materials, "id", "name", a.matched_material_id || null);

    // Populate gauge dropdown from selected material
    _populateDxfGaugeDropdown(matEl.value, a.gauge);

    // When material changes, update gauge dropdown options
    matEl.addEventListener("change", () => {
        _populateDxfGaugeDropdown(matEl.value, null);
        // Clear thickness if it was set from a previous gauge selection
        thickInput.value = "";
        thickInput.placeholder = "Enter thickness";
    });

    // When gauge changes, auto-fill thickness
    gaugeEl.addEventListener("change", () => {
        const selectedMat = tooling.materials.find(m => m.id === matEl.value);
        if (selectedMat && selectedMat.gaugeThickness && gaugeEl.value) {
            const thickness = selectedMat.gaugeThickness[gaugeEl.value];
            if (thickness) {
                thickInput.value = thickness;
            }
        }
    });

    // When global defaults change, fill all bend rows that haven't been individually overridden
    dieEl.addEventListener("change", () => {
        const val = dieEl.value || null;
        _dxfBendPlan.forEach(p => { p.dieId = val; });
        renderDxfBendPlanner();
    });
    punchEl.addEventListener("change", () => {
        const val = punchEl.value || null;
        _dxfBendPlan.forEach(p => { p.punchId = val; });
        renderDxfBendPlanner();
    });

    renderDxfBendPlanner();
}

function _defaultEdgeForBend(b) {
    // For a vertical bend line, parallel edges are left/right — pick closest
    // For a horizontal bend line, parallel edges are top/bottom — pick closest
    const isVertical = Math.abs(b.x_end - b.x_start) < 0.01;
    const isHorizontal = Math.abs(b.y_end - b.y_start) < 0.01;

    if (isHorizontal) {
        // Horizontal line: compare distance to top vs bottom
        return b.bg_x_from_top <= b.bg_x_from_bottom ? "top" : "bottom";
    }
    // Vertical or angled: compare distance to left vs right
    return b.bg_x_from_left <= b.bg_x_from_right ? "left" : "right";
}

function _edgeOptions(selected) {
    let html = `<option value="left"${selected === "left" ? " selected" : ""}>L</option>`;
    html += `<option value="right"${selected === "right" ? " selected" : ""}>R</option>`;
    if (_dxfHasHorizontalBends) {
        html += `<option value="top"${selected === "top" ? " selected" : ""}>T</option>`;
        html += `<option value="bottom"${selected === "bottom" ? " selected" : ""}>B</option>`;
    }
    return html;
}

function _populateDxfGaugeDropdown(materialId, preselectedGauge) {
    const gaugeEl = document.getElementById("dxfGauge");
    gaugeEl.innerHTML = '<option value="">—</option>';
    const mat = tooling.materials.find(m => m.id === materialId);
    if (!mat || !mat.gaugeThickness) return;
    const gauges = Object.keys(mat.gaugeThickness).map(Number).sort((a, b) => a - b);
    gauges.forEach(ga => {
        const opt = document.createElement("option");
        opt.value = String(ga);
        opt.textContent = `${ga} ga (${mat.gaugeThickness[String(ga)]}")`;
        if (preselectedGauge && ga === preselectedGauge) opt.selected = true;
        gaugeEl.appendChild(opt);
    });
    // If DXF had gauge info, auto-fill thickness
    if (preselectedGauge && mat.gaugeThickness[String(preselectedGauge)]) {
        document.getElementById("dxfThicknessOverride").value = mat.gaugeThickness[String(preselectedGauge)];
    }
}

function _miniSelect(items, valueKey, labelKey, selectedVal, cls, orderIdx) {
    let html = `<select class="${cls}" data-order="${orderIdx}"><option value="">—</option>`;
    items.forEach(item => {
        html += `<option value="${item[valueKey]}"${selectedVal === item[valueKey] ? " selected" : ""}>${escHtml(item[labelKey])}</option>`;
    });
    html += "</select>";
    return html;
}

// Update SVG lines for a plan entry (handles merged bends)
function _updateSvgBend(bendIdx) {
    // Find which plan entry owns this bend index
    const plan = _dxfBendPlan.find(p => {
        if (p.mergedIndices) return p.mergedIndices.includes(bendIdx);
        return p.index === bendIdx;
    });
    if (!plan) return;

    const dir = plan.direction || "?";
    const angle = plan.angle;
    const orderIdx = _dxfBendPlan.indexOf(plan);

    const UP_COLOR = "#2980b9";
    const DOWN_COLOR = "#e74c3c";
    const color = dir === "DOWN" ? DOWN_COLOR : UP_COLOR;

    // Update all SVG lines belonging to this plan entry
    const indices = plan.mergedIndices || [plan.index];
    indices.forEach((idx, subIdx) => {
        const g = document.querySelector(`#dxfSvgContainer .bend-line-svg[data-bend-idx="${idx}"]`);
        if (!g) return;

        const label = g.querySelector(".bend-label");
        if (label) {
            if (indices.length > 1) {
                // Merged: show order number on first segment, "+" on others
                label.textContent = subIdx === 0
                    ? `${orderIdx + 1}. ${dir} ${angle}\u00b0 [merged]`
                    : `\u2191 ${orderIdx + 1}`;
            } else {
                label.textContent = `${orderIdx + 1}. ${dir} ${angle}\u00b0`;
            }
            label.setAttribute("fill", color);
        }

        const line = g.querySelector("line");
        if (line) {
            line.setAttribute("stroke", color);
            if (dir === "DOWN") {
                line.setAttribute("stroke-dasharray", "8,4");
            } else {
                line.removeAttribute("stroke-dasharray");
            }
        }
    });
}

// Update all SVG bend labels to reflect current order numbers
function _updateAllSvgBends() {
    // Collect all bend indices from all plan entries
    _dxfBendPlan.forEach(plan => {
        const indices = plan.mergedIndices || [plan.index];
        indices.forEach(idx => _updateSvgBend(idx));
    });
}

function renderDxfBendPlanner() {
    const a = _dxfAnalysis;
    const container = document.getElementById("dxfBendPlanner");
    const isImage = _importMode === "image";

    // Merge toolbar (DXF only)
    let html = "";
    if (!isImage) {
        html += `<div class="merge-toolbar">
            <button class="btn btn-tiny btn-secondary" id="mergeSelectedBtn" title="Merge selected bends into one (sums widths)">Merge Selected</button>
            <span class="merge-hint" id="mergeHint"></span>
        </div>`;
    }

    html += `<table class="planner-table">
        <thead><tr>`;
    if (!isImage) html += `<th class="chk-col"><input type="checkbox" id="plannerSelectAll" title="Select all"></th>`;
    html += `<th></th><th>#</th><th>Dir</th><th>Angle</th><th>Width</th><th>Edge</th><th>BG X</th>`;
    html += `<th>Die</th><th>Punch</th><th>BG</th><th></th>`;
    html += `</tr></thead>
        <tbody>`;

    _dxfBendPlan.forEach((plan, orderIdx) => {
        const b = a.bends[plan.index];
        const dirCls = plan.direction === "UP" ? "dir-sel-up" : "dir-sel-down";
        const isMerged = !isImage && plan.mergedIndices && plan.mergedIndices.length > 1;
        const checked = _dxfSelectedRows.has(orderIdx) ? "checked" : "";
        const mergedClass = isMerged ? " merged-row" : "";

        html += `<tr class="planner-row${mergedClass}" data-order="${orderIdx}" data-bend-idx="${plan.index}" draggable="true">`;
        if (!isImage) html += `<td class="chk-col"><input type="checkbox" class="bend-chk" data-order="${orderIdx}" ${checked}></td>`;
        html += `<td class="drag-handle">&#9776;</td>
            <td>${orderIdx + 1}</td>
            <td>
                <select class="dir-sel ${dirCls}" data-order="${orderIdx}">
                    <option value="UP"${plan.direction === "UP" ? " selected" : ""}>UP</option>
                    <option value="DOWN"${plan.direction === "DOWN" ? " selected" : ""}>DOWN</option>
                </select>
            </td>
            <td><input type="number" class="angle-input" data-order="${orderIdx}" value="${plan.angle}" min="15" max="170" step="0.1">&deg;</td>`;

        if (isImage) {
            // Image mode: editable width and BG X inputs
            const width = plan.bendWidth || "";
            const bgX = plan.bgX || "";
            html += `<td><input type="number" class="width-input" data-order="${orderIdx}" value="${width}" min="0.1" max="33.3" step="0.1" placeholder="—" style="width:55px"></td>`;
            html += `<td><select class="edge-sel edge-${plan.edge || 'left'}" data-order="${orderIdx}">${_edgeOptions(plan.edge || "left")}</select></td>`;
            html += `<td><input type="number" class="bgx-input" data-order="${orderIdx}" value="${bgX}" min="0" step="0.001" placeholder="—" style="width:60px"></td>`;
        } else {
            // DXF mode: computed from geometry
            const bgXMap = { left: b.bg_x_from_left, right: b.bg_x_from_right, top: b.bg_x_from_top, bottom: b.bg_x_from_bottom };
            const bgX = bgXMap[plan.edge] || b.bg_x_from_left;
            const bendWidth = roundSmart(_getBendWidth(plan), 4);
            html += `<td class="width-val">${bendWidth}"${isMerged ? ` <span class="merged-badge" title="${plan.mergedIndices.length} segments merged">${plan.mergedIndices.length}seg</span>` : ""}</td>`;
            html += `<td><select class="edge-sel edge-${plan.edge}" data-order="${orderIdx}">${_edgeOptions(plan.edge)}</select></td>`;
            html += `<td class="bgx-val">${bgX}"</td>`;
        }

        html += `<td>${_miniSelect(tooling.dies, "id", "name", plan.dieId, "die-sel", orderIdx)}</td>
            <td>${_miniSelect(tooling.punches, "id", "name", plan.punchId, "punch-sel", orderIdx)}</td>
            <td>
                <select class="bg-finger-sel" data-order="${orderIdx}">
                    <option value="G54"${plan.bgFinger === "G54" ? " selected" : ""}>G54</option>
                    <option value="G55"${plan.bgFinger === "G55" ? " selected" : ""}>G55</option>
                    <option value="G56"${plan.bgFinger === "G56" ? " selected" : ""}>G56</option>
                    <option value="G57"${plan.bgFinger === "G57" ? " selected" : ""}>G57</option>
                    <option value="G58"${plan.bgFinger === "G58" ? " selected" : ""}>G58</option>
                    <option value="G59"${plan.bgFinger === "G59" ? " selected" : ""}>G59</option>
                </select>
            </td>`;
        if (isImage) {
            html += `<td><button class="btn btn-tiny btn-danger img-remove-bend" data-order="${orderIdx}" title="Remove bend">&#x2715;</button></td>`;
        } else {
            html += `<td>${isMerged ? `<button class="btn btn-tiny btn-secondary split-btn" data-order="${orderIdx}" title="Split back into individual segments">Split</button>` : ""}</td>`;
        }
        html += `</tr>`;
    });

    html += "</tbody></table>";
    if (isImage) {
        html += `<button class="btn btn-small btn-primary" id="imgAddBendBtn" style="margin-top:6px">+ Add Bend</button>`;
    }
    container.innerHTML = html;

    // Wire DXF-only features (merge, checkboxes, split, edge selectors, SVG highlighting)
    if (!isImage) {
        // Wire merge button
        const mergeBtn = document.getElementById("mergeSelectedBtn");
        if (mergeBtn) mergeBtn.addEventListener("click", _mergeSelectedBends);

        // Wire select-all checkbox
        const selectAll = document.getElementById("plannerSelectAll");
        if (selectAll) {
            selectAll.addEventListener("change", (e) => {
                const checked = e.target.checked;
                _dxfSelectedRows.clear();
                if (checked) {
                    _dxfBendPlan.forEach((_, i) => _dxfSelectedRows.add(i));
                }
                container.querySelectorAll(".bend-chk").forEach(cb => { cb.checked = checked; });
                _updateMergeHint();
            });
        }

        // Wire individual checkboxes
        container.querySelectorAll(".bend-chk").forEach(cb => {
            cb.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.order);
                if (e.target.checked) {
                    _dxfSelectedRows.add(idx);
                } else {
                    _dxfSelectedRows.delete(idx);
                }
                _updateMergeHint();
            });
        });

        // Wire split buttons
        container.querySelectorAll(".split-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                _splitBend(parseInt(e.target.dataset.order));
            });
        });

        _updateMergeHint();

        // Wire edge selectors
        container.querySelectorAll(".edge-sel").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.order);
                const newEdge = e.target.value;
                _dxfBendPlan[idx].edge = newEdge;
                const b = a.bends[_dxfBendPlan[idx].index];
                const bgXMap = { left: b.bg_x_from_left, right: b.bg_x_from_right, top: b.bg_x_from_top, bottom: b.bg_x_from_bottom };
                const bgX = bgXMap[newEdge] || b.bg_x_from_left;
                e.target.closest("tr").querySelector(".bgx-val").textContent = bgX + '"';
                e.target.className = e.target.className.replace(/edge-\w+/g, "").trim();
                e.target.classList.add("edge-sel", `edge-${newEdge}`);
            });
        });
    }

    // Wire image-mode Add/Remove buttons
    if (isImage) {
        const addBtn = document.getElementById("imgAddBendBtn");
        if (addBtn) {
            addBtn.addEventListener("click", () => {
                const newIdx = _dxfAnalysis.bends.length;
                _dxfAnalysis.bends.push({
                    index: newIdx, direction: "UP", angle: 90, label: `Bend ${newIdx + 1}`, bend_width: null,
                });
                _dxfAnalysis.bend_defs.push({
                    id: crypto.randomUUID(),
                    name: `Bend ${newIdx + 1}`,
                    notes: "Direction: UP; From image (manual)",
                    desiredBendAngle: 90, angleCompensation: 0, angleCompensationReversed: false,
                    materialThickness: _dxfAnalysis.thickness_inch || 0.06,
                    punchToMaterialClearance: 0.1, additionalRetractAfterBend: 0,
                    bendWidth: 12, backGaugeRefEdgeStop: "G54", backGaugeRefEdgeStopEnabled: false,
                    backGaugeXPosition: 0, backGaugeRPosition: 0, backGaugeJogSpeed: "",
                    overrideFinalBendPositionEnabled: false, overriddenFinalBendPosition: 0,
                    punchId: null, dieId: null, materialId: _dxfAnalysis.matched_material_id || null,
                });
                _dxfBendPlan.push({
                    index: newIdx, edge: "left", angle: 90, direction: "UP",
                    bendWidth: 0, bgX: 0,
                    dieId: null, punchId: null, bgFinger: "G54",
                });
                _dxfAnalysis.bend_count = _dxfAnalysis.bends.length;
                renderDxfBendPlanner();
            });
        }
        container.querySelectorAll(".img-remove-bend").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const orderIdx = parseInt(e.target.dataset.order);
                _dxfBendPlan.splice(orderIdx, 1);
                _dxfAnalysis.bend_count = _dxfBendPlan.length;
                renderDxfBendPlanner();
            });
        });
        // Wire image-mode width inputs
        container.querySelectorAll(".width-input").forEach(inp => {
            inp.addEventListener("input", (e) => {
                const orderIdx = parseInt(e.target.dataset.order);
                _dxfBendPlan[orderIdx].bendWidth = parseFloat(e.target.value) || 0;
            });
        });
        // Wire image-mode BG X inputs
        container.querySelectorAll(".bgx-input").forEach(inp => {
            inp.addEventListener("input", (e) => {
                const orderIdx = parseInt(e.target.dataset.order);
                _dxfBendPlan[orderIdx].bgX = parseFloat(e.target.value) || 0;
            });
        });
        // Wire image-mode edge selectors
        container.querySelectorAll(".edge-sel").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.order);
                _dxfBendPlan[idx].edge = e.target.value;
                e.target.className = e.target.className.replace(/edge-\w+/g, "").trim();
                e.target.classList.add("edge-sel", `edge-${e.target.value}`);
            });
        });
    }

    // Wire direction selectors
    container.querySelectorAll(".dir-sel").forEach(sel => {
        sel.addEventListener("change", (e) => {
            const orderIdx = parseInt(e.target.dataset.order);
            _dxfBendPlan[orderIdx].direction = e.target.value;
            e.target.classList.toggle("dir-sel-up", e.target.value === "UP");
            e.target.classList.toggle("dir-sel-down", e.target.value === "DOWN");
            if (!isImage) _updateSvgBend(_dxfBendPlan[orderIdx].index);
        });
    });

    // Wire angle inputs
    container.querySelectorAll(".angle-input").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const orderIdx = parseInt(e.target.dataset.order);
            _dxfBendPlan[orderIdx].angle = parseFloat(e.target.value) || 90;
            if (!isImage) _updateSvgBend(_dxfBendPlan[orderIdx].index);
        });
    });

    // Wire per-bend die/punch/BG finger selectors
    container.querySelectorAll(".die-sel").forEach(sel => {
        sel.addEventListener("change", (e) => {
            _dxfBendPlan[parseInt(e.target.dataset.order)].dieId = e.target.value || null;
        });
    });
    container.querySelectorAll(".punch-sel").forEach(sel => {
        sel.addEventListener("change", (e) => {
            _dxfBendPlan[parseInt(e.target.dataset.order)].punchId = e.target.value || null;
        });
    });
    container.querySelectorAll(".bg-finger-sel").forEach(sel => {
        sel.addEventListener("change", (e) => {
            _dxfBendPlan[parseInt(e.target.dataset.order)].bgFinger = e.target.value;
        });
    });

    // Wire drag-and-drop reordering
    const rows = container.querySelectorAll(".planner-row");
    let dragIdx = null;

    rows.forEach(row => {
        row.addEventListener("dragstart", (e) => {
            dragIdx = parseInt(row.dataset.order);
            row.classList.add("dragging-row");
            e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging-row");
            dragIdx = null;
        });
        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            row.classList.add("drag-over-row");
        });
        row.addEventListener("dragleave", () => {
            row.classList.remove("drag-over-row");
        });
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.classList.remove("drag-over-row");
            const dropIdx = parseInt(row.dataset.order);
            if (dragIdx === null || dragIdx === dropIdx) return;
            const [moved] = _dxfBendPlan.splice(dragIdx, 1);
            _dxfBendPlan.splice(dropIdx, 0, moved);
            renderDxfBendPlanner();
            if (!isImage) _updateAllSvgBends();
        });

        // SVG hover highlighting (DXF only)
        if (!isImage) {
            row.addEventListener("mouseenter", () => {
                const orderIdx = parseInt(row.dataset.order);
                const plan = _dxfBendPlan[orderIdx];
                const indices = plan && plan.mergedIndices ? plan.mergedIndices : [parseInt(row.dataset.bendIdx)];
                const idxSet = new Set(indices.map(String));
                document.querySelectorAll("#dxfSvgContainer .bend-line-svg").forEach(g => {
                    g.classList.toggle("dim", !idxSet.has(g.dataset.bendIdx));
                });
            });
            row.addEventListener("mouseleave", () => {
                document.querySelectorAll("#dxfSvgContainer .bend-line-svg").forEach(g => {
                    g.classList.remove("dim");
                });
            });
        }
    });
}

function _updateMergeHint() {
    const hint = document.getElementById("mergeHint");
    if (!hint) return;
    const n = _dxfSelectedRows.size;
    if (n < 2) {
        hint.textContent = n === 1 ? "Select 1 more to merge" : "";
    } else {
        hint.textContent = `${n} bends selected`;
    }
}

async function applyDxfImport() {
    const thickVal = document.getElementById("dxfThicknessOverride").value;
    const thickness = thickVal ? parseFloat(thickVal) : null;

    // Gather global defaults
    const globalDieId = document.getElementById("dxfDie").value || null;
    const globalPunchId = document.getElementById("dxfPunch").value || null;
    const globalMaterialId = document.getElementById("dxfMaterial").value || null;

    let analysis;

    if (_importMode === "image") {
        // Image mode: build bend defs directly from the plan + original analysis
        const bendDefs = _dxfBendPlan.map((plan, i) => {
            const orig = _dxfAnalysis.bend_defs[plan.index] || {};
            return {
                ...orig,
                id: orig.id || crypto.randomUUID(),
                name: orig.name || `Bend ${i + 1}`,
                desiredBendAngle: plan.angle,
                angleCompensationReversed: plan.direction === "DOWN",
                notes: `Direction: ${plan.direction}; Edge: ${plan.edge || "—"}; From image`,
                materialThickness: thickness || orig.materialThickness || 0.06,
                bendWidth: plan.bendWidth || orig.bendWidth || 12.0,
                backGaugeXPosition: plan.bgX || 0,
                backGaugeRefEdgeStop: plan.bgFinger || "G54",
                backGaugeRefEdgeStopEnabled: !!(plan.bgX),
                dieId: plan.dieId || globalDieId,
                punchId: plan.punchId || globalPunchId,
                materialId: globalMaterialId || orig.materialId,
            };
        });
        analysis = {
            program_name: _dxfAnalysis.program_name,
            bend_count: bendDefs.length,
            bend_defs: bendDefs,
        };
    } else {
        // DXF mode: send plan to backend for re-analysis with geometry
        const planWithTooling = _dxfBendPlan.map(p => ({
            ...p,
            dieId: p.dieId || globalDieId,
            punchId: p.punchId || globalPunchId,
            materialId: globalMaterialId,
            bendWidth: roundSmart(_getBendWidth(p), 4),
        }));

        const resp = await fetch("/api/reanalyze-dxf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bend_plan: planWithTooling, thickness }),
        });
        const data = await resp.json();

        if (!data.ok) {
            showStatus("Re-analysis failed: " + (data.errors || [data.error]).join(", "), "error");
            return;
        }

        analysis = data.analysis;

        // Store DXF source for later viewing
        const dxfSourceId = crypto.randomUUID();
        const savedAnalysis = _dxfAnalysis;
        _dxfSources[dxfSourceId] = {
            svg: savedAnalysis.svg,
            bends: savedAnalysis.bends,
            programName: analysis.program_name,
            plan: JSON.parse(JSON.stringify(planWithTooling)),
        };

        analysis.bend_defs.forEach((bend, i) => {
            bend._dxfSourceId = dxfSourceId;
            bend._dxfPlanIndex = i;
        });
    }

    // Close modal
    closeDxfPreview();

    // If a program is already open, append bends to it; otherwise create new
    if (currentProgramId && !document.getElementById("programEditor").classList.contains("hidden")) {
        analysis.bend_defs.forEach((bend, i) => {
            const existingCount = document.querySelectorAll("#bendList .bend-card").length;
            addBendCard(null, bend, existingCount + i);
        });
        renumberBends();
        syncViewFromForm();
    } else {
        currentProgramId = crypto.randomUUID();
        document.getElementById("noSelection").classList.add("hidden");
        document.getElementById("programEditor").classList.remove("hidden");
        document.getElementById("programName").value = analysis.program_name || "Program";

        const bendList = document.getElementById("bendList");
        bendList.innerHTML = "";
        document.getElementById("bendTable").innerHTML = "";

        analysis.bend_defs.forEach((bend, i) => {
            addBendCard(null, bend, i);
        });
        syncViewFromForm();
    }

    // Auto-save the program immediately
    await saveProgram();
}

function closeDxfPreview() {
    document.getElementById("dxfPreviewModal").classList.add("hidden");
    _dxfAnalysis = null;
    _dxfBendPlan = [];
    _importMode = "dxf";
}

function openDxfViewer(dxfSourceId, highlightPlanIndex) {
    /**
     * Open the DXF preview modal in read-only view mode.
     * Shows the SVG with one bend highlighted and the rest dimmed.
     */
    const source = _dxfSources[dxfSourceId];
    if (!source) {
        showStatus("DXF drawing data not available (was it imported this session?)", "error");
        return;
    }

    const modal = document.getElementById("dxfPreviewModal");
    modal.classList.remove("hidden");

    // Render SVG
    document.getElementById("dxfSvgContainer").innerHTML = source.svg || "<p>No preview</p>";

    // Info panel
    document.getElementById("dxfInfo").innerHTML = `<strong>${escHtml(source.programName || "Drawing")}</strong><br>Bends: ${source.bends.length}`;

    // Hide the planner controls — show a simple bend list instead
    const controlsEl = document.querySelector(".dxf-controls");
    const plannerEl = document.getElementById("dxfBendPlanner");
    const actionsEl = document.querySelector(".dxf-actions");

    // Hide defaults and actions for view-only mode
    document.querySelectorAll(".dxf-default-row, .dxf-controls h4, .dxf-controls .dxf-hint").forEach(el => {
        el.dataset.wasHidden = el.classList.contains("hidden") ? "1" : "";
        el.classList.add("hidden");
    });
    actionsEl.innerHTML = `<button class="btn btn-secondary" id="dxfViewCloseBtn" style="flex:1">Close</button>`;
    document.getElementById("dxfViewCloseBtn").addEventListener("click", closeDxfViewer);

    // Build a simple read-only bend list in the planner area
    let html = `<table class="planner-table"><thead><tr>
        <th>#</th><th>Dir</th><th>Angle</th><th>Width</th>
    </tr></thead><tbody>`;

    const plan = source.plan || [];
    plan.forEach((p, orderIdx) => {
        const b = source.bends[p.index];
        if (!b) return;
        const isMerged = p.mergedIndices && p.mergedIndices.length > 1;
        const width = isMerged
            ? roundSmart(p.mergedIndices.reduce((s, idx) => s + (source.bends[idx]?.bend_width || 0), 0), 4)
            : b.bend_width;
        const active = orderIdx === highlightPlanIndex ? " bend-row-highlight" : "";

        html += `<tr class="planner-row${active}" data-order="${orderIdx}" data-bend-idx="${p.index}">
            <td>${orderIdx + 1}</td>
            <td><span class="${p.direction === 'DOWN' ? 'dir-down' : 'dir-up'}">${p.direction || '?'}</span></td>
            <td>${p.angle || b.angle}&deg;</td>
            <td>${width}"${isMerged ? ` <span class="merged-badge">${p.mergedIndices.length}seg</span>` : ""}</td>
        </tr>`;
    });
    html += "</tbody></table>";
    plannerEl.innerHTML = html;

    // Highlight the relevant bend lines in SVG, dim others
    const highlightPlan = plan[highlightPlanIndex];
    if (highlightPlan) {
        const highlightIndices = new Set(
            (highlightPlan.mergedIndices || [highlightPlan.index]).map(String)
        );
        document.querySelectorAll("#dxfSvgContainer .bend-line-svg").forEach(g => {
            g.classList.toggle("dim", !highlightIndices.has(g.dataset.bendIdx));
        });
    }

    // Wire hover on rows for highlighting
    plannerEl.querySelectorAll(".planner-row").forEach(row => {
        row.addEventListener("mouseenter", () => {
            const oi = parseInt(row.dataset.order);
            const p = plan[oi];
            if (!p) return;
            const indices = new Set((p.mergedIndices || [p.index]).map(String));
            document.querySelectorAll("#dxfSvgContainer .bend-line-svg").forEach(g => {
                g.classList.toggle("dim", !indices.has(g.dataset.bendIdx));
            });
        });
        row.addEventListener("mouseleave", () => {
            // Return to highlighting only the original bend
            if (highlightPlan) {
                const hi = new Set((highlightPlan.mergedIndices || [highlightPlan.index]).map(String));
                document.querySelectorAll("#dxfSvgContainer .bend-line-svg").forEach(g => {
                    g.classList.toggle("dim", !hi.has(g.dataset.bendIdx));
                });
            } else {
                document.querySelectorAll("#dxfSvgContainer .bend-line-svg").forEach(g => {
                    g.classList.remove("dim");
                });
            }
        });
    });

    // Mark modal as in view mode for cleanup
    modal.dataset.viewMode = "1";

    // Override the close button behavior
    document.getElementById("closeDxfPreview").onclick = closeDxfViewer;
}

function closeDxfViewer() {
    const modal = document.getElementById("dxfPreviewModal");
    modal.classList.add("hidden");

    // Restore hidden elements
    document.querySelectorAll(".dxf-default-row, .dxf-controls h4, .dxf-controls .dxf-hint").forEach(el => {
        if (el.dataset.wasHidden !== "1") el.classList.remove("hidden");
        delete el.dataset.wasHidden;
    });

    // Restore action buttons
    const actionsEl = document.querySelector(".dxf-actions");
    actionsEl.innerHTML = `
        <button class="btn btn-primary" id="dxfApplyBtn">Create Program</button>
        <button class="btn btn-secondary" id="dxfCancelBtn">Cancel</button>
    `;
    document.getElementById("dxfApplyBtn").addEventListener("click", applyDxfImport);
    document.getElementById("dxfCancelBtn").addEventListener("click", closeDxfPreview);

    // Restore close button
    document.getElementById("closeDxfPreview").onclick = closeDxfPreview;
    modal.dataset.viewMode = "";
}

async function exportZip() {
    // Sync table to form if needed before export
    if (currentView === "table") {
        syncFormFromTable();
    }
    const resp = await fetch("/api/export", { method: "POST" });
    if (!resp.ok) {
        showStatus("Export failed", "error");
        return;
    }
    const blob = await resp.blob();

    // Extract filename from Content-Disposition header (server generates BendControl-compatible name)
    const cd = resp.headers.get("Content-Disposition") || "";
    const fnMatch = cd.match(/filename=([^\s;]+)/);
    const filename = fnMatch ? fnMatch[1] : _makeBendControlFilename();

    // Use native Save As dialog if available, otherwise fallback to download
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: "ZIP Archive", accept: { "application/zip": [".zip"] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            showStatus("ZIP saved! Copy to USB and use 'Restore From' in BendControl.", "success");
        } catch (e) {
            if (e.name !== "AbortError") showStatus("Save failed: " + e.message, "error");
        }
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showStatus("ZIP downloaded! Copy to USB and use 'Restore From' in BendControl.", "success");
    }
}

async function resetAll() {
    if (!confirm("Reset all programs and bends? This cannot be undone.")) return;
    await fetch("/api/reset", { method: "POST" });
    currentProgramId = null;
    document.getElementById("programEditor").classList.add("hidden");
    document.getElementById("noSelection").classList.remove("hidden");
    document.getElementById("bendTable").innerHTML = "";
    await loadTooling();
    await loadPrograms();
    showStatus("All data reset to defaults", "info");
}

// --- Helpers ---
function showStatus(msg, type) {
    const bar = document.getElementById("importStatus");
    bar.textContent = msg;
    bar.className = "status-bar " + type;
    bar.classList.remove("hidden");
    setTimeout(() => bar.classList.add("hidden"), 6000);
}

function _makeBendControlFilename() {
    // BendControl expects: B<yyMMddHHmm><name>.zip
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    return `B${yy}${mm}${dd}${hh}${mi}bendgen.zip`;
}

function escHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// --- Tooling Management Modal ---

function wireToolingModal() {
    document.getElementById("manageToolingBtn").addEventListener("click", openToolingModal);
    document.getElementById("closeToolingModal").addEventListener("click", closeToolingModal);
    document.getElementById("toolingModal").addEventListener("click", (e) => {
        if (e.target.id === "toolingModal") closeToolingModal();
    });

    // Tab switching
    document.querySelectorAll(".modal-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
        });
    });

    // Die CRUD
    document.getElementById("saveDieBtn").addEventListener("click", saveDie);
    document.getElementById("cancelDieEditBtn").addEventListener("click", cancelDieEdit);

    // Punch CRUD
    document.getElementById("savePunchBtn").addEventListener("click", savePunch);
    document.getElementById("cancelPunchEditBtn").addEventListener("click", cancelPunchEdit);

    // Material CRUD
    document.getElementById("saveMaterialBtn").addEventListener("click", saveMaterial);
    document.getElementById("cancelMaterialEditBtn").addEventListener("click", cancelMaterialEdit);
}

function openToolingModal() {
    document.getElementById("toolingModal").classList.remove("hidden");
    renderToolingLists();
    renderGaugeGrid({});
}

function closeToolingModal() {
    document.getElementById("toolingModal").classList.add("hidden");
    cancelDieEdit();
    cancelPunchEdit();
    cancelMaterialEdit();
    // Refresh dropdowns in any open bend cards
    refreshAllToolingDropdowns();
}

function renderToolingLists() {
    renderDieList();
    renderPunchList();
    renderMaterialList();
}

// --- Die management ---

function renderDieList() {
    const list = document.getElementById("dieList");
    list.innerHTML = "";
    tooling.dies.forEach(die => {
        const row = document.createElement("div");
        row.className = "tooling-item" + (die.stock ? " stock" : "");
        row.innerHTML = `
            <div class="tooling-item-info">
                <span class="tooling-item-name">${escHtml(die.name)}</span>
                <span class="tooling-item-detail">H: ${die.heightInch}" | Opening: ${die.vdieOpeningInch}"</span>
            </div>
            <div class="tooling-item-actions">
                ${die.stock ? '<span class="stock-badge">Stock</span>' : `
                    <button class="btn btn-tiny btn-secondary tooling-edit-btn" data-id="${die.id}">Edit</button>
                    <button class="btn btn-tiny btn-danger tooling-delete-btn" data-id="${die.id}">Delete</button>
                `}
            </div>
        `;
        if (!die.stock) {
            row.querySelector(".tooling-edit-btn").addEventListener("click", () => editDie(die));
            row.querySelector(".tooling-delete-btn").addEventListener("click", () => deleteDie(die.id));
        }
        list.appendChild(row);
    });
}

async function saveDie() {
    const editId = document.getElementById("dieEditId").value || null;
    const name = document.getElementById("dieName").value.trim();
    const heightInch = parseFloat(document.getElementById("dieHeight").value);
    const vdieOpeningInch = parseFloat(document.getElementById("dieOpening").value);

    if (!name) { showStatus("Die name is required", "error"); return; }
    if (isNaN(heightInch) || isNaN(vdieOpeningInch)) { showStatus("Die height and opening are required", "error"); return; }

    const body = { name, heightInch, vdieOpeningInch };
    if (editId) body.id = editId;

    const resp = await fetch("/api/die", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.ok) {
        showStatus(editId ? "Die updated" : "Die added", "success");
        cancelDieEdit();
        await loadTooling();
        renderDieList();
    } else {
        showStatus(data.error, "error");
    }
}

function editDie(die) {
    document.getElementById("dieEditId").value = die.id;
    document.getElementById("dieName").value = die.name;
    document.getElementById("dieHeight").value = die.heightInch;
    document.getElementById("dieOpening").value = die.vdieOpeningInch;
    document.getElementById("dieFormTitle").textContent = "Edit Die";
    document.getElementById("saveDieBtn").textContent = "Save Changes";
    document.getElementById("cancelDieEditBtn").textContent = "Cancel / Add New";
    document.getElementById("cancelDieEditBtn").classList.remove("hidden");
}

function cancelDieEdit() {
    document.getElementById("dieEditId").value = "";
    document.getElementById("dieName").value = "";
    document.getElementById("dieHeight").value = "";
    document.getElementById("dieOpening").value = "";
    document.getElementById("dieFormTitle").textContent = "Add New Die";
    document.getElementById("saveDieBtn").textContent = "Add Die";
    document.getElementById("cancelDieEditBtn").classList.add("hidden");
}

async function deleteDie(dieId) {
    if (!confirm("Delete this die?")) return;
    const resp = await fetch(`/api/die/${dieId}`, { method: "DELETE" });
    const data = await resp.json();
    if (data.ok) {
        showStatus("Die deleted", "info");
        await loadTooling();
        renderDieList();
    } else {
        showStatus(data.error, "error");
    }
}

// --- Punch management ---

function renderPunchList() {
    const list = document.getElementById("punchList");
    list.innerHTML = "";
    tooling.punches.forEach(punch => {
        const row = document.createElement("div");
        row.className = "tooling-item" + (punch.stock ? " stock" : "");
        row.innerHTML = `
            <div class="tooling-item-info">
                <span class="tooling-item-name">${escHtml(punch.name)}</span>
                <span class="tooling-item-detail">H: ${punch.heightInch}"</span>
            </div>
            <div class="tooling-item-actions">
                ${punch.stock ? '<span class="stock-badge">Stock</span>' : `
                    <button class="btn btn-tiny btn-secondary tooling-edit-btn" data-id="${punch.id}">Edit</button>
                    <button class="btn btn-tiny btn-danger tooling-delete-btn" data-id="${punch.id}">Delete</button>
                `}
            </div>
        `;
        if (!punch.stock) {
            row.querySelector(".tooling-edit-btn").addEventListener("click", () => editPunch(punch));
            row.querySelector(".tooling-delete-btn").addEventListener("click", () => deletePunch(punch.id));
        }
        list.appendChild(row);
    });
}

async function savePunch() {
    const editId = document.getElementById("punchEditId").value || null;
    const name = document.getElementById("punchName").value.trim();
    const heightInch = parseFloat(document.getElementById("punchHeight").value);

    if (!name) { showStatus("Punch name is required", "error"); return; }
    if (isNaN(heightInch)) { showStatus("Punch height is required", "error"); return; }

    const body = { name, heightInch };
    if (editId) body.id = editId;

    const resp = await fetch("/api/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.ok) {
        showStatus(editId ? "Punch updated" : "Punch added", "success");
        cancelPunchEdit();
        await loadTooling();
        renderPunchList();
    } else {
        showStatus(data.error, "error");
    }
}

function editPunch(punch) {
    document.getElementById("punchEditId").value = punch.id;
    document.getElementById("punchName").value = punch.name;
    document.getElementById("punchHeight").value = punch.heightInch;
    document.getElementById("punchFormTitle").textContent = "Edit Punch";
    document.getElementById("savePunchBtn").textContent = "Save Changes";
    document.getElementById("cancelPunchEditBtn").textContent = "Cancel / Add New";
    document.getElementById("cancelPunchEditBtn").classList.remove("hidden");
}

function cancelPunchEdit() {
    document.getElementById("punchEditId").value = "";
    document.getElementById("punchName").value = "";
    document.getElementById("punchHeight").value = "";
    document.getElementById("punchFormTitle").textContent = "Add New Punch";
    document.getElementById("savePunchBtn").textContent = "Add Punch";
    document.getElementById("cancelPunchEditBtn").classList.add("hidden");
}

async function deletePunch(punchId) {
    if (!confirm("Delete this punch?")) return;
    const resp = await fetch(`/api/punch/${punchId}`, { method: "DELETE" });
    const data = await resp.json();
    if (data.ok) {
        showStatus("Punch deleted", "info");
        await loadTooling();
        renderPunchList();
    } else {
        showStatus(data.error, "error");
    }
}

// --- Material management ---

function renderMaterialList() {
    const list = document.getElementById("materialList");
    list.innerHTML = "";
    const isMm = currentUnit === "mm";
    const unitLabel = isMm ? "mm" : "in";
    tooling.materials.forEach(mat => {
        const gt = mat.gaugeThickness || {};
        const gaugeKeys = Object.keys(gt).map(Number).sort((a, b) => a - b);

        // Build a compact gauge summary showing common gauges
        let gaugeSummary = "";
        if (gaugeKeys.length > 0) {
            const samples = gaugeKeys.filter(g => [10, 12, 14, 16, 18, 20, 22, 24].includes(g));
            const display = (samples.length > 0 ? samples : gaugeKeys.slice(0, 6));
            gaugeSummary = display.map(g => {
                let t = gt[g] || gt[String(g)];
                if (isMm) t = +(t * MM_PER_INCH).toFixed(2);
                else t = +t.toFixed(4);
                return `${g}ga=${t}`;
            }).join("  ");
        }

        const row = document.createElement("div");
        row.className = "tooling-item" + (mat.stock ? " stock" : "");
        row.innerHTML = `
            <div class="tooling-item-info">
                <span class="tooling-item-name">${escHtml(mat.name)}</span>
                <span class="tooling-item-detail">Tensile: ${mat.materialTensileStrengthPsi.toLocaleString()} PSI | Springback: ${mat.materialSpringback}</span>
                ${gaugeSummary ? `<span class="tooling-item-gauges" title="Gauge thicknesses in ${unitLabel}">${gaugeSummary}</span>` : ""}
            </div>
            <div class="tooling-item-actions">
                ${mat.stock ? '<span class="stock-badge">Stock</span>' : ''}
                <button class="btn btn-tiny btn-secondary tooling-edit-btn" data-id="${mat.id}">Edit</button>
                ${!mat.stock ? `<button class="btn btn-tiny btn-danger tooling-delete-btn" data-id="${mat.id}">Delete</button>` : ''}
            </div>
        `;
        row.querySelector(".tooling-edit-btn").addEventListener("click", () => editMaterial(mat));
        if (!mat.stock) {
            row.querySelector(".tooling-delete-btn").addEventListener("click", () => deleteMaterial(mat.id));
        }
        list.appendChild(row);
    });
}

async function saveMaterial() {
    const editId = document.getElementById("materialEditId").value || null;
    const name = document.getElementById("materialName").value.trim();
    const materialTensileStrengthPsi = parseFloat(document.getElementById("materialTensile").value);
    const insideRadiusRuleOfThumb = parseFloat(document.getElementById("materialRadius").value);
    const materialSpringback = parseFloat(document.getElementById("materialSpringback").value);

    if (!name) { showStatus("Material name is required", "error"); return; }
    if (isNaN(materialTensileStrengthPsi)) { showStatus("Tensile strength is required", "error"); return; }
    if (isNaN(insideRadiusRuleOfThumb)) { showStatus("Inside radius rule of thumb is required", "error"); return; }
    if (isNaN(materialSpringback)) { showStatus("Springback is required", "error"); return; }

    // Gauge data is already in inches in _editGaugeData
    const gaugeThickness = { ..._editGaugeData };

    const body = { name, materialTensileStrengthPsi, insideRadiusRuleOfThumb, materialSpringback, gaugeThickness };
    if (editId) body.id = editId;

    const resp = await fetch("/api/material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.ok) {
        showStatus(editId ? "Material updated" : "Material added", "success");
        cancelMaterialEdit();
        await loadTooling();
        renderMaterialList();
    } else {
        showStatus(data.error, "error");
    }
}

function editMaterial(mat) {
    document.getElementById("materialEditId").value = mat.id;
    document.getElementById("materialName").value = mat.name;
    document.getElementById("materialTensile").value = mat.materialTensileStrengthPsi;
    document.getElementById("materialRadius").value = mat.insideRadiusRuleOfThumb;
    document.getElementById("materialSpringback").value = mat.materialSpringback;
    document.getElementById("materialFormTitle").textContent = "Edit Material";
    document.getElementById("saveMaterialBtn").textContent = "Save Changes";
    document.getElementById("cancelMaterialEditBtn").textContent = "Cancel / Add New";
    document.getElementById("cancelMaterialEditBtn").classList.remove("hidden");
    renderGaugeGrid(mat.gaugeThickness || {});
}

function cancelMaterialEdit() {
    document.getElementById("materialEditId").value = "";
    document.getElementById("materialName").value = "";
    document.getElementById("materialTensile").value = "";
    document.getElementById("materialRadius").value = "";
    document.getElementById("materialSpringback").value = "";
    document.getElementById("materialFormTitle").textContent = "Add New Material";
    document.getElementById("saveMaterialBtn").textContent = "Add Material";
    document.getElementById("cancelMaterialEditBtn").classList.add("hidden");
    renderGaugeGrid({});
}

async function deleteMaterial(matId) {
    if (!confirm("Delete this material?")) return;
    const resp = await fetch(`/api/material/${matId}`, { method: "DELETE" });
    const data = await resp.json();
    if (data.ok) {
        showStatus("Material deleted", "info");
        await loadTooling();
        renderMaterialList();
    } else {
        showStatus(data.error, "error");
    }
}

// --- Gauge grid for material editing ---

// In-memory gauge data for the material being edited (always stored in inches)
let _editGaugeData = {};

function renderGaugeGrid(gaugeThickness) {
    _editGaugeData = {};
    for (const [k, v] of Object.entries(gaugeThickness || {})) {
        if (v && parseFloat(v) > 0) _editGaugeData[parseInt(k)] = parseFloat(v);
    }
    renderGaugeTable();
}

function renderGaugeTable() {
    const wrap = document.getElementById("gaugeTableWrap");
    if (!wrap) return;
    const isMm = currentUnit === "mm";
    const sorted = Object.keys(_editGaugeData).map(Number).sort((a, b) => a - b);

    let html = '<table class="gauge-table"><tbody>';
    sorted.forEach(ga => {
        const inchVal = _editGaugeData[ga];
        const displayVal = isMm ? +(inchVal * MM_PER_INCH).toFixed(3) : +inchVal.toFixed(4);
        html += `<tr data-ga="${ga}">
            <td class="gauge-td-ga">${ga} ga</td>
            <td class="gauge-td-val">
                <input type="number" value="${displayVal}" step="${isMm ? '0.001' : '0.0001'}" min="0" class="gauge-inline-input">
            </td>
            <td class="gauge-td-del"><button class="gauge-del-btn" title="Remove">×</button></td>
        </tr>`;
    });
    // Always show an empty row at the bottom for adding
    html += `<tr class="gauge-new-row">
        <td class="gauge-td-ga">
            <input type="number" min="1" max="50" step="1" placeholder="ga" class="gauge-inline-input gauge-new-ga">
        </td>
        <td class="gauge-td-val">
            <input type="number" step="${isMm ? '0.001' : '0.0001'}" min="0" placeholder="thickness" class="gauge-inline-input gauge-new-val">
        </td>
        <td class="gauge-td-del"><button class="gauge-add-btn btn btn-tiny btn-success" title="Add gauge entry">+</button></td>
    </tr>`;
    html += '</tbody></table>';
    wrap.innerHTML = html;

    // Wire inline edits on existing rows
    wrap.querySelectorAll("tr[data-ga] .gauge-inline-input").forEach(inp => {
        inp.addEventListener("change", () => {
            const ga = parseInt(inp.closest("tr").dataset.ga);
            let val = parseFloat(inp.value);
            if (isNaN(val) || val <= 0) { delete _editGaugeData[ga]; renderGaugeTable(); return; }
            if (isMm) val = val / MM_PER_INCH;
            _editGaugeData[ga] = +val.toFixed(4);
        });
    });

    // Wire delete buttons
    wrap.querySelectorAll(".gauge-del-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const ga = parseInt(btn.closest("tr").dataset.ga);
            delete _editGaugeData[ga];
            renderGaugeTable();
        });
    });

    // Wire add row
    const addBtn = wrap.querySelector(".gauge-add-btn");
    const gaInput = wrap.querySelector(".gauge-new-ga");
    const valInput = wrap.querySelector(".gauge-new-val");

    function doAdd() {
        const ga = parseInt(gaInput.value);
        let thickness = parseFloat(valInput.value);
        if (isNaN(ga) || ga < 1) return;
        if (isNaN(thickness) || thickness <= 0) return;
        if (isMm) thickness = thickness / MM_PER_INCH;
        _editGaugeData[ga] = +thickness.toFixed(4);
        renderGaugeTable();
    }

    addBtn.addEventListener("click", doAdd);
    gaInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); valInput.focus(); } });
    valInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
}

function reRenderGaugeGridForUnit() {
    renderGaugeTable();
}

// --- Refresh tooling dropdowns in open bend cards ---

function refreshAllToolingDropdowns() {
    document.querySelectorAll("#bendList .bend-card").forEach(card => {
        const dieSelect = card.querySelector('[name="dieId"]');
        const punchSelect = card.querySelector('[name="punchId"]');
        const matSelect = card.querySelector('[name="materialId"]');

        const dieVal = dieSelect?.value;
        const punchVal = punchSelect?.value;
        const matVal = matSelect?.value;

        if (dieSelect) populateSelect(dieSelect, tooling.dies, "id", "name", dieVal);
        if (punchSelect) populateSelect(punchSelect, tooling.punches, "id", "name", punchVal);
        if (matSelect) populateSelect(matSelect, tooling.materials, "id", "name", matVal);
    });

    if (currentView === "table") {
        renderTableFromForm();
    }
}

// --- Check for Updates ---
async function checkForUpdates() {
    const btn = document.getElementById("checkUpdateBtn");
    const currentVersion = document.getElementById("versionLabel")?.textContent?.replace("v", "").trim();
    btn.textContent = "Checking...";
    btn.disabled = true;

    try {
        const resp = await fetch("https://api.github.com/repos/shopEngineering/BendGen/releases/latest", {
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) throw new Error("GitHub API error");
        const release = await resp.json();
        const latestVersion = (release.tag_name || "").replace("v", "");

        if (!currentVersion || !latestVersion) {
            showStatus("Could not determine version info", "error");
        } else if (latestVersion !== currentVersion) {
            // Find download links
            const assets = (release.assets || []).map(a => a.browser_download_url);
            const msg = `Update available: v${latestVersion} (you have v${currentVersion})`;
            showStatus(msg, "info");
            btn.textContent = "v" + latestVersion + " Available";
            btn.classList.remove("btn-secondary");
            btn.classList.add("btn-success");
            btn.onclick = () => window.open(release.html_url, "_blank");
            btn.disabled = false;
            btn.title = "Click to open the download page";
        } else {
            showStatus("You're on the latest version (v" + currentVersion + ")", "success");
            btn.textContent = "Up to Date";
            setTimeout(() => {
                btn.textContent = "Check for Updates";
                btn.disabled = false;
            }, 5000);
        }
    } catch (e) {
        showStatus("Could not check for updates — are you online?", "error");
        btn.textContent = "Check for Updates";
        btn.disabled = false;
    }
}

// --- Custom Tooltips ---
function wireCustomTooltips() {
    const tip = document.createElement("div");
    tip.className = "custom-tooltip";
    document.body.appendChild(tip);

    let showTimeout = null;

    document.addEventListener("mouseover", (e) => {
        const el = e.target.closest("[title]");
        if (!el) return;
        const text = el.getAttribute("title");
        if (!text) return;
        // Store and remove native title to prevent double tooltip
        el.dataset.tip = text;
        el.removeAttribute("title");

        clearTimeout(showTimeout);
        showTimeout = setTimeout(() => {
            tip.textContent = text;
            tip.classList.add("visible");
            positionTooltip(tip, el);
        }, 400);
    });

    document.addEventListener("mouseout", (e) => {
        const el = e.target.closest("[data-tip]");
        if (!el) return;
        clearTimeout(showTimeout);
        tip.classList.remove("visible");
        // Restore title attribute
        el.setAttribute("title", el.dataset.tip);
        delete el.dataset.tip;
    });

    function positionTooltip(tip, el) {
        const rect = el.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();
        let top = rect.bottom + 8;
        let left = rect.left + (rect.width / 2) - (tipRect.width / 2);

        // Keep on screen
        if (left < 8) left = 8;
        if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
        if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 8;

        tip.style.top = top + "px";
        tip.style.left = left + "px";
    }
}

// --- USB Drive Bridge Integration ---

const BRIDGE_STORAGE_KEY = "bendgen_bridge_address";

function getBridgeUrl() {
    const addr = localStorage.getItem(BRIDGE_STORAGE_KEY);
    if (!addr) return null;
    if (addr.startsWith("http://") || addr.startsWith("https://")) return addr;
    return "http://" + addr;
}

function promptBridgeAddress() {
    document.getElementById("bridgeModal").classList.remove("hidden");
    const input = document.getElementById("bridgeAddress");
    input.value = localStorage.getItem(BRIDGE_STORAGE_KEY) || "";
    input.focus();

    document.getElementById("closeBridgeModal").onclick = () => {
        document.getElementById("bridgeModal").classList.add("hidden");
    };
    document.getElementById("bridgeModal").onclick = (e) => {
        if (e.target.id === "bridgeModal") document.getElementById("bridgeModal").classList.add("hidden");
    };
    document.getElementById("bridgeSaveBtn").onclick = () => {
        const val = input.value.trim();
        if (val) {
            localStorage.setItem(BRIDGE_STORAGE_KEY, val);
            showStatus("Bridge address saved: " + val, "success");
        } else {
            localStorage.removeItem(BRIDGE_STORAGE_KEY);
            showStatus("Bridge address cleared", "info");
        }
        document.getElementById("bridgeModal").classList.add("hidden");
    };
    document.getElementById("bridgeTestBtn").onclick = testBridgeConnection;
}

async function testBridgeConnection() {
    const input = document.getElementById("bridgeAddress");
    const result = document.getElementById("bridgeTestResult");
    const addr = input.value.trim();
    if (!addr) {
        result.textContent = "Enter an address first";
        result.style.color = "var(--warning)";
        return;
    }
    const url = (addr.startsWith("http") ? addr : "http://" + addr);
    result.textContent = "Testing...";
    result.style.color = "var(--text-dim)";
    try {
        const resp = await fetch(url + "/api/status", { signal: AbortSignal.timeout(5000) });
        const data = await resp.json();
        if (data.ok && data.gadget_active) {
            result.textContent = "Connected — gadget active";
            result.style.color = "var(--success)";
        } else if (data.ok) {
            result.textContent = "Connected — gadget not active (check USB cable)";
            result.style.color = "var(--warning)";
        } else {
            result.textContent = "Bridge responded but reported an error";
            result.style.color = "var(--warning)";
        }
    } catch (e) {
        result.textContent = "Cannot reach bridge at " + addr;
        result.style.color = "var(--danger)";
    }
}

const DEPLOY_NAME_STORAGE_KEY = "bendgen_deploy_name";
const DEPLOY_NAME_DEFAULT = "bendgen";

function sanitizeDeployName(s) {
    return (s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
}

function _currentDatePrefix() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
        String(d.getFullYear()).slice(2) +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        pad(d.getHours()) +
        pad(d.getMinutes())
    );
}

function promptDeployName(onConfirm) {
    const modal = document.getElementById("deployNameModal");
    const input = document.getElementById("deployNameInput");
    const preview = document.getElementById("deployFilenamePreview");

    // Default to the last-used name, falling back to DEPLOY_NAME_DEFAULT
    input.value = localStorage.getItem(DEPLOY_NAME_STORAGE_KEY) || DEPLOY_NAME_DEFAULT;

    const updatePreview = () => {
        const name = sanitizeDeployName(input.value) || DEPLOY_NAME_DEFAULT;
        preview.textContent = "Filename: B" + _currentDatePrefix() + name + ".zip";
    };
    updatePreview();
    input.oninput = updatePreview;

    modal.classList.remove("hidden");
    setTimeout(() => { input.focus(); input.select(); }, 50);

    const close = () => {
        modal.classList.add("hidden");
        input.oninput = null;
        input.onkeydown = null;
    };
    const confirm = () => {
        const name = sanitizeDeployName(input.value) || DEPLOY_NAME_DEFAULT;
        localStorage.setItem(DEPLOY_NAME_STORAGE_KEY, name);
        close();
        onConfirm(name);
    };

    document.getElementById("deployNameConfirmBtn").onclick = confirm;
    document.getElementById("deployNameCancelBtn").onclick = close;
    document.getElementById("closeDeployNameModal").onclick = close;
    modal.onclick = (e) => { if (e.target.id === "deployNameModal") close(); };
    input.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); confirm(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
    };
}

async function deployToTitan() {
    const bridgeUrl = getBridgeUrl();
    if (!bridgeUrl) {
        promptBridgeAddress();
        return;
    }

    if (currentView === "table") syncFormFromTable();

    promptDeployName((name) => { _performDeploy(bridgeUrl, name); });
}

async function _performDeploy(bridgeUrl, name) {
    showStatus("Deploying to Titan...", "info");

    try {
        // Get the ZIP from BendGen with the user's chosen name portion
        const exportResp = await fetch(
            "/api/export?name=" + encodeURIComponent(name),
            { method: "POST" }
        );
        if (!exportResp.ok) {
            showStatus("Export failed", "error");
            return;
        }
        const blob = await exportResp.blob();
        const cd = exportResp.headers.get("Content-Disposition") || "";
        const fnMatch = cd.match(/filename=([^\s;]+)/);
        const filename = fnMatch ? fnMatch[1] : _makeBendControlFilename();

        // Send to bridge
        const formData = new FormData();
        formData.append("file", blob, filename);

        const deployResp = await fetch(bridgeUrl + "/api/deploy", {
            method: "POST",
            body: formData,
        });
        const deployResult = await deployResp.json();

        if (deployResult.ok) {
            showStatus(
                "Deployed to Titan as " + (deployResult.filename || filename) +
                ". Use 'Restore From' on the press brake to load.",
                "success"
            );
        } else {
            showStatus("Deploy failed: " + (deployResult.error || "Unknown error"), "error");
        }
    } catch (e) {
        if (e.name === "TypeError" && e.message.includes("fetch")) {
            showStatus("Cannot reach bridge — check address in settings", "error");
            promptBridgeAddress();
        } else {
            showStatus("Deploy failed: " + e.message, "error");
        }
    }
}

async function importFromTitan() {
    const bridgeUrl = getBridgeUrl();
    if (!bridgeUrl) {
        promptBridgeAddress();
        return;
    }

    showStatus("Checking Titan USB drive...", "info");

    try {
        const resp = await fetch(bridgeUrl + "/api/backups", { signal: AbortSignal.timeout(10000) });
        const data = await resp.json();

        if (!data.ok) {
            showStatus("Failed to read USB drive: " + (data.error || "Unknown error"), "error");
            return;
        }

        if (data.files.length === 0) {
            showStatus("No files found on Titan USB drive", "info");
            return;
        }

        // Show the bridge modal with the file listing
        document.getElementById("bridgeModal").classList.remove("hidden");
        document.getElementById("bridgeAddress").value = localStorage.getItem(BRIDGE_STORAGE_KEY) || "";
        const listDiv = document.getElementById("bridgeBackupsList");
        const contentDiv = document.getElementById("bridgeBackupsContent");
        listDiv.classList.remove("hidden");

        contentDiv.innerHTML = data.files.map(f => {
            const sizeKB = Math.round(f.size / 1024);
            const date = new Date(f.modified * 1000).toLocaleString();
            return `<div class="tooling-item" style="padding:8px 12px">
                <div class="tooling-item-info">
                    <span class="tooling-item-name">${escHtml(f.name)}</span>
                    <span class="tooling-item-detail">${sizeKB} KB — ${date}</span>
                </div>
                <div class="tooling-item-actions">
                    <button class="btn btn-tiny btn-primary bridge-import-btn" data-filename="${escHtml(f.name)}">Import</button>
                </div>
            </div>`;
        }).join("");

        // Wire import buttons
        contentDiv.querySelectorAll(".bridge-import-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const filename = btn.dataset.filename;
                showStatus("Downloading " + filename + " from Titan...", "info");
                try {
                    const dlResp = await fetch(bridgeUrl + "/api/backup/" + encodeURIComponent(filename));
                    if (!dlResp.ok) throw new Error("Download failed");
                    const zipBlob = await dlResp.blob();

                    // Send to BendGen import endpoint
                    const importForm = new FormData();
                    importForm.append("file", zipBlob, filename);
                    const importResp = await fetch("/api/import", { method: "POST", body: importForm });
                    const importResult = await importResp.json();

                    if (importResult.ok) {
                        document.getElementById("bridgeModal").classList.add("hidden");
                        await loadTooling();
                        await loadPrograms();
                        showStatus(`Imported from Titan: ${importResult.counts.programs} programs, ${importResult.counts.bends} bends`, "success");
                    } else {
                        showStatus("Import failed: " + (importResult.error || "Unknown error"), "error");
                    }
                } catch (e) {
                    showStatus("Import failed: " + e.message, "error");
                }
            });
        });

    } catch (e) {
        if (e.name === "TypeError" || e.name === "AbortError") {
            showStatus("Cannot reach bridge — check address in settings", "error");
            promptBridgeAddress();
        } else {
            showStatus("Error: " + e.message, "error");
        }
    }
}
