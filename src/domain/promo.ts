import { z } from "zod";

export const PromotionSchema = z.object({
  id: z.string().min(1),
  brand: z.string(),
  cities: z.array(z.string()),
  type: z.string(),
  title: z.string(),
  description: z.string().default(""),
  periodStart: z.string().nullable().default(null),
  periodEnd: z.string().nullable().default(null),
  placements: z.array(z.string()).default([]),
  department: z.string().default(""),
  active: z.boolean().default(true),
  sort: z.number().default(0),
});
export type Promotion = z.infer<typeof PromotionSchema>;

// One chosen promotion, as stored in the audit JSON snapshot on the entity.
export const SelectedPromoSchema = z.object({
  promoId: z.string(),
  brand: z.string(),
  city: z.string(),
  type: z.string(),
  title: z.string(),
  selectedAt: z.string(),
});
export type SelectedPromo = z.infer<typeof SelectedPromoSchema>;

export const SelectionSchema = z.array(SelectedPromoSchema);
export type Selection = z.infer<typeof SelectionSchema>;

export function parseSelectionJson(value: unknown): Selection {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = SelectionSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function selectionToJson(selection: Selection): string {
  return JSON.stringify(selection);
}

const CITY_ALL = "Все";

/** A promotion is available for a given city if it's tagged "Все" or explicitly lists that city. */
export function promoMatchesCity(promo: Promotion, city: string): boolean {
  if (!city) return true;
  if (promo.cities.includes(CITY_ALL)) return true;
  return promo.cities.includes(city);
}

export function promoIsActiveToday(promo: Promotion, todayIso: string): boolean {
  if (!promo.active) return false;
  if (promo.periodEnd && promo.periodEnd < todayIso) return false;
  if (promo.periodStart && promo.periodStart > todayIso) return false;
  return true;
}

/** Distinct city list across the catalog, "Все" excluded (it's not a pickable direction on its own). */
export function distinctCities(promotions: Promotion[]): string[] {
  const set = new Set<string>();
  for (const p of promotions) {
    for (const c of p.cities) {
      if (c !== CITY_ALL) set.add(c);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
}
