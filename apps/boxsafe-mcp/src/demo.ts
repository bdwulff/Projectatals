import { BoxSafeReadService, buildDependencies } from "./service.js";

// Stable, explicitly fictional example: all same-day fixtures fall inside Melbourne's local day.
const service = new BoxSafeReadService(buildDependencies({ ATLAS_MODE: "fake" }, () => new Date("2026-10-26T12:00:00.000Z")));
const result = await service.call("get_daily_briefing", { range: "today" });
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
