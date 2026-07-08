import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "../storage/db.js";
import { upsertPromotion } from "../storage/repo.js";
import { PromotionSchema } from "../domain/promo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || "data.sqlite";
const SEED_PATH = process.env.SEED_PATH || join(__dirname, "../../data/catalog.seed.json");

type SeedRow = {
  id: string;
  brand: string;
  cities: string[];
  type: string;
  title: string;
  description: string;
  period: string | null;
  placements: string[];
  department: string;
  sourceSheet: string;
  active: boolean;
};

/** Best-effort parse of the loose date/range strings found in the source spreadsheet. */
function parsePeriod(raw: string | null): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const s = raw.trim();

  // ISO-ish "2026-05-31" or "2026-05-31 00:00:00" -> treat as the period end date.
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return { start: null, end: iso[1] };

  // Ranges like "01.06.26-30.06.26" / "01.06.2026 -30.06.2026" / "с 01.07.26-31.07.2026"
  const range = s.match(/(\d{2})\.(\d{2})\.(\d{2,4})\s*-\s*(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (range) {
    const [, d1, m1, y1, d2, m2, y2] = range;
    const norm = (y: string) => (y.length === 2 ? `20${y}` : y);
    return {
      start: `${norm(y1)}-${m1}-${d1}`,
      end: `${norm(y2)}-${m2}-${d2}`,
    };
  }

  return { start: null, end: null };
}

function run() {
  const db = openDb(DB_PATH);
  const raw = readFileSync(SEED_PATH, "utf8");
  const rows = JSON.parse(raw) as SeedRow[];

  let sort = 0;
  let count = 0;
  for (const row of rows) {
    const { start, end } = parsePeriod(row.period);
    const promo = PromotionSchema.parse({
      id: row.id,
      brand: row.brand,
      cities: row.cities,
      type: row.type,
      title: row.title,
      description: row.description,
      periodStart: start,
      periodEnd: end,
      placements: row.placements,
      department: row.department,
      active: row.active,
      sort: sort++,
    });
    upsertPromotion(db, promo);
    count++;
  }

  console.log(`[seed] upserted ${count} promotions from ${SEED_PATH} into ${DB_PATH}`);
}

run();
