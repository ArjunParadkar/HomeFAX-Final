/**
 * A complete demo world — the same one `npm run db:seed` loads and the app
 * smoke tests log into. Deterministic: run it twice and you get the same
 * grades. Everything is labelled demo by its `.demo.homefax` email domain.
 */
import type { Finding, QualityReport, StageId, VisionVerdict } from "@homefax/core";
import { STAGES, buildQualityReport, evaluateCheckpoints, pollRecon, takeoffFromGeometry, visionCheckpointsForStage } from "@homefax/core";
import { withService } from "./client";
import * as auth from "./repos/auth";
import * as orgs from "./repos/orgs";
import * as properties from "./repos/properties";
import * as records from "./repos/records";
import * as access from "./repos/access";
import * as oversight from "./repos/oversight";

export const DEMO_PASSWORD = "homefax-demo-2026";

export const DEMO_PEOPLE = {
  arjun: { email: "arjun@demo.homefax", name: "Arjun Paradkar", handle: "arjun-demo", headline: "General contractor, Paradkar Builders" },
  crew: { email: "marco@demo.homefax", name: "Marco Reyes", handle: "marco-reyes", headline: "Framing crew lead" },
  rupali: { email: "rupali@demo.homefax", name: "Rupali Paradkar", handle: "rupali-demo", headline: null },
  owner2: { email: "dana@demo.homefax", name: "Dana Whitfield", handle: "dana-whitfield", headline: null },
  banker: { email: "bea@demo.homefax", name: "Bea Lindqvist", handle: "bea-lindqvist", headline: "Construction lending, First Ozark Bank" },
  underwriter: { email: "omar@demo.homefax", name: "Omar Haddad", handle: "omar-haddad", headline: "Underwriter, Ozark Mutual" },
  official: { email: "cal@demo.homefax", name: "Cal Nguyen", handle: "cal-nguyen", headline: "Building inspector, City of Bentonville" },
  agent: { email: "ava@demo.homefax", name: "Ava Okafor", handle: "ava-okafor", headline: "Agent, Ridgeline Realty" },
} as const;

type PersonKey = keyof typeof DEMO_PEOPLE;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const SEVERITY_BY_CATEGORY: Record<string, Finding["severity"]> = {
  structure: "major",
  safety: "critical",
  moisture: "major",
  envelope: "minor",
  mechanical: "minor",
  surfaces: "minor",
  capture: "info",
};

/** Deterministic vision verdicts for a stage, at a target pass rate. */
function verdictsFor(key: string, stage: StageId, passRate: number): { verdicts: VisionVerdict[]; findings: Finding[] } {
  const rand = mulberry32(hashStr(`${key}:${stage}`));
  const verdicts: VisionVerdict[] = [];
  const findings: Finding[] = [];
  for (const def of visionCheckpointsForStage(stage)) {
    const r = rand();
    const status = r < passRate ? "pass" : r < passRate + (1 - passRate) * 0.6 ? "attention" : "fail";
    const frame = Math.floor(rand() * 8);
    verdicts.push({ id: def.id, status, evidence: status === "pass" ? `${def.title} visible and to standard in frame ${frame}` : `${def.title}: ${status === "fail" ? "does not meet" : "borderline against"} the standard in frame ${frame}`, frameIndex: frame });
    if (status === "fail") {
      findings.push({
        id: `seed-${def.id}`,
        severity: SEVERITY_BY_CATEGORY[def.category] ?? "minor",
        title: def.title,
        detail: `Frame ${frame} shows ${def.title.toLowerCase()} below the standard (${def.standard}). ${def.longevity}.`,
        dimension: def.category === "safety" || def.category === "structure" ? "compliance" : "workmanship",
        source: "vision",
        keyframeIndex: frame,
      });
    }
  }
  return { verdicts, findings };
}

export type DemoHouse = {
  key: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  county: string;
  kind?: "single_family" | "multi_family" | "condo" | "townhome" | "commercial" | "other";
  yearBuilt?: number;
  stagesDone: number;
  inFlight?: boolean;
  passRate: number;
  owner?: PersonKey;
  ownerName?: string;
  daysAgo: number;
};

export const DEMO_HOUSES: DemoHouse[] = [
  { key: "ridgemont", line1: "1418 Ridgemont Dr", city: "Bentonville", state: "AR", postalCode: "72712", county: "Benton", yearBuilt: 2026, stagesDone: 7, passRate: 0.86, owner: "rupali", ownerName: "Rupali Paradkar", daysAgo: 120 },
  { key: "cedar", line1: "22 Cedar Ln", city: "Bentonville", state: "AR", postalCode: "72712", county: "Benton", yearBuilt: 2026, stagesDone: 3, passRate: 0.96, owner: "owner2", ownerName: "Dana Whitfield", daysAgo: 45 },
  { key: "maple", line1: "7 Maple Ct", city: "Bentonville", state: "AR", postalCode: "72713", county: "Benton", yearBuilt: 2025, stagesDone: 11, passRate: 0.9, owner: "rupali", ownerName: "Rupali Paradkar", daysAgo: 400 },
  { key: "walton", line1: "905 SW Walton Blvd", line2: "Unit 3", city: "Bentonville", state: "AR", postalCode: "72712", county: "Benton", kind: "townhome", yearBuilt: 2026, stagesDone: 2, passRate: 0.55, daysAgo: 30 },
  { key: "jstreet", line1: "310 SE J St", city: "Bentonville", state: "AR", postalCode: "72712", county: "Benton", yearBuilt: 2026, stagesDone: 1, inFlight: true, passRate: 0.8, daysAgo: 9 },
  { key: "third", line1: "1200 NW 3rd St", city: "Bentonville", state: "AR", postalCode: "72712", county: "Benton", yearBuilt: 2026, stagesDone: 0, passRate: 0.8, daysAgo: 3 },
  { key: "pinnacle", line1: "88 Pinnacle Hills Pkwy", city: "Rogers", state: "AR", postalCode: "72758", county: "Benton", kind: "commercial", yearBuilt: 2026, stagesDone: 4, passRate: 0.78, daysAgo: 80 },
];

export type DemoWorld = {
  people: Record<PersonKey, string>;
  orgs: { builders: string; bank: string; insurer: string; city: string; brokerage: string };
  houses: Record<string, { propertyId: string; slug: string; recordId: string; recordSlug: string }>;
  shareTokens: Record<string, string>;
  claimCodes: Record<string, string>;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

export async function seedWorld(opts: { frameBase?: string; log?: (s: string) => void } = {}): Promise<DemoWorld> {
  const log = opts.log ?? (() => {});
  const frameBase = opts.frameBase ?? "/demo";

  // People
  const people = {} as Record<PersonKey, string>;
  for (const [key, p] of Object.entries(DEMO_PEOPLE) as [PersonKey, (typeof DEMO_PEOPLE)[PersonKey]][]) {
    const existing = await withService((tx) => auth.getIdentityByEmail(tx, p.email));
    if (existing) {
      people[key] = existing.id;
      continue;
    }
    const r = await withService((tx) => auth.signUp(tx, { email: p.email, password: DEMO_PASSWORD, name: p.name, handle: p.handle, headline: p.headline ?? undefined, app: "contractor" }));
    people[key] = r.principal.identity.id;
  }
  log(`people: ${Object.keys(people).length}`);

  // Organisations
  const org = async (kind: orgs.PublicOrg["kind"], name: string, owner: PersonKey, headline: string, isPublic = true) => {
    const existing = await withService((tx) => orgs.getOrgBySlug(tx, name.toLowerCase().replace(/[^a-z0-9]+/g, "-")));
    if (existing) return existing.id;
    return (await withService((tx) => orgs.createOrg(tx, { kind, name, ownerIdentityId: people[owner], headline, isPublic }))).id;
  };
  const builders = await org("contractor", "Paradkar Builders", "arjun", "Custom homes and structural remodels, Northwest Arkansas");
  const bank = await org("lender", "First Ozark Bank", "banker", "Construction and residential lending", false);
  const insurer = await org("insurer", "Ozark Mutual", "underwriter", "Homeowners and builders-risk coverage", false);
  const city = await org("municipality", "City of Bentonville", "official", "Building Inspections Division", true);
  const brokerage = await org("brokerage", "Ridgeline Realty", "agent", "Residential brokerage, Benton County", true);
  await withService(async (tx) => {
    if (!(await orgs.getMembership(tx, builders, people.crew))) await orgs.addMember(tx, { orgId: builders, identityId: people.crew, role: "member", title: "Framing crew lead" });
    if ((await orgs.listJurisdictions(tx, city)).length === 0) await orgs.addJurisdiction(tx, { orgId: city, state: "AR", city: "Bentonville" });
  });
  log("orgs: 5");

  // Houses, records, captures
  const houses: DemoWorld["houses"] = {};
  const claimCodes: Record<string, string> = {};
  for (const h of DEMO_HOUSES) {
    const { property, created } = await withService((tx) => properties.findOrCreateProperty(tx, { ...h, line2: h.line2 ?? null, createdBy: people.arjun, kind: h.kind, yearBuilt: h.yearBuilt }));
    let record = (await withService((tx) => records.listRecordsForProperty(tx, property.id)))[0];
    if (!record) {
      record = await withService((tx) => records.createRecord(tx, { property, orgId: builders, orgName: "Paradkar Builders", ownerName: h.ownerName ?? null, createdBy: people.arjun }));
    }
    houses[h.key] = { propertyId: property.id, slug: property.slug, recordId: record.id, recordSlug: record.slug };
    if (!created) continue;

    for (let i = 0; i < Math.min(h.stagesDone, STAGES.length); i++) {
      const stage = STAGES[i].id;
      const filmedAt = daysAgo(h.daysAgo - i * Math.max(2, Math.floor(h.daysAgo / (h.stagesDone + 1))));
      const jobId = `demo-${filmedAt.getTime() - 3_600_000}-${stage}`;
      const frames = Array.from({ length: 9 }, (_, k) => `${frameBase}/kf0${k + 1}.png`);
      const cap = await withService((tx) => records.upsertCapture(tx, { record, stage, jobId, frames, filmedBy: i % 2 ? people.crew : people.arjun, filmedByOrgId: builders }));
      await withService((tx) => tx.update(records_captures()).set({ createdAt: filmedAt, updatedAt: filmedAt }).where(eq_(records_captures().id, cap.id)));
      const job = await pollRecon(jobId);
      if (job.state !== "done" || !job.result) throw new Error("simulated recon did not finish");
      const { verdicts, findings } = verdictsFor(h.key, stage, h.passRate);
      const ledger = evaluateCheckpoints(job.result, stage, verdicts);
      const quality: QualityReport = buildQualityReport(job.result, stage, findings, { status: "graded" }, ledger);
      const parts = takeoffFromGeometry(job.result, stage);
      await withService((tx) => records.finalizeCapture(tx, cap.id, { job, glbUrl: job.result!.glbUrl, quality, parts, notes: `Simulated demo reconstruction of ${STAGES[i].label.toLowerCase()}.` }));
    }
    if (h.inFlight) {
      const stage = STAGES[Math.min(h.stagesDone, STAGES.length - 1)].id;
      await withService((tx) => records.upsertCapture(tx, { record, stage, jobId: `demo-${Date.now()}-${stage}`, frames: [], filmedBy: people.arjun, filmedByOrgId: builders }));
    }
    if (h.owner) {
      await withService((tx) => tx.insert(propertyOwners_()).values({ id: newId_(), propertyId: property.id, identityId: people[h.owner!], role: "owner", claimedVia: "seed" }));
    } else {
      const { code } = await withService((tx) => properties.createOwnerInvite(tx, { propertyId: property.id, invitedBy: people.arjun }));
      claimCodes[h.key] = code;
    }
    log(`house ${h.key}: ${h.stagesDone} stages`);
  }

  // Access: the bank asked for Ridgemont, the owner approved; the insurer is waiting on Cedar.
  const shareTokens: Record<string, string> = {};
  await withService(async (tx) => {
    const ridge = houses.ridgemont.propertyId;
    if ((await access.listGrants(tx, ridge)).length === 0) {
      const req = await access.requestAccess(tx, { propertyId: ridge, requesterOrgId: bank, requesterIdentityId: people.banker, scope: "ledger", purpose: "Construction loan — verify stage draws against the filmed record", orgName: "First Ozark Bank" });
      await access.decideRequest(tx, req.id, "approved", people.rupali, { orgName: "First Ozark Bank" });
      await access.grantAccess(tx, { propertyId: ridge, granteeOrgId: insurer, scope: "ledger", purpose: "Builders-risk policy underwriting", grantedBy: people.rupali, granteeName: "Ozark Mutual" });
      await access.requestAccess(tx, { propertyId: houses.cedar.propertyId, requesterOrgId: insurer, requesterIdentityId: people.underwriter, scope: "ledger", purpose: "Homeowners policy quote for the new owner", orgName: "Ozark Mutual" });
      await access.grantAccess(tx, { propertyId: houses.maple.propertyId, granteeOrgId: brokerage, scope: "full", purpose: "Listing the home", grantedBy: people.rupali, granteeName: "Ridgeline Realty" });
      await access.grantAccess(tx, { propertyId: houses.pinnacle.propertyId, granteeOrgId: bank, scope: "ledger", purpose: "Commercial mortgage", grantedBy: people.arjun, granteeName: "First Ozark Bank" });
      const s = await access.createShareLink(tx, { propertyId: houses.maple.propertyId, scope: "ledger", label: "Buyer report — 7 Maple Ct", createdBy: people.agent, createdByOrgId: brokerage });
      shareTokens.maple = s.token;
      for (let i = 0; i < 4; i++) {
        await access.logAccess(tx, { propertyId: ridge, viewerIdentityId: people.banker, viewerOrgId: bank, via: "grant", scope: "ledger", app: "admin", path: `/properties/${houses.ridgemont.slug}` });
      }
      await access.logAccess(tx, { propertyId: ridge, viewerIdentityId: people.official, viewerOrgId: city, via: "jurisdiction", scope: "ledger", app: "admin", path: `/properties/${houses.ridgemont.slug}` });
    }
  });

  // Oversight
  await withService(async (tx) => {
    if ((await oversight.listHoldings(tx, bank)).length === 0) {
      const h = await oversight.createHolding(tx, { orgId: bank, propertyId: houses.ridgemont.propertyId, kind: "construction", loanRef: "CL-2026-0418", principalCents: 42_000_000, rateBps: 725, originatedAt: "2026-06-15", maturesAt: "2027-06-15", createdBy: people.banker });
      const d1 = await oversight.requestDraw(tx, { holdingId: h.id, propertyId: houses.ridgemont.propertyId, stage: "foundation", amountCents: 6_500_000, requestedBy: people.arjun });
      await oversight.decideDraw(tx, d1.id, "released", people.banker, "Foundation graded and verified by the city.", "First Ozark Bank");
      const d2 = await oversight.requestDraw(tx, { holdingId: h.id, propertyId: houses.ridgemont.propertyId, stage: "framing", amountCents: 8_200_000, requestedBy: people.arjun });
      await oversight.decideDraw(tx, d2.id, "released", people.banker, null, "First Ozark Bank");
      await oversight.requestDraw(tx, { holdingId: h.id, propertyId: houses.ridgemont.propertyId, stage: "rough_electrical", amountCents: 3_900_000, requestedBy: people.arjun });
      await oversight.requestDraw(tx, { holdingId: h.id, propertyId: houses.ridgemont.propertyId, stage: "insulation", amountCents: 2_400_000, requestedBy: people.arjun });
      await oversight.createHolding(tx, { orgId: bank, propertyId: houses.pinnacle.propertyId, kind: "commercial", loanRef: "CM-2026-0077", principalCents: 185_000_000, rateBps: 690, originatedAt: "2026-07-01", createdBy: people.banker });
    }
    if ((await oversight.listPolicies(tx, insurer)).length === 0) {
      await oversight.createPolicy(tx, { orgId: insurer, propertyId: houses.ridgemont.propertyId, kind: "builders_risk", policyRef: "BR-77120-A", coverageCents: 48_000_000, premiumCents: 310_000, effectiveFrom: "2026-06-15", effectiveTo: "2027-06-15", status: "bound", createdBy: people.underwriter, orgName: "Ozark Mutual" });
      await oversight.createPolicy(tx, { orgId: insurer, propertyId: houses.cedar.propertyId, kind: "homeowners", coverageCents: 39_000_000, effectiveFrom: "2026-11-01", effectiveTo: "2027-11-01", status: "quoted", createdBy: people.underwriter });
    }
    if ((await oversight.listPermits(tx, city)).length === 0) {
      const p = await oversight.createPermit(tx, { propertyId: houses.ridgemont.propertyId, municipalityOrgId: city, recordId: houses.ridgemont.recordId, permitNo: "BP-2026-01187", kind: "building", status: "issued", appliedAt: "2026-05-20", issuedAt: "2026-06-02", createdBy: people.official, orgName: "City of Bentonville" });
      await oversight.createPermit(tx, { propertyId: houses.ridgemont.propertyId, municipalityOrgId: city, recordId: houses.ridgemont.recordId, permitNo: "EP-2026-00431", kind: "electrical", status: "applied", appliedAt: "2026-09-28", createdBy: people.official });
      await oversight.createPermit(tx, { propertyId: houses.walton.propertyId, municipalityOrgId: city, recordId: houses.walton.recordId, permitNo: "BP-2026-01402", kind: "building", status: "issued", appliedAt: "2026-08-30", issuedAt: "2026-09-10", createdBy: people.official, orgName: "City of Bentonville" });
      await oversight.createPermit(tx, { propertyId: houses.maple.propertyId, municipalityOrgId: city, permitNo: "BP-2025-00912", kind: "building", status: "closed", appliedAt: "2025-08-01", issuedAt: "2025-08-14", closedAt: "2026-05-30", createdBy: people.official });
      const caps = await records.listCapturesForProperty(tx, houses.ridgemont.propertyId);
      for (const c of caps.filter((c) => c.state === "done" && ["site", "foundation", "framing", "rough_electrical"].includes(c.stage))) {
        await oversight.recordInspectionReview(tx, { captureId: c.id, propertyId: c.propertyId, municipalityOrgId: city, permitId: p.id, reviewerId: people.official, verdict: c.stage === "rough_electrical" ? "flagged" : "verified", notes: c.stage === "rough_electrical" ? "Box fill and bonding to be confirmed on site before cover." : null, orgName: "City of Bentonville", stage: c.stage });
      }
      const wcaps = await records.listCapturesForProperty(tx, houses.walton.propertyId);
      if (wcaps[0]) await oversight.recordInspectionReview(tx, { captureId: wcaps[0].id, propertyId: houses.walton.propertyId, municipalityOrgId: city, reviewerId: people.official, verdict: "site_visit", notes: "Footing depth could not be confirmed from the capture.", orgName: "City of Bentonville", stage: wcaps[0].stage });
      const mcaps = await records.listCapturesForProperty(tx, houses.maple.propertyId);
      for (const c of mcaps) await oversight.recordInspectionReview(tx, { captureId: c.id, propertyId: c.propertyId, municipalityOrgId: city, reviewerId: people.official, verdict: "verified", orgName: "City of Bentonville", stage: c.stage });
    }
    if ((await oversight.listListings(tx, brokerage)).length === 0) {
      const links = await access.listShareLinks(tx, houses.maple.propertyId);
      await oversight.createListing(tx, { orgId: brokerage, propertyId: houses.maple.propertyId, agentIdentityId: people.agent, listPriceCents: 48_500_000, status: "active", mlsRef: "NWA-1187234", listedAt: "2026-10-01", orgName: "Ridgeline Realty", actorId: people.agent });
      const l = (await oversight.listListings(tx, brokerage))[0];
      if (l && links[0]) await oversight.updateListing(tx, l.row.id, { shareLinkId: links[0].id });
    }
    // Assignments and a hire on the open job
    const asg = await records.listAssignmentsForRecord(tx, houses.ridgemont.recordId);
    if (asg.length === 0) {
      await records.createAssignment(tx, { recordId: houses.ridgemont.recordId, assigneeIdentityId: people.crew, task: "Film the insulation before drywall goes up", stage: "insulation", assignedBy: people.arjun });
      await records.createAssignment(tx, { recordId: houses.jstreet.recordId, assigneeIdentityId: people.crew, task: "Re-film the foundation walk — the north corner was cut off", stage: "foundation", assignedBy: people.arjun });
    }
  });

  return { people, orgs: { builders, bank, insurer, city, brokerage }, houses, shareTokens, claimCodes };
}

// Small indirections so the file reads top-down without hoisting import noise.
import { eq as eq_ } from "drizzle-orm";
import { captures as records_captures_t } from "./schema/build";
import { propertyOwners as propertyOwners_t } from "./schema/property";
import { newId as newId_ } from "./ids";
function records_captures() {
  return records_captures_t;
}
function propertyOwners_() {
  return propertyOwners_t;
}
