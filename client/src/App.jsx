// FULL FILE CONTENT STARTS HERE

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPO,
  me,
  login,
  logout,
  getLocations,
  saveShip,
  saveAllocation,
  saveScan,
  shopifyByBarcode,
  shopifyByProductId,
  shopifySearchByTitle,
  linkShopifyProduct,
  closeoutPdf
} from "./api.js";

/* ============================= */
/* ========= CONSTANTS ========= */
/* ============================= */

const SIZES = ["XXS", "XS", "S", "M", "L", "XL"];

const DEFAULT_LOCATIONS = [
  "Bogota",
  "Cedarhurst",
  "Toms River",
  "Teaneck Store",
  "Office",
  "Warehouse"
];

const FILL_PRIORITY = [
  "Bogota",
  "Cedarhurst",
  "Toms River",
  "Teaneck Store",
  "Warehouse"
];

/* ============================= */
/* ====== ALLOC TEMPLATES ====== */
/* ============================= */

const ALLOC_TEMPLATES = {
  60: {
    Bogota: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    Cedarhurst: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Toms River": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  80: {
    Bogota: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    Cedarhurst: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  100: {
    Bogota: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Cedarhurst: { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  }
};

/* ============================= */
/* ===== HELPER FUNCTIONS ====== */
/* ============================= */

function clampInt(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function emptyMatrix(locations, sizes) {
  const m = {};
  for (const l of locations) {
    m[l] = {};
    for (const s of sizes) m[l][s] = 0;
  }
  return m;
}

function computeRatiosFromTemplate(template, size) {
  const ratios = {};
  let total = 0;
  for (const loc of Object.keys(template)) {
    const v = Number(template[loc]?.[size] ?? 0);
    total += v;
  }
  for (const loc of Object.keys(template)) {
    const v = Number(template[loc]?.[size] ?? 0);
    ratios[loc] = total > 0 ? v / total : 0;
  }
  return ratios;
}

function apportionInteger(total, ratios, priorityOrder) {
  const base = {};
  const frac = {};
  let used = 0;

  for (const loc of Object.keys(ratios)) {
    const raw = total * ratios[loc];
    base[loc] = Math.floor(raw);
    frac[loc] = raw - base[loc];
    used += base[loc];
  }

  let remaining = total - used;

  const ordered = Object.keys(ratios).sort((a, b) => {
    if (frac[b] !== frac[a]) return frac[b] - frac[a];
    return priorityOrder.indexOf(a) - priorityOrder.indexOf(b);
  });

  let i = 0;
  while (remaining > 0) {
    const loc = ordered[i % ordered.length];
    base[loc] += 1;
    remaining -= 1;
    i += 1;
  }

  return base;
}

/* ============================= */
/* ========== APP ============== */
/* ============================= */

export default function App() {
  const [mode, setMode] = useState(null);

  const [poInput, setPoInput] = useState("");
  const [poData, setPoData] = useState(null);
  const [selectedId, setSelectedId] = useState("");

  const [alloc, setAlloc] = useState(() =>
    emptyMatrix(DEFAULT_LOCATIONS, SIZES)
  );

  const [ignoreTeaneck, setIgnoreTeaneck] = useState(false);

  const sizes = SIZES;
  const locations = DEFAULT_LOCATIONS;

  const selected =
    poData?.records?.find((r) => r.id === selectedId) || null;

  const buyTotalsBySize = useMemo(() => {
    const t = {};
    for (const s of sizes) t[s] = Number(selected?.buy?.[s] ?? 0);
    return t;
  }, [selected]);

  const shipTotalsBySize = useMemo(() => {
    const t = {};
    for (const s of sizes) t[s] = Number(selected?.ship?.[s] ?? 0);
    return t;
  }, [selected]);

  /* ============================= */
  /* ======= AUTO ALLOCATE ======= */
  /* ============================= */

  function onAutoAllocate() {
    const ship = { ...shipTotalsBySize };
    const buy = { ...buyTotalsBySize };

    // BASE = min(buy, ship)
    const baseBySize = {};
    const extraBySize = {};

    for (const s of sizes) {
      const base = Math.min(ship[s], buy[s]);
      baseBySize[s] = base;
      extraBySize[s] = ship[s] - base > 0 ? ship[s] - base : 0;
    }

    const boughtTotal = sizes.reduce((a, s) => a + buy[s], 0);

    const templateKey =
      boughtTotal >= 100 ? 100 : boughtTotal >= 80 ? 80 : 60;

    const template = ALLOC_TEMPLATES[templateKey];

    let templateLocs = Object.keys(template).filter(
      (l) => l !== "Office"
    );

    if (ignoreTeaneck) {
      templateLocs = templateLocs.filter(
        (l) => l !== "Teaneck Store"
      );
    }

    const nextAlloc = emptyMatrix(locations, sizes);

    // Office XS rule
    if (baseBySize.XS >= 1) {
      nextAlloc["Office"]["XS"] = 1;
      baseBySize.XS -= 1;
    }

    for (const size of sizes) {
      const qty = baseBySize[size];
      if (!qty) continue;

      const ratioSize = size === "XXS" ? "XS" : size;
      const ratiosAll = computeRatiosFromTemplate(
        template,
        ratioSize
      );

      const ratios = {};
      let sum = 0;

      for (const loc of templateLocs) {
        ratios[loc] = ratiosAll[loc] ?? 0;
        sum += ratios[loc];
      }

      for (const loc of templateLocs) {
        ratios[loc] = sum > 0 ? ratios[loc] / sum : 0;
      }

      const apportioned = apportionInteger(
        qty,
        ratios,
        FILL_PRIORITY
      );

      for (const loc of templateLocs) {
        nextAlloc[loc][size] += apportioned[loc] ?? 0;
      }
    }

    // EXTRA shipped → Warehouse
    for (const s of sizes) {
      if (extraBySize[s] > 0) {
        nextAlloc["Warehouse"][s] += extraBySize[s];
      }
    }

    // HARD ZERO Teaneck if ignored
    if (ignoreTeaneck) {
      for (const s of sizes) {
        nextAlloc["Teaneck Store"][s] = 0;
      }
    }

    setAlloc(nextAlloc);
  }

  /* ============================= */
  /* ============ UI ============ */
  /* ============================= */

  return (
    <div style={{ padding: 40 }}>
      <h2>Allocation</h2>

      <button onClick={onAutoAllocate}>
        Auto Allocate
      </button>

      <label style={{ marginLeft: 20 }}>
        <input
          type="checkbox"
          checked={ignoreTeaneck}
          onChange={(e) =>
            setIgnoreTeaneck(e.target.checked)
          }
        />
        Ignore Teaneck ({ignoreTeaneck ? "ON" : "OFF"})
      </label>

      <pre style={{ marginTop: 30 }}>
        {JSON.stringify(alloc, null, 2)}
      </pre>
    </div>
  );
}
