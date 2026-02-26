import cron from "node-cron";
import env from "../config/env/env.js";
import { wbTariffsService } from "./wbTariffs.service.js";
import knex from "#postgres/knex.js";
import { uploadData } from "../google/spreadsheets.service.js";

const schedule = process.env.CRON_SCHEDULE ?? "0 */1 * * *"; // every hour by default
const enabled = String(process.env.CRON_ENABLED ?? "true") === "true";
const dailyUploadSchedule = process.env.DAILY_UPLOAD_SCHEDULE ?? "59 23 * * *"; // default: 23:59 daily

const wbTariffsSvc = new wbTariffsService();

async function tryAcquireLock(): Promise<boolean> {
    try {
        const res = await knex.raw("select pg_try_advisory_lock(hashtext('wbTraffic:tariffs')) as locked");
        const locked = (res?.rows?.[0]?.locked) ?? false;
        return !!locked;
    } catch (err) {
        console.error("Could not acquire advisory lock", err);
        return false;
    }
}

async function releaseLock() {
    try {
        await knex.raw("select pg_advisory_unlock(hashtext('wbTraffic:tariffs'))");
    } catch (err) {
        console.error("Could not release advisory lock", err);
    }
}

let isRunning = false;

async function runTask() {
    const start = Date.now();
    const now = new Date().toISOString();

    if (isRunning) {
        console.warn(`[wbTraffic.cron] ${now} - previous run still in progress, skipping this scheduled run`);
        return;
    }

    isRunning = true;
    console.log(`[wbTraffic.cron] ${now} - scheduled run start`);

    const locked = await tryAcquireLock();
    if (!locked) {
        console.log("Another worker holds the lock — skipping this run");
        isRunning = false;
        return;
    }

    try {
        const result = await wbTariffsSvc.fetchAndSaveTariffsBox();
        const duration = Date.now() - start;
        console.log(`[wbTraffic.cron] ${now} - run complete (duration=${duration}ms)`, result);

        // If DB changed, push updated data to Google Sheets
        try {
            const changed = (result?.warehousesUpdated ?? 0) + (result?.warehousesInserted ?? 0) + (result?.tariffsInserted ?? 0);
            if (changed > 0) {
                console.log(`[wbTraffic.cron] ${now} - detected ${changed} DB changes, uploading to Google Sheets`);
                await uploadData();
                console.log(`[wbTraffic.cron] ${now} - upload to Google Sheets complete`);
            } else {
                console.log(`[wbTraffic.cron] ${now} - no DB changes detected, skipping Sheets upload`);
            }
        } catch (err) {
            console.error(`[wbTraffic.cron] ${now} - uploadData failed`, err);
        }
    } catch (err) {
        console.error("[wbTraffic.cron] run failed", err);
    } finally {
        await releaseLock();
        isRunning = false;
    }
}

if (enabled) {
    console.log(`[wbTraffic.cron] Scheduling tariffs job: ${schedule}`);
    runTask().catch((e) => console.error("Startup run error", e));
    cron.schedule(schedule, () => {
        runTask().catch((e) => console.error("Scheduled run error", e));
    });
    // Schedule daily upload to Google Sheets at the configured time (default 23:59)
    console.log(`[wbTraffic.cron] Scheduling daily upload job: ${dailyUploadSchedule}`);
    cron.schedule(dailyUploadSchedule, async () => {
        const when = new Date().toISOString();
        console.log(`[wbTraffic.cron] ${when} - scheduled daily upload start`);
        try {
            await uploadData();
            console.log(`[wbTraffic.cron] ${when} - scheduled daily upload complete`);
        } catch (err) {
            console.error(`[wbTraffic.cron] ${when} - scheduled daily upload failed`, err);
        }
    });
} else {
    console.log("[wbTraffic.cron] CRON disabled (CRON_ENABLED=false)");
}
