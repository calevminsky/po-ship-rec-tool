// src/allocationEngine.js

const PACK_SEQUENCE_1_TO_15 = [
  "Cedarhurst",   // 1
  "Cedarhurst",   // 2
  "Bogota",       // 3
  "Bogota",       // 4
  "Toms River",   // 5
  "Teaneck Store",// 6
  "Cedarhurst",   // 7
  "Bogota",       // 8
  "Toms River",   // 9
  "Cedarhurst",   // 10
  "Warehouse",    // 11
  "Warehouse",    // 12
  "Bogota",       // 13
  "Cedarhurst",   // 14
  "Warehouse"     // 15
];

const CORE_SIZES = ["XS", "S", "M", "L"]; // XL + XXS optional-ish

function emptyMatrix(locations, sizes) {
  const m = {};
  for (const loc of locations) {
    m[loc] = {};
    for (const s of sizes) m[loc][s] = 0;
  }
  return m;
}

function countMissingCoreSizes(inv) {
  // “missing” means size has 0 available
  let missing = 0;
  for (const sz of CORE_SIZES) {
    if (Number(inv?.[sz] ?? 0) <= 0) missing += 1;
  }
  return missing;
}

function buildPackFromInventory(inv, productHasXXS) {
  // PACK TARGET:
  // XS:3, S:3, M:2, L:1, XL:1 (optional), XXS:1 (optional if product has XXS)
  // But per your new rule: partial packs ARE allowed.
  // So we take "up to" each target based on what's left in inv.

  const want = {
    XXS: productHasXXS ? 1 : 0,
    XS: 3,
    S: 3,
    M: 2,
    L: 1,
    XL: 1
  };

  const pack = {};
  for (const [sz, qty] of Object.entries(want)) {
    const have = Number(inv?.[sz] ?? 0);
    const take = Math.max(0, Math.min(have, qty));
    if (take > 0) pack[sz] = take;
  }

  return pack;
}

function subtractPack(inv, pack) {
  const next = { ...inv };
  for (const [sz, qty] of Object.entries(pack)) {
    next[sz] = Math.max(0, Number(next?.[sz] ?? 0) - Number(qty ?? 0));
  }
  return next;
}

function addToLoc(matrix, loc, pack) {
  const out = structuredClone(matrix);
  for (const [sz, qty] of Object.entries(pack)) {
    out[loc][sz] = Number(out?.[loc]?.[sz] ?? 0) + Number(qty ?? 0);
  }
  return out;
}

function sumPack(pack) {
  return Object.values(pack).reduce((a, v) => a + Number(v ?? 0), 0);
}

function perSizeTotalsFromMatrix(matrix, locations, sizes) {
  const t = {};
  for (const s of sizes) {
    t[s] = locations.reduce((a, loc) => a + Number(matrix?.[loc]?.[s] ?? 0), 0);
  }
  return t;
}

function capToShipTotals(built, locations, sizes, ship) {
  // Hard safety: never exceed shipped totals per size.
  // Remove from Warehouse first, then Teaneck, then Toms, then Bogota, then Cedarhurst, then Office.
  const removalOrder = ["Warehouse", "Teaneck Store", "Toms River", "Bogota", "Cedarhurst", "Office"].filter((l) =>
    locations.includes(l)
  );

  const out = structuredClone(built);

  for (const s of sizes) {
    const totalAllocated = locations.reduce((a, loc) => a + Number(out?.[loc]?.[s] ?? 0), 0);
    const cap = Number(ship?.[s] ?? 0);
    if (totalAllocated <= cap) continue;

    let excess = totalAllocated - cap;

    for (const loc of removalOrder) {
      if (excess <= 0) break;
      const have = Number(out?.[loc]?.[s] ?? 0);
      const take = Math.min(have, excess);
      if (take > 0) {
        out[loc][s] = have - take;
        excess -= take;
      }
    }
  }

  return out;
}

/**
 * Main engine
 * - avail = min(buy, ship)
 * - overage (ship-buy) -> Warehouse
 * - pack-sequence distribution, but partial packs allowed
 * - only skip pack if it's the FIRST pack for that loc and:
 *   - it has 0 S OR
 *   - it is missing 2+ core sizes (XS/S/M/L) entirely
 * - Office rule: on Bogota's FIRST successful pack, move 1 XS + 1 S from Bogota inventory to Office
 */
export function computeAllocation({ buy, ship, locations, sizes, ignoreTeaneck }) {
  const built0 = emptyMatrix(locations, sizes);

  // avail = min(buy, ship)
  const avail = {};
  for (const s of sizes) avail[s] = Math.min(Number(buy?.[s] ?? 0), Number(ship?.[s] ?? 0));

  // overage = ship - buy (only positive)
  const overage = {};
  for (const s of sizes) overage[s] = Math.max(0, Number(ship?.[s] ?? 0) - Number(buy?.[s] ?? 0));

  const productHasXXS = Number(buy?.XXS ?? 0) > 0 || Number(ship?.XXS ?? 0) > 0;

  let inv = { ...avail };
  let built = built0;

  const packsReceived = Object.fromEntries(locations.map((l) => [l, 0]));
  let officeGiven = false;

  for (let i = 0; i < PACK_SEQUENCE_1_TO_15.length; i++) {
    let loc = PACK_SEQUENCE_1_TO_15[i];

    // Ignore Teaneck => route to Warehouse
    if (ignoreTeaneck && loc === "Teaneck Store") loc = "Warehouse";
    if (!locations.includes(loc)) continue;

    // Build a (possibly partial) pack from current inventory
    const pack = buildPackFromInventory(inv, productHasXXS);

    // If nothing to send, stop allocating packs
    if (sumPack(pack) === 0) break;

    const isFirstPackForLoc = packsReceived[loc] === 0;

    // First-pack gating:
    // - must have at least 1 S
    // - must NOT be missing 2+ core sizes entirely
    if (isFirstPackForLoc) {
      const sCount = Number(pack?.S ?? 0);
      const missingCore = countMissingCoreSizes(inv); // based on inventory before taking
      if (sCount === 0 || missingCore >= 2) {
        // skip giving this location its first pack; try next slot in sequence
        // (do not consume inventory)
        continue;
      }
    }

    // ✅ Office rule: On Bogota’s FIRST SUCCESSFUL pack, move 1XS+1S FROM BOGOTA inventory to Office
    // This must happen BEFORE we "consume" pack inventory, because it's coming out of the same pool.
    if (
      !officeGiven &&
      loc === "Bogota" &&
      packsReceived["Bogota"] === 0 &&
      locations.includes("Office")
    ) {
      const hasXS = Number(inv?.XS ?? 0) >= 1;
      const hasS = Number(inv?.S ?? 0) >= 1;

      if (hasXS && hasS) {
        built = addToLoc(built, "Office", { XS: 1, S: 1 });
        inv = { ...inv, XS: inv.XS - 1, S: inv.S - 1 };
        officeGiven = true;
      }
    }

    // Now apply the pack to the location
    built = addToLoc(built, loc, pack);
    inv = subtractPack(inv, pack);

    packsReceived[loc] += 1;
  }

  // Remaining inv goes to Warehouse as loose units
  const sink = locations.includes("Warehouse") ? "Warehouse" : locations[0];
  for (const s of sizes) {
    built[sink][s] = Number(built?.[sink]?.[s] ?? 0) + Number(inv?.[s] ?? 0);
  }

  // Add ship overage to Warehouse
  for (const s of sizes) {
    built[sink][s] = Number(built?.[sink]?.[s] ?? 0) + Number(overage?.[s] ?? 0);
  }

  // Hard cap to ship totals per size
  built = capToShipTotals(built, locations, sizes, ship);

  const totals = perSizeTotalsFromMatrix(built, locations, sizes);

  return {
    allocation: built,
    totals
  };
}
