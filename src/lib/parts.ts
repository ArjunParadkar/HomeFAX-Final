import { stageDef, stageIndex } from "./stages";
import type { PartCategory, PartLine, ReconResult, StageId } from "./types";

/**
 * Quantity takeoff.
 *
 * Two sources feed the parts list and they are labelled differently on purpose:
 *
 *   measured  — computed from the reconstruction's own geometry (wall area,
 *               linear feet, stud spacing). Reproducible, and only as accurate
 *               as `metresPerUnit`.
 *   detected  — a vision model saw the item in the keyframes and counted it.
 *   derived   — implied by a measured quantity (fasteners per sheet, etc).
 *
 * Nothing here invents a quantity out of nothing: every line carries the
 * derivation string that produced it.
 */

const M2_PER_FT2 = 0.092903;
const M_PER_FT = 0.3048;

export type CatalogEntry = {
  sku: string;
  name: string;
  category: PartCategory;
  unit: PartLine["unit"];
  spec?: string;
  unitCostUsd?: number;
};

/** A deliberately small catalogue — the common residential lines, priced roughly. */
export const CATALOG: Record<string, CatalogEntry> = {
  "LUM-2X4-92": {
    sku: "LUM-2X4-92",
    name: "2x4 stud",
    category: "lumber",
    unit: "ea",
    spec: "92-5/8in precut SPF",
    unitCostUsd: 4.28,
  },
  "LUM-2X4-PLATE": {
    sku: "LUM-2X4-PLATE",
    name: "2x4 plate stock",
    category: "lumber",
    unit: "lf",
    spec: "SPF, top and bottom plates",
    unitCostUsd: 0.72,
  },
  "LUM-2X10-HDR": {
    sku: "LUM-2X10-HDR",
    name: "2x10 header stock",
    category: "lumber",
    unit: "lf",
    spec: "SPF #2",
    unitCostUsd: 3.15,
  },
  "SHT-OSB-716": {
    sku: "SHT-OSB-716",
    name: "7/16in OSB sheathing",
    category: "lumber",
    unit: "sheet",
    spec: "4x8",
    unitCostUsd: 18.5,
  },
  "DRY-12-4X8": {
    sku: "DRY-12-4X8",
    name: "1/2in drywall",
    category: "drywall",
    unit: "sheet",
    spec: "4x8 regular",
    unitCostUsd: 14.2,
  },
  "DRY-MUD": {
    sku: "DRY-MUD",
    name: "Joint compound",
    category: "drywall",
    unit: "ea",
    spec: "4.5 gal all-purpose",
    unitCostUsd: 17.8,
  },
  "DRY-TAPE": {
    sku: "DRY-TAPE",
    name: "Paper joint tape",
    category: "drywall",
    unit: "roll",
    spec: "500ft",
    unitCostUsd: 6.4,
  },
  "INS-R13-BATT": {
    sku: "INS-R13-BATT",
    name: "R-13 batt insulation",
    category: "insulation",
    unit: "sf",
    spec: "15in x 93in kraft-faced",
    unitCostUsd: 0.68,
  },
  "INS-R38-BATT": {
    sku: "INS-R38-BATT",
    name: "R-38 batt insulation",
    category: "insulation",
    unit: "sf",
    spec: "ceiling, unfaced",
    unitCostUsd: 1.35,
  },
  "ELE-BOX-1G": {
    sku: "ELE-BOX-1G",
    name: "Single-gang box",
    category: "electrical",
    unit: "ea",
    spec: "18 cu in nail-on",
    unitCostUsd: 1.35,
  },
  "ELE-NM-12-2": {
    sku: "ELE-NM-12-2",
    name: "12-2 NM-B cable",
    category: "electrical",
    unit: "lf",
    spec: "with ground",
    unitCostUsd: 0.92,
  },
  "ELE-NM-14-2": {
    sku: "ELE-NM-14-2",
    name: "14-2 NM-B cable",
    category: "electrical",
    unit: "lf",
    spec: "with ground",
    unitCostUsd: 0.61,
  },
  "ELE-PLATE-NAIL": {
    sku: "ELE-PLATE-NAIL",
    name: "Steel nail plate",
    category: "electrical",
    unit: "ea",
    spec: "1-1/2in x 2-5/8in",
    unitCostUsd: 0.42,
  },
  "PLM-PEX-12": {
    sku: "PLM-PEX-12",
    name: "1/2in PEX-A tubing",
    category: "plumbing",
    unit: "lf",
    unitCostUsd: 0.55,
  },
  "PLM-PVC-3": {
    sku: "PLM-PVC-3",
    name: "3in PVC DWV pipe",
    category: "plumbing",
    unit: "lf",
    unitCostUsd: 4.1,
  },
  "PLM-PVC-2": {
    sku: "PLM-PVC-2",
    name: "2in PVC DWV pipe",
    category: "plumbing",
    unit: "lf",
    unitCostUsd: 2.35,
  },
  "HVA-DUCT-FLEX8": {
    sku: "HVA-DUCT-FLEX8",
    name: "8in insulated flex duct",
    category: "hvac",
    unit: "lf",
    spec: "R-8",
    unitCostUsd: 3.9,
  },
  "HVA-BOOT": {
    sku: "HVA-BOOT",
    name: "Register boot",
    category: "hvac",
    unit: "ea",
    spec: "4x10 to 6in",
    unitCostUsd: 8.75,
  },
  "CON-READYMIX": {
    sku: "CON-READYMIX",
    name: "Ready-mix concrete",
    category: "concrete",
    unit: "cy",
    spec: "3000 psi",
    unitCostUsd: 168,
  },
  "CON-REBAR-4": {
    sku: "CON-REBAR-4",
    name: "#4 rebar",
    category: "concrete",
    unit: "lf",
    unitCostUsd: 0.78,
  },
  "FAS-NAIL-16D": {
    sku: "FAS-NAIL-16D",
    name: "16d framing nails",
    category: "fastener",
    unit: "box",
    spec: "5 lb collated",
    unitCostUsd: 24.5,
  },
  "FAS-SCREW-125": {
    sku: "FAS-SCREW-125",
    name: "1-1/4in drywall screws",
    category: "fastener",
    unit: "box",
    spec: "5 lb",
    unitCostUsd: 21.9,
  },
  "ROO-SHINGLE": {
    sku: "ROO-SHINGLE",
    name: "Architectural shingles",
    category: "roofing",
    unit: "sf",
    unitCostUsd: 1.28,
  },
  "ROO-UNDERLAY": {
    sku: "ROO-UNDERLAY",
    name: "Synthetic underlayment",
    category: "roofing",
    unit: "sf",
    unitCostUsd: 0.19,
  },
};

function line(
  sku: string,
  quantity: number,
  basis: PartLine["basis"],
  derivation: string,
  confidence: number,
  stage: StageId,
): PartLine | null {
  const entry = CATALOG[sku];
  if (!entry || quantity <= 0) return null;
  return {
    id: `${stage}:${sku}`,
    sku: entry.sku,
    name: entry.name,
    category: entry.category,
    spec: entry.spec,
    quantity: Math.round(quantity * 10) / 10,
    unit: entry.unit,
    basis,
    derivation,
    confidence,
    unitCostUsd: entry.unitCostUsd,
    stage,
  };
}

/**
 * The geometric half of the takeoff: quantities that follow from measured
 * surfaces, so they hold up without any vision model in the loop.
 */
export function takeoffFromGeometry(recon: ReconResult, stage: StageId): PartLine[] {
  const g = recon.geometry;
  const out: (PartLine | null)[] = [];

  const wallFt2 = g.wallAreaM2 / M2_PER_FT2;
  const floorFt2 = g.floorAreaM2 / M2_PER_FT2;
  const heightFt = (g.ceilingHeightM ?? 2.44) / M_PER_FT;
  // Wall run in linear feet, backed out of area and height.
  const wallLf = heightFt > 0 ? wallFt2 / heightFt : 0;
  const spacingIn = g.studSpacingIn ?? 16;
  const scaleNote =
    recon.metrics.scaleSource === "assumed"
      ? " (scale assumed — place a tape or 4ft level in the next capture to lock it)"
      : "";
  // Measured lines inherit the uncertainty of the scale estimate.
  const conf = recon.metrics.scaleSource === "assumed" ? 0.55 : 0.85;

  switch (stage) {
    case "foundation": {
      // Slab at 4in, footings ignored — they are not visible in the mesh.
      const cy = (floorFt2 * (4 / 12)) / 27;
      out.push(
        line(
          "CON-READYMIX",
          cy,
          "measured",
          `${floorFt2.toFixed(0)} sf slab at 4in thick / 27 cf per cy${scaleNote}`,
          conf,
          stage,
        ),
      );
      // #4 at 16in OC each way.
      const side = Math.sqrt(Math.max(floorFt2, 1));
      const runs = Math.ceil((side * 12) / 16) * 2;
      out.push(
        line(
          "CON-REBAR-4",
          runs * side,
          "measured",
          `${runs} runs at 16in OC both directions across a ${side.toFixed(0)}ft span`,
          conf * 0.8,
          stage,
        ),
      );
      break;
    }
    case "framing": {
      const studs = Math.ceil((wallLf * 12) / spacingIn) + 3; // +3 for corners and channel
      out.push(
        line(
          "LUM-2X4-92",
          studs,
          "measured",
          `${wallLf.toFixed(0)} lf of wall at ${spacingIn.toFixed(1)}in OC, plus 3 for corners${scaleNote}`,
          conf,
          stage,
        ),
      );
      out.push(
        line(
          "LUM-2X4-PLATE",
          wallLf * 3,
          "measured",
          `${wallLf.toFixed(0)} lf of wall x 3 plates (one bottom, doubled top)`,
          conf,
          stage,
        ),
      );
      out.push(
        line(
          "SHT-OSB-716",
          Math.ceil(wallFt2 / 32),
          "derived",
          `${wallFt2.toFixed(0)} sf of wall / 32 sf per 4x8 sheet`,
          conf * 0.9,
          stage,
        ),
      );
      out.push(
        line(
          "FAS-NAIL-16D",
          Math.ceil(studs / 120),
          "derived",
          `roughly one 5 lb box per 120 studs framed`,
          0.5,
          stage,
        ),
      );
      break;
    }
    case "roofing": {
      // Roof area approximated from footprint with a 6:12 pitch factor.
      const roofFt2 = floorFt2 * 1.118;
      out.push(
        line(
          "ROO-SHINGLE",
          roofFt2,
          "measured",
          `${floorFt2.toFixed(0)} sf footprint x 1.118 pitch factor (6:12)${scaleNote}`,
          conf * 0.75,
          stage,
        ),
      );
      out.push(
        line("ROO-UNDERLAY", roofFt2, "derived", "one to one with shingle coverage", conf * 0.75, stage),
      );
      break;
    }
    case "insulation": {
      out.push(
        line(
          "INS-R13-BATT",
          wallFt2,
          "measured",
          `${wallFt2.toFixed(0)} sf of exposed wall cavity${scaleNote}`,
          conf,
          stage,
        ),
      );
      out.push(
        line("INS-R38-BATT", floorFt2, "measured", `${floorFt2.toFixed(0)} sf of ceiling`, conf, stage),
      );
      break;
    }
    case "drywall": {
      const boardFt2 = wallFt2 + floorFt2; // walls plus ceiling
      const sheets = Math.ceil((boardFt2 * 1.1) / 32); // 10% waste
      out.push(
        line(
          "DRY-12-4X8",
          sheets,
          "measured",
          `${boardFt2.toFixed(0)} sf of wall and ceiling + 10% waste / 32 sf per sheet${scaleNote}`,
          conf,
          stage,
        ),
      );
      out.push(line("DRY-MUD", Math.ceil(sheets / 12), "derived", "one 4.5 gal pail per 12 sheets", 0.6, stage));
      out.push(line("DRY-TAPE", Math.ceil(sheets / 25), "derived", "one 500ft roll per 25 sheets", 0.6, stage));
      out.push(
        line("FAS-SCREW-125", Math.ceil(sheets / 60), "derived", "one 5 lb box per 60 sheets", 0.6, stage),
      );
      break;
    }
    case "rough_electrical": {
      // Cable estimated from wall run: a home run averages ~1.6x the wall length it serves.
      out.push(
        line(
          "ELE-NM-14-2",
          wallLf * 1.6,
          "derived",
          `${wallLf.toFixed(0)} lf of wall x 1.6 routing factor for lighting circuits`,
          0.45,
          stage,
        ),
      );
      break;
    }
    case "rough_plumbing": {
      out.push(
        line("PLM-PEX-12", wallLf * 0.8, "derived", `${wallLf.toFixed(0)} lf of wall x 0.8 supply routing factor`, 0.4, stage),
      );
      break;
    }
    default:
      break;
  }

  return out.filter((l): l is PartLine => l !== null);
}

/**
 * Turns a vision detection into a catalogue line. Unknown SKUs are dropped —
 * the parts list stays a real orderable list, not free text.
 */
export function partFromDetection(
  sku: string,
  quantity: number,
  confidence: number,
  derivation: string,
  stage: StageId,
): PartLine | null {
  return line(sku, quantity, "detected", derivation, confidence, stage);
}

export const CATALOG_SKUS = Object.keys(CATALOG);

/**
 * Rolls every stage's lines into one list. Same SKU at the same stage is summed;
 * across stages the later, more-informed count wins rather than double-ordering
 * material that was simply visible twice.
 */
export function cumulativeParts(perStage: { stage: StageId; parts: PartLine[] }[]): PartLine[] {
  const bySku = new Map<string, PartLine>();

  const ordered = [...perStage].sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));

  for (const { parts } of ordered) {
    for (const p of parts) {
      const existing = bySku.get(p.sku);
      if (!existing) {
        bySku.set(p.sku, { ...p });
        continue;
      }
      // A measured count from a later stage supersedes an earlier estimate of
      // the same material; two genuinely different installs would carry
      // different SKUs.
      const preferNew = p.basis === "measured" && existing.basis !== "measured";
      const sameStage = existing.stage === p.stage;
      if (sameStage) {
        existing.quantity = Math.round((existing.quantity + p.quantity) * 10) / 10;
      } else if (preferNew || p.quantity > existing.quantity) {
        bySku.set(p.sku, {
          ...p,
          derivation: `${p.derivation} (supersedes ${existing.stage} estimate of ${existing.quantity} ${existing.unit})`,
        });
      }
    }
  }

  return [...bySku.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

export function partsSubtotal(parts: PartLine[]): number {
  return parts.reduce((a, p) => a + (p.unitCostUsd ?? 0) * p.quantity, 0);
}

/** SKUs a stage is expected to produce — used to prompt the vision model. */
export function expectedSkusForStage(stage: StageId): CatalogEntry[] {
  const cats = new Set<PartCategory>(stageDef(stage).expects);
  return Object.values(CATALOG).filter((e) => cats.has(e.category));
}
