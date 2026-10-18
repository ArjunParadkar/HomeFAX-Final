import assert from "node:assert/strict";
import { test } from "node:test";
import { addressKey, formatAddress, normalizeAddress, parseAddressLine, titleCase } from "../src/address";

test("titleCase keeps directionals, ordinals and single letters right", () => {
  assert.equal(titleCase("1200 nw 3RD st"), "1200 NW 3rd St");
  assert.equal(titleCase("310 se j st"), "310 SE J St");
  assert.equal(titleCase("905 SW WALTON BLVD"), "905 SW Walton Blvd");
  assert.equal(titleCase("bentonville"), "Bentonville");
});

test("parseAddressLine splits a one-line address, with and without a unit", () => {
  assert.deepEqual(parseAddressLine("1418 Ridgemont Dr, Bentonville, AR 72712"), { line1: "1418 Ridgemont Dr", line2: null, city: "Bentonville", state: "AR", postalCode: "72712" });
  assert.deepEqual(parseAddressLine("905 SW Walton Blvd Unit 3, Bentonville AR 72712-1234"), { line1: "905 SW Walton Blvd", line2: "Unit 3", city: "Bentonville", state: "AR", postalCode: "72712-1234" });
  assert.equal(parseAddressLine("1418 Ridgemont Dr"), null);
  assert.equal(parseAddressLine("1 Main St, Paris, ZZ 12345"), null);
});

test("normalizeAddress validates and the key ignores case and punctuation", () => {
  const a = normalizeAddress({ line1: "1418  ridgemont dr.", city: "BENTONVILLE", state: "ar", postalCode: "72712" });
  assert.equal(a.line1, "1418 Ridgemont Dr.");
  assert.equal(a.state, "AR");
  assert.equal(addressKey(a), addressKey({ line1: "1418 Ridgemont Dr", city: "Bentonville", state: "AR", postalCode: "72712" }));
  assert.throws(() => normalizeAddress({ line1: "x", city: "y", state: "Arkansas", postalCode: "72712" }), /two-letter/);
  assert.throws(() => normalizeAddress({ line1: "x", city: "y", state: "AR", postalCode: "7271" }), /ZIP/);
  assert.equal(formatAddress(a), "1418 Ridgemont Dr., Bentonville, AR 72712");
});
