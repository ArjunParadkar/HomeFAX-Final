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
 *
 * Confidence haircut rule: scaleSource "assumed" caps measured lines at 0.55;
 * reference or stud-spacing scale starts at 0.85. Derived lines carry their own
 * lower baseline (0.35–0.5) since they add heuristic uncertainty on top.
 */

import { stageIndex } from "./stages";
import type { PartLine, ReconResult, StageId } from "./types";

// Re-export the catalog types and helpers so that existing importers
// (vision.ts: expectedSkusForStage, partFromDetection) keep working without
// changing their import paths.
export type { CatalogEntry } from "./catalog";
export { CATALOG, CATALOG_SKUS, expectedSkusForStage } from "./catalog";

import { CATALOG } from "./catalog";

const M2_PER_FT2 = 0.092903;
const M_PER_FT = 0.3048;

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
    case "site": {
      // Vapor barrier covers the crawlspace / under-slab footprint.
      const vbRolls = Math.max(1, Math.ceil(floorFt2 / 2000));
      out.push(
        line(
          "CON-VAPOR-BAR",
          vbRolls,
          "measured",
          `${floorFt2.toFixed(0)} sf footprint / 2000 sf per roll${scaleNote}`,
          conf * 0.8,
          stage,
        ),
      );
      // Form stakes: ~2 per linear foot of excavation perimeter.
      const formStakes = Math.max(4, Math.ceil(wallLf * 2));
      out.push(
        line(
          "CON-FORM-STAKE",
          formStakes,
          "derived",
          `${wallLf.toFixed(0)} lf of form perimeter x 2 stakes per lf`,
          0.4,
          stage,
        ),
      );
      break;
    }

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
      // Anchor bolts: IRC requires one within 12in of each end of every sill piece
      // and at 6ft max OC; perimeter at 6ft OC is a conservative estimate.
      const anchorBolts = Math.ceil(wallLf / 6);
      out.push(
        line(
          "CON-ANCHOR-BOLT",
          anchorBolts,
          "derived",
          `${wallLf.toFixed(0)} lf of sill / 6ft OC (IRC minimum spacing)`,
          0.5,
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
      // Hurricane ties: one per rafter/truss end — estimated from footprint perimeter.
      const rafterCount = Math.ceil((wallLf / 2) / (spacingIn / 12));
      out.push(
        line(
          "HRD-HURR-TIE",
          rafterCount * 2,
          "derived",
          `${rafterCount} rafter positions x 2 ties (each end), at ${spacingIn.toFixed(1)}in OC`,
          0.4,
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
      // House wrap: wall area only (roofing underlayment covers the deck).
      const wrapRolls = Math.max(1, Math.ceil(wallFt2 / 1000));
      out.push(
        line(
          "ROO-WRAP",
          wrapRolls,
          "measured",
          `${wallFt2.toFixed(0)} sf of wall / 1000 sf per roll${scaleNote}`,
          conf * 0.8,
          stage,
        ),
      );
      // Drip edge: eave length ≈ half the perimeter each side; gable ends the other half.
      out.push(
        line(
          "ROO-DRIP-EDGE",
          wallLf,
          "derived",
          `${wallLf.toFixed(0)} lf of perimeter (eave + gable drip edge)`,
          0.45,
          stage,
        ),
      );
      // Roofing nails: 1 box per ~1000 sf of roofing.
      out.push(
        line(
          "ROO-NAILS",
          Math.max(1, Math.ceil(roofFt2 / 1000)),
          "derived",
          `${roofFt2.toFixed(0)} sf of roof / 1000 sf per box`,
          0.5,
          stage,
        ),
      );
      // Ice & water shield: 3ft at eaves + valleys; estimated as 2 rolls for a typical house.
      out.push(
        line(
          "ROO-ICE-WATER",
          Math.max(1, Math.ceil(wallLf / 100)),
          "derived",
          `${wallLf.toFixed(0)} lf perimeter / 100 lf per roll (3ft eave coverage)`,
          0.4,
          stage,
        ),
      );
      break;
    }

    case "rough_plumbing": {
      // PEX supply lines: 0.8x wall run factor for horizontal + vertical routing.
      out.push(
        line(
          "PLM-PEX-12",
          wallLf * 0.8,
          "derived",
          `${wallLf.toFixed(0)} lf of wall x 0.8 supply routing factor`,
          0.4,
          stage,
        ),
      );
      // Main DWV stack and primary waste runs: 3in pipe.
      const dwv3Lf = Math.max(4, Math.ceil(wallLf * 0.25));
      out.push(
        line(
          "PLM-PVC-3",
          dwv3Lf,
          "derived",
          `${wallLf.toFixed(0)} lf wall x 0.25 factor for main DWV stack and primary waste runs`,
          0.4,
          stage,
        ),
      );
      // Branch drains and vent lines: 2in pipe.
      const dwv2Lf = Math.max(6, Math.ceil(wallLf * 0.35));
      out.push(
        line(
          "PLM-PVC-2",
          dwv2Lf,
          "derived",
          `${wallLf.toFixed(0)} lf wall x 0.35 factor for branch drains and individual vents`,
          0.4,
          stage,
        ),
      );
      // Nail plates protecting supply lines running through stud faces.
      const plmNailPlates = Math.max(4, Math.ceil(wallLf / 8));
      out.push(
        line(
          "ELE-PLATE-NAIL",
          plmNailPlates,
          "derived",
          `${wallLf.toFixed(0)} lf of wall / 8 lf per nail plate protecting PEX supply lines`,
          0.35,
          stage,
        ),
      );
      break;
    }

    case "rough_electrical": {
      // 14-2 for lighting circuits: 1.6x wall length routing factor.
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
      // 12-2 for kitchen, bath, garage 20A circuits: ~0.4x wall factor.
      out.push(
        line(
          "ELE-NM-12-2",
          wallLf * 0.4,
          "derived",
          `${wallLf.toFixed(0)} lf wall x 0.4 factor for 20A kitchen/bath circuits`,
          0.4,
          stage,
        ),
      );
      // NEC 210.52: receptacle within 6ft of any point along wall →
      // approximately one box per 12 lf of wall, plus switches.
      const boxCount = Math.max(4, Math.ceil(wallLf / 12) + 3);
      out.push(
        line(
          "ELE-BOX-1G",
          boxCount,
          "derived",
          `NEC 210.52 heuristic: 1 box per 12 lf of wall (${wallLf.toFixed(0)} lf) + 3 switch locations`,
          0.4,
          stage,
        ),
      );
      // Receptacles: ~70% of boxes are receptacle locations.
      out.push(
        line(
          "ELE-RECEP",
          Math.ceil(boxCount * 0.7),
          "derived",
          `~70% of ${boxCount} box locations are receptacle positions`,
          0.4,
          stage,
        ),
      );
      // Nail plates: one per cable run through framing within 1-1/4in of stud face.
      out.push(
        line(
          "ELE-PLATE-NAIL",
          boxCount,
          "derived",
          `1 nail plate per box for cable runs within 1-1/4in of stud face (NEC 300.4)`,
          0.4,
          stage,
        ),
      );
      break;
    }

    case "hvac": {
      // Trunk duct: roughly 1 lf per 100 sf of conditioned floor area.
      const trunkLf = Math.max(4, Math.ceil(floorFt2 / 100));
      out.push(
        line(
          "HVA-TRUNK",
          trunkLf,
          "derived",
          `${floorFt2.toFixed(0)} sf floor / 100 sf per lf of trunk duct (rule-of-thumb)`,
          0.4,
          stage,
        ),
      );
      // Register boots: 1 per ~150 sf of conditioned area.
      const regCount = Math.max(2, Math.ceil(floorFt2 / 150));
      out.push(
        line(
          "HVA-BOOT",
          regCount,
          "derived",
          `1 boot per 150 sf of conditioned floor area; ${floorFt2.toFixed(0)} sf`,
          0.45,
          stage,
        ),
      );
      // Flex duct: average 8 lf branch per register.
      const flexLf = regCount * 8;
      out.push(
        line(
          "HVA-DUCT-FLEX8",
          flexLf,
          "derived",
          `${regCount} registers x 8 lf avg branch run from trunk`,
          0.4,
          stage,
        ),
      );
      // Supply registers and return grille.
      out.push(
        line(
          "HVA-REGISTER",
          regCount,
          "derived",
          `1 supply register per boot`,
          0.45,
          stage,
        ),
      );
      // Return grille: 1 per 500 sf — minimum 1.
      const grilles = Math.max(1, Math.ceil(floorFt2 / 500));
      out.push(
        line(
          "HVA-GRILLE",
          grilles,
          "derived",
          `${floorFt2.toFixed(0)} sf floor / 500 sf per return grille`,
          0.4,
          stage,
        ),
      );
      // Thermostat: 1 per system.
      out.push(
        line(
          "HVA-THERMO",
          1,
          "derived",
          `1 thermostat per system`,
          0.6,
          stage,
        ),
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
      // Spray-foam cans for air-sealing top plates and penetrations.
      const foamCans = Math.max(2, Math.ceil(wallLf / 20));
      out.push(
        line(
          "INS-SPRAYFOAM",
          foamCans,
          "derived",
          `${wallLf.toFixed(0)} lf of top plate / 20 lf per can for penetration air-sealing`,
          0.4,
          stage,
        ),
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
      // Corner bead: vertical outside corners; rough estimate from wall perimeter.
      const cornerBeadLf = heightFt * Math.ceil(wallLf / 16);
      out.push(
        line(
          "DRY-CORNER-BEAD",
          cornerBeadLf,
          "derived",
          `est. ${Math.ceil(wallLf / 16)} outside corners x ${heightFt.toFixed(1)}ft height`,
          0.4,
          stage,
        ),
      );
      break;
    }

    case "finishes": {
      const ceilFt2 = floorFt2; // ceiling area mirrors floor area
      // Paint: two coats at 350 sf/gal/coat.
      const wallGal = Math.max(1, Math.ceil((wallFt2 * 2) / 350));
      const ceilGal = Math.max(1, Math.ceil((ceilFt2 * 2) / 350));
      out.push(
        line(
          "FIN-PAINT-EGGSHELL",
          wallGal,
          "measured",
          `${wallFt2.toFixed(0)} sf of wall x 2 coats / 350 sf per gal per coat${scaleNote}`,
          conf * 0.8,
          stage,
        ),
      );
      out.push(
        line(
          "FIN-PAINT-CEILING",
          ceilGal,
          "measured",
          `${ceilFt2.toFixed(0)} sf of ceiling x 2 coats / 350 sf per gal per coat${scaleNote}`,
          conf * 0.8,
          stage,
        ),
      );
      // Primer: 1 coat at 400 sf/gal over new drywall.
      const primerGal = Math.max(1, Math.ceil((wallFt2 + ceilFt2) / 400));
      out.push(
        line(
          "FIN-PRIMER-PVA",
          primerGal,
          "measured",
          `${(wallFt2 + ceilFt2).toFixed(0)} sf of new drywall, 1 coat at 400 sf/gal${scaleNote}`,
          conf * 0.8,
          stage,
        ),
      );
      // Trim paint: baseboard + door casings at ~0.4 sf/lf average, 2 coats, 350 sf/gal.
      const trimGal = Math.max(1, Math.ceil((wallLf * 0.4 * 2) / 350));
      out.push(
        line(
          "FIN-PAINT-TRIM",
          trimGal,
          "derived",
          `${wallLf.toFixed(0)} lf of trim perimeter at ~0.4 sf/lf, 2 coats / 350 sf per gal`,
          0.45,
          stage,
        ),
      );
      // Baseboard: perimeter ≈ wall linear feet.
      out.push(
        line(
          "FIN-BASEBOARD",
          wallLf,
          "measured",
          `${wallLf.toFixed(0)} lf ≈ wall perimeter${scaleNote}`,
          conf * 0.8,
          stage,
        ),
      );
      // Casing: typically 1 tube per 50 lf of trim/casing caulk joint.
      const caulkTubes = Math.max(1, Math.ceil(wallLf / 50));
      out.push(
        line(
          "FIN-CAULK",
          caulkTubes,
          "derived",
          `${wallLf.toFixed(0)} lf of trim and casing perimeter / 50 lf per tube`,
          0.5,
          stage,
        ),
      );
      // LVP: floor area + 10% waste.
      const lvpSf = Math.ceil(floorFt2 * 1.1);
      out.push(
        line(
          "FIN-LVP",
          lvpSf,
          "measured",
          `${floorFt2.toFixed(0)} sf of floor + 10% waste${scaleNote}`,
          conf * 0.8,
          stage,
        ),
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
