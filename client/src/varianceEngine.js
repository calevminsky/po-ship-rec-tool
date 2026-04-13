// src/varianceEngine.js
//
// Pure helpers for computing PO variance (overages / shortages) per size and
// per record, plus aggregations across many records. No DOM, no fetches —
// safe to unit test.
//
// Conventions:
//   shipDiff = ship - buy   (positive = overage, negative = shortage)
//   recDiff  = rec  - buy
//   *Dollars = diff * unitCost
//   *Pct     = diff / buy * 100   (signed; null when buy === 0)

export const VARIANCE_BUCKETS = ["exact", "0-5%", "5-10%", "10-20%", "20-30%", "30%+"];

/** Bucket label from an absolute % variance (number or null). */
export function varianceBucketLabel(absPct) {
  if (absPct == null) return "30%+"; // buy == 0 but had ship/rec → treat as max
  if (absPct === 0) return "exact";
  if (absPct < 5) return "0-5%";
  if (absPct < 10) return "5-10%";
  if (absPct < 20) return "10-20%";
  if (absPct < 30) return "20-30%";
  return "30%+";
}

/** Format a signed integer diff for display: "+3", "-2", "0". */
export function formatDiff(n) {
  const v = Number(n) || 0;
  if (v > 0) return `+${v}`;
  return String(v);
}

function pct(diff, base) {
  if (!base) return null;
  return (diff / base) * 100;
}

/**
 * Compute per-size and total variance for a single invoicing record.
 * Record shape: { buy: {XXS..XL}, ship: {...}, rec: {...}, unitCost }
 */
export function computeVariance(record, sizes) {
  const unitCost = Number(record?.unitCost ?? 0);
  const bySize = {};
  let buyT = 0, shipT = 0, recT = 0;

  for (const s of sizes) {
    const buy = Number(record?.buy?.[s] ?? 0);
    const ship = Number(record?.ship?.[s] ?? 0);
    const rec = Number(record?.rec?.[s] ?? 0);
    const shipDiff = ship - buy;
    const recDiff = rec - buy;
    bySize[s] = {
      buy, ship, rec,
      shipDiff, recDiff,
      shipDiffPct: pct(shipDiff, buy),
      recDiffPct: pct(recDiff, buy),
      shipDiffDollars: shipDiff * unitCost,
      recDiffDollars: recDiff * unitCost,
    };
    buyT += buy;
    shipT += ship;
    recT += rec;
  }

  const shipDiff = shipT - buyT;
  const recDiff = recT - buyT;
  const shipDiffPct = pct(shipDiff, buyT);
  const recDiffPct = pct(recDiff, buyT);
  const absShipDiffPct = shipDiffPct == null ? (shipDiff === 0 ? 0 : null) : Math.abs(shipDiffPct);
  const absRecDiffPct = recDiffPct == null ? (recDiff === 0 ? 0 : null) : Math.abs(recDiffPct);
  const absMaxPct = (() => {
    const a = absShipDiffPct, b = absRecDiffPct;
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
  })();

  return {
    bySize,
    totals: {
      buy: buyT, ship: shipT, rec: recT,
      shipDiff, recDiff,
      shipDiffDollars: shipDiff * unitCost,
      recDiffDollars: recDiff * unitCost,
      shipDiffPct, recDiffPct,
      absShipDiffPct, absRecDiffPct,
      absMaxPct,
      bucket: varianceBucketLabel(absMaxPct),
      isExact: shipDiff === 0 && recDiff === 0,
      isDiscrepant: shipDiff !== 0 || recDiff !== 0,
    },
  };
}

/**
 * Aggregate variance across many records.
 * Returns dashboard-ready totals plus byPo, bySize, byBucket breakdowns.
 */
export function aggregateVariance(records, sizes) {
  let totalShipOverageDollars = 0, totalShipShortageDollars = 0;
  let totalRecOverageDollars = 0, totalRecShortageDollars = 0;
  let shipOverageUnits = 0, shipShortageUnits = 0;
  let recOverageUnits = 0, recShortageUnits = 0;
  let buyTotal = 0, shipTotal = 0, recTotal = 0;
  let cleanCount = 0, discrepantCount = 0;
  let absShipPctSum = 0, absShipPctN = 0;
  let absRecPctSum = 0, absRecPctN = 0;

  const bySize = {};
  for (const s of sizes) {
    bySize[s] = {
      buy: 0, ship: 0, rec: 0,
      shipDiff: 0, recDiff: 0,
      shipDiffDollars: 0, recDiffDollars: 0,
      recordCount: 0,
      absShipPctSum: 0, absShipPctN: 0,
      absRecPctSum: 0, absRecPctN: 0,
    };
  }

  const byPo = {};
  const byBucket = Object.fromEntries(VARIANCE_BUCKETS.map((b) => [b, 0]));

  for (const rec of records) {
    const v = computeVariance(rec, sizes);
    const t = v.totals;

    buyTotal += t.buy;
    shipTotal += t.ship;
    recTotal += t.rec;

    if (t.shipDiff > 0) {
      totalShipOverageDollars += t.shipDiffDollars;
      shipOverageUnits += t.shipDiff;
    } else if (t.shipDiff < 0) {
      totalShipShortageDollars += -t.shipDiffDollars;
      shipShortageUnits += -t.shipDiff;
    }
    if (t.recDiff > 0) {
      totalRecOverageDollars += t.recDiffDollars;
      recOverageUnits += t.recDiff;
    } else if (t.recDiff < 0) {
      totalRecShortageDollars += -t.recDiffDollars;
      recShortageUnits += -t.recDiff;
    }

    if (t.isExact) cleanCount++; else discrepantCount++;

    if (t.absShipDiffPct != null) { absShipPctSum += t.absShipDiffPct; absShipPctN++; }
    if (t.absRecDiffPct != null) { absRecPctSum += t.absRecDiffPct; absRecPctN++; }

    byBucket[t.bucket] = (byBucket[t.bucket] || 0) + 1;

    // Per-size accumulation
    for (const s of sizes) {
      const cell = v.bySize[s];
      const agg = bySize[s];
      agg.buy += cell.buy;
      agg.ship += cell.ship;
      agg.rec += cell.rec;
      agg.shipDiff += cell.shipDiff;
      agg.recDiff += cell.recDiff;
      agg.shipDiffDollars += cell.shipDiffDollars;
      agg.recDiffDollars += cell.recDiffDollars;
      if (cell.buy || cell.ship || cell.rec) agg.recordCount++;
      if (cell.buy) {
        agg.absShipPctSum += Math.abs(cell.shipDiffPct);
        agg.absShipPctN++;
        agg.absRecPctSum += Math.abs(cell.recDiffPct);
        agg.absRecPctN++;
      }
    }

    // Per-PO accumulation
    const poKey = rec.po || "(No PO)";
    if (!byPo[poKey]) {
      byPo[poKey] = {
        po: poKey,
        vendor: rec.vendor || "",
        productCount: 0,
        buy: 0, ship: 0, rec: 0,
        shipDiff: 0, recDiff: 0,
        shipDiffDollars: 0, recDiffDollars: 0,
        absMaxPctList: [],
      };
    }
    const po = byPo[poKey];
    po.productCount++;
    po.buy += t.buy;
    po.ship += t.ship;
    po.rec += t.rec;
    po.shipDiff += t.shipDiff;
    po.recDiff += t.recDiff;
    po.shipDiffDollars += t.shipDiffDollars;
    po.recDiffDollars += t.recDiffDollars;
    if (t.absMaxPct != null) po.absMaxPctList.push(t.absMaxPct);
  }

  // Finalize byPo: compute aggregate % from rolled-up totals + max product %.
  const byPoArr = Object.values(byPo).map((p) => {
    const aggShipPct = p.buy ? (p.shipDiff / p.buy) * 100 : null;
    const aggRecPct = p.buy ? (p.recDiff / p.buy) * 100 : null;
    const maxProductPct = p.absMaxPctList.length ? Math.max(...p.absMaxPctList) : (aggShipPct == null && aggRecPct == null ? null : 0);
    const absMaxAggPct = (() => {
      const a = aggShipPct == null ? null : Math.abs(aggShipPct);
      const b = aggRecPct == null ? null : Math.abs(aggRecPct);
      const candidates = [a, b, maxProductPct].filter((x) => x != null);
      return candidates.length ? Math.max(...candidates) : null;
    })();
    return {
      po: p.po,
      vendor: p.vendor,
      productCount: p.productCount,
      buy: p.buy, ship: p.ship, rec: p.rec,
      shipDiff: p.shipDiff, recDiff: p.recDiff,
      shipDiffDollars: p.shipDiffDollars, recDiffDollars: p.recDiffDollars,
      shipDiffPct: aggShipPct,
      recDiffPct: aggRecPct,
      maxProductPct,
      absMaxPct: absMaxAggPct,
      bucket: varianceBucketLabel(absMaxAggPct),
    };
  });

  // Finalize bySize: compute averages.
  const bySizeArr = sizes.map((s) => {
    const a = bySize[s];
    return {
      size: s,
      buy: a.buy, ship: a.ship, rec: a.rec,
      shipDiff: a.shipDiff, recDiff: a.recDiff,
      shipDiffDollars: a.shipDiffDollars, recDiffDollars: a.recDiffDollars,
      avgAbsShipPct: a.absShipPctN ? a.absShipPctSum / a.absShipPctN : null,
      avgAbsRecPct: a.absRecPctN ? a.absRecPctSum / a.absRecPctN : null,
      recordCount: a.recordCount,
    };
  });

  return {
    recordCount: records.length,
    cleanRecordCount: cleanCount,
    discrepantRecordCount: discrepantCount,
    buyTotal, shipTotal, recTotal,
    shipOverageDollars: totalShipOverageDollars,
    shipShortageDollars: totalShipShortageDollars,
    recOverageDollars: totalRecOverageDollars,
    recShortageDollars: totalRecShortageDollars,
    shipOverageUnits, shipShortageUnits,
    recOverageUnits, recShortageUnits,
    netShipVarianceDollars: totalShipOverageDollars - totalShipShortageDollars,
    netRecVarianceDollars: totalRecOverageDollars - totalRecShortageDollars,
    avgAbsShipPct: absShipPctN ? absShipPctSum / absShipPctN : null,
    avgAbsRecPct: absRecPctN ? absRecPctSum / absRecPctN : null,
    bySize: bySizeArr,
    byPo: byPoArr,
    byBucket,
  };
}

/** Discrepancy filter predicate factory. */
export function makeDiscrepancyPredicate(mode, sizes) {
  if (!mode || mode === "all") return () => true;
  return (rec) => {
    const v = computeVariance(rec, sizes).totals;
    switch (mode) {
      case "any": return v.isDiscrepant;
      case "exact": return v.isExact;
      case "overage":
        return v.shipDiff > 0 || v.recDiff > 0;
      case "shortage":
        return v.shipDiff < 0 || v.recDiff < 0;
      case "gt5": return (v.absMaxPct ?? 0) > 5;
      case "gt10": return (v.absMaxPct ?? 0) > 10;
      case "gt20": return (v.absMaxPct ?? 0) > 20;
      case "exact-bucket": return v.bucket === "exact";
      case "0-5%":
      case "5-10%":
      case "10-20%":
      case "20-30%":
      case "30%+":
        return v.bucket === mode;
      default: return true;
    }
  };
}
