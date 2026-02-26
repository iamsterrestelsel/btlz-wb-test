import { google } from "googleapis";
import knex from "#postgres/knex.js";
import env from "../config/env/env.js";

/**
 * Fetch warehouses from Postgres and append them to a Google Sheet.
 * The function is intentionally idempotent and uses RAW append.
 */
export async function uploadData() {
  try {

    const todayDate = (new Date().toISOString().split("T")[0]).slice(0, 10);
    // 1. Fetch data from DB using the project's knex instance
    const data = await knex("warehouses").select(
      "warehouses.warehouse_name",
      "geo_name",
      "box_delivery_base",
      "box_delivery_coef_expr",
      "box_delivery_liter",
      "box_delivery_marketplace_base",
      "box_delivery_marketplace_coef_expr",
      "box_delivery_marketplace_liter",
      "box_storage_base",
      "box_storage_coef_expr",
      "box_storage_liter",
      "dt_next_box",
      "dt_till_max"
    )
    .join("wh_location", "warehouses.warehouse_name", "wh_location.warehouse_name")
    .join("wh_tariffs", "warehouses.warehouse_name", "wh_tariffs.warehouse_name")
    .whereRaw(`warehouses.date::date = '${todayDate}'`);

    if (!Array.isArray(data) || data.length === 0) {
      console.log("No warehouse data to upload");
      return { appended: 0 };
    }

    // Map rows to 2D array for Sheets API
    const header = [
      "warehouseName",
      "geoName",
      "boxDeliveryBase",
      "boxDeliveryCoefExpr",
      "boxDeliveryLiter",
      "boxDeliveryMarketplaceBase",
      "boxDeliveryMarketplaceCoefExpr",
      "boxDeliveryMarketplaceLiter",
      "boxStorageBase",
      "boxStorageCoefExpr",
      "boxStorageLiter",
      "dtNextBox",
      "dtTillMax",
    ];

    const dataRows = data.map((w: any) => [
      w.warehouse_name ?? "",
      w.geo_name ?? "",
      w.box_delivery_base != null ? String(w.box_delivery_base) : "-",
      w.box_delivery_coef_expr != null ? String(w.box_delivery_coef_expr) : "-",
      w.box_delivery_liter != null ? String(w.box_delivery_liter) : "-",
      w.box_delivery_marketplace_base != null ? String(w.box_delivery_marketplace_base) : "-",
      w.box_delivery_marketplace_coef_expr != null ? String(w.box_delivery_marketplace_coef_expr) : "-",
      w.box_delivery_marketplace_liter != null ? String(w.box_delivery_marketplace_liter) : "-",
      w.box_storage_base != null ? String(w.box_storage_base) : "-",
      w.box_storage_coef_expr != null ? String(w.box_storage_coef_expr) : "-",
      w.box_storage_liter != null ? String(w.box_storage_liter) : "-",
      w.dt_next_box != null ? String(w.dt_next_box) : "-",
      w.dt_till_max != null ? String(w.dt_till_max) : "-",
    ]);

  // Create a new sheet (tab) per run. Use a sanitized timestamped title.
  let sheetTitle = `WB Tariffs ${todayDate}`;
  // Google Sheets limits sheet title length; keep it safe
  if (sheetTitle.length > 90) sheetTitle = sheetTitle.slice(0, 90);
  const rows = [header, ...dataRows];

    // 2. Authorize and connect to Sheets
    const auth = new google.auth.GoogleAuth({
      keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  const client = await auth.getClient();
  // google.sheets typings can be strict for some auth client shapes — cast to any here
  const sheets = google.sheets({ version: "v4", auth: client as any });

    // 3. Create a new sheet (tab) with the generated title, then write data into A1 of that sheet.
    // Using batchUpdate to add the sheet, then values.update to write header+data.
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: env.SPREADSHEET_ID,
        requestBody: {
          requests: [
            { addSheet: { properties: { title: sheetTitle } } },
          ],
        },
      });
    } catch (e) {
      // If creation fails (rare), fallback by appending a random suffix and retry once
      const suffix = Math.random().toString(36).slice(2, 7);
      sheetTitle = `${sheetTitle.slice(0, 80)}-${suffix}`;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: env.SPREADSHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
      });
    }

    // Write values starting at A1 in the newly created sheet
    const res = await sheets.spreadsheets.values.update({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${sheetTitle}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    console.log(`Data uploaded successfully, appended ${rows.length} rows`);
    return { appended: rows.length, response: res.data };
  } catch (err) {
    console.error("uploadData failed:", err);
    throw err;
  }
}