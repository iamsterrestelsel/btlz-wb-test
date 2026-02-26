import env from "../config/env/env.js";
import { retry } from '@lifeomic/attempt';
import { z } from "zod";
import knex from "#postgres/knex.js";

const wareHouseListSchema = z.object({
    dtNextBox: z.string(),
    dtTillMax: z.string(),
    warehouseList: z.array(z.object({
        boxDeliveryBase: z.string(),
        boxDeliveryCoefExpr: z.string(),
        boxDeliveryLiter: z.string(),
        boxDeliveryMarketplaceBase: z.string(),
        boxDeliveryMarketplaceCoefExpr: z.string(),
        boxDeliveryMarketplaceLiter: z.string(),
        boxStorageBase: z.string(),
        boxStorageCoefExpr: z.string(),
        boxStorageLiter: z.string(),
        geoName: z.string(),
        warehouseName: z.string(),
    }))
});

const url = new URL("https://common-api.wildberries.ru/api/v1/tariffs/box");

type FetchInitWithTimeout = RequestInit & { timeout?: number };

export class wbTariffsService {
    private readonly defaultTimeout = 10000;

    constructor() {}

    public async fetchJson<T = unknown>(
        input: string | URL,
        init: FetchInitWithTimeout = {}
    ): Promise<T> {
        const timeout = init.timeout ?? this.defaultTimeout;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        // Merge headers (preserve any passed headers)
        const headers = new Headers(init.headers || {});
        if (env.WB_TOKEN) {
            // Prefer existing Authorization header; otherwise add Bearer token
            if (!headers.has("Authorization")) {
                headers.set("Authorization", `Bearer ${env.WB_TOKEN}`);
            }
        }

        try {
            const response = await retry(() => fetch(String(input), {
                ...init,
                signal: controller.signal,
                headers,
            }), { factor: 2 });

            if (!response.ok) {
                const text = await response.text().catch(() => "<no body>");
                throw new Error(`FetchError: ${response.status} ${response.statusText} - ${text}`);
            }

            const data = await response.json().catch(() => (null as unknown));
            return data as T;
        } catch (err: unknown) {
            const name = (err as any)?.name;
            if (name === "AbortError") {
                throw new Error(`Fetch timeout after ${timeout}ms`);
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    public async getTariffsBox(): Promise<WareHouseList> {
        const reqUrl = new URL(String(url));
        const today = new Date().toISOString().split("T")[0];
        reqUrl.searchParams.set("date", today);

        const json = await this.fetchJson(reqUrl, { timeout: 8000 });
        // The API sometimes wraps the payload as { response: { data: { ... } } }
        // Accept either the wrapped shape or the raw shape.
        const payload = (json && (json as any).response && (json as any).response.data) ? (json as any).response.data : json;

        const parsed = wareHouseListSchema.safeParse(payload);
        if (!parsed.success) {
            const rawPreview = (() => {
                try { return JSON.stringify(json); } catch { return String(json); }
            })();
            throw new Error(`WB tariffs response validation failed: ${JSON.stringify(parsed.error.format())} - requestUrl=${reqUrl.toString()} - raw=${rawPreview}`);
        }

        return parsed.data;
    }

    private toNumberOrNull(value: unknown) {
        if (value === null || value === undefined) return null;
        const raw = String(value).trim();
        const normalized = raw.replace(/\s+/g, "").replace(/,/g, ".");
        const n = Number(normalized);
        return Number.isFinite(n) ? n : null;
    }

    public async saveWarehouseList(data: WareHouseList) {
        const rowsTariffs = data.warehouseList.map((w) => ({
            dt_next_box: data.dtNextBox,
            dt_till_max: data.dtTillMax,
            warehouse_name: w.warehouseName,
        }));

        const rowsWarehouses = data.warehouseList.map((w) => ({
            warehouse_name: w.warehouseName,
            box_delivery_base: this.toNumberOrNull(w.boxDeliveryBase),
            box_delivery_coef_expr: this.toNumberOrNull(w.boxDeliveryCoefExpr),
            box_delivery_liter: this.toNumberOrNull(w.boxDeliveryLiter),
            box_delivery_marketplace_base: this.toNumberOrNull(w.boxDeliveryMarketplaceBase),
            box_delivery_marketplace_coef_expr: this.toNumberOrNull(w.boxDeliveryMarketplaceCoefExpr),
            box_delivery_marketplace_liter: this.toNumberOrNull(w.boxDeliveryMarketplaceLiter),
            box_storage_base: this.toNumberOrNull(w.boxStorageBase),
            box_storage_coef_expr: this.toNumberOrNull(w.boxStorageCoefExpr),
            box_storage_liter: this.toNumberOrNull(w.boxStorageLiter),
        }));

        const rowsLocation = data.warehouseList.map((w) => ({
            warehouse_name: w.warehouseName,
            geo_name: w.geoName,
        }));

        let tariffsInserted = 0;
        let warehousesUpdated = 0;
        let warehousesInserted = 0;

        const todayDate = (new Date().toISOString().split("T")[0]).slice(0, 10);

        await knex.transaction(async (trx) => {
            for (const t of rowsTariffs) {
                const updated = await trx("wh_tariffs")
                    .where({ warehouse_name: t.warehouse_name })
                    .andWhereRaw("date::date = ?", [todayDate])
                    .update({ dt_next_box: t.dt_next_box, dt_till_max: t.dt_till_max });

                if (updated === 0) {
                    const exists = await trx("wh_tariffs").where({ warehouse_name: t.warehouse_name }).first();
                    if (!exists) {
                        await trx("wh_tariffs").insert({ ...t, date: todayDate });
                        tariffsInserted += 1;
                    }
                } else {
                    warehousesUpdated += updated;
                }
            }

            for (const row of rowsWarehouses) {
                const updated = await trx("warehouses")
                    .where({ warehouse_name: row.warehouse_name })
                    .andWhereRaw("date::date = ?", [todayDate])
                    .update({ ...row });

                if (updated === 0) {
                    const exists = await trx("warehouses").where({ warehouse_name: row.warehouse_name }).first();
                    if (!exists) {
                        await trx("warehouses").insert({ ...row, date: todayDate });
                        warehousesInserted += 1;
                    }
                } else {
                    warehousesUpdated += updated;
                }
            }

            for (const row of rowsLocation) {
                const updated = await trx("wh_location")
                    .where({ warehouse_name: row.warehouse_name })
                    .update({ ...row });

                if (updated === 0) {
                    const exists = await trx("wh_location").where({ warehouse_name: row.warehouse_name }).first();
                    if (!exists) {
                        await trx("wh_location").insert({ ...row});
                        warehousesInserted += 1;
                    }
                } else {
                    warehousesUpdated += updated;
                }
            }
        });

        return { tariffsInserted, warehousesUpdated, warehousesInserted };
    }

    /** Fetch the tariffs box and persist the results into Postgres. */
    public async fetchAndSaveTariffsBox() {
        const data = await this.getTariffsBox();
        return this.saveWarehouseList(data);
    }
}

export type WareHouseList = z.infer<typeof wareHouseListSchema>;

