import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = String(process.env.MIG012_DATABASE_URL || "").trim();
const backupId = String(process.env.MIG012_BACKUP_ID || "").trim();
const confirmation = String(process.env.MIG012_CONFIRM || "").trim();
const injection = String(process.env.MIG012_FAIL_AFTER || "").trim();
const rerunRequested = String(process.env.MIG012_RERUN_STEPS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const runId = String(process.env.MIG012_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-")).replace(/[^A-Za-z0-9._-]/g, "-");
const reportDirectory = path.join(root, "reports", "mig-012");
const stateFile = process.env.MIG012_STATE_FILE
  ? path.resolve(process.env.MIG012_STATE_FILE)
  : path.join(reportDirectory, `${runId}.json`);

if (!targetUrl || backupId.length < 8 || confirmation !== "RESTORED_TARGET_ONLY") {
  console.error("Exige MIG012_DATABASE_URL, MIG012_BACKUP_ID y MIG012_CONFIRM=RESTORED_TARGET_ONLY");
  process.exit(2);
}
let target;
try { target = new URL(targetUrl); } catch { console.error("MIG012_DATABASE_URL no es válida"); process.exit(2); }
const databaseName = target.pathname.replace(/^\//, "");
if (!/(rehearsal|restore|staging|ensayo)/i.test(databaseName)) {
  console.error("La base destino debe contener rehearsal, restore, staging o ensayo en su nombre");
  process.exit(2);
}
if (process.env.DATABASE_URL === targetUrl && !process.env.MIG012_ALLOW_CURRENT_DATABASE) {
  console.error("El ensayo no puede apuntar a la DATABASE_URL activa");
  process.exit(2);
}

fs.mkdirSync(reportDirectory, { recursive: true });
const targetFingerprint = createHash("sha256").update(`${target.hostname}/${databaseName}`).digest("hex").slice(0, 16);
const initial = {
  story: "MIG-012",
  runId,
  backupId,
  targetFingerprint,
  databaseName,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  steps: {},
  injections: [],
  result: "RUNNING",
};
const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
  : initial;
if (state.backupId !== backupId || state.targetFingerprint !== targetFingerprint) {
  console.error("El checkpoint pertenece a otro backup o destino");
  process.exit(2);
}

function persist() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("No se pudo localizar npm_execpath; ejecuta mediante npm run migration:rehearsal");
  process.exit(2);
}
const steps = [
  ["inventory", ["run", "migration:inventory"]],
  ["migrations", ["run", "db:migrate:deploy"]],
  ["runtime_grants", ["run", "tenant:runtime-grants"]],
  ["formal_verify", ["run", "migration:verify"]],
  ["identity", ["run", "migration:identity:reconcile"]],
  ["catalog", ["run", "migration:catalog:reconcile"]],
  ["inventory_backfill", ["run", "migration:inventory:reconcile"]],
  ["movements", ["run", "migration:movements:reconcile"]],
  ["orders", ["run", "migration:orders:reconcile"]],
  ["returns", ["run", "migration:returns:reconcile"]],
  ["marketplace", ["run", "migration:marketplace:reconcile"]],
  ["audit", ["run", "migration:audit:reconcile"]],
  ["backfill_close", ["run", "migration:backfill:close"]],
  ["sunat_reconcile", ["run", "tenant:sunat:reconcile"]],
  ["sunat_artifacts", ["run", "sunat:artifacts:migrate-all"]],
  ["sunat_secrets", ["run", "sunat:secrets:migrate-v2"]],
  ["rls", ["run", "tenant:rls:verify"]],
  ["prisma_scope", ["run", "tenant:prisma:verify"]],
  ["tenant_isolation", ["run", "tenant:isolation:test"]],
  ["functional_suite", ["test"]],
  ["build", ["run", "build"]],
];

if (rerunRequested.length > 0) {
  const knownSteps = new Set(steps.map(([name]) => name));
  const unknown = rerunRequested.filter((name) => !knownSteps.has(name));
  if (unknown.length > 0) {
    console.error(`MIG012_RERUN_STEPS contiene pasos desconocidos: ${unknown.join(", ")}`);
    process.exit(2);
  }
  state.reruns ??= [];
  for (const name of new Set(rerunRequested)) {
    delete state.steps[name];
    state.reruns.push({ name, requestedAt: new Date().toISOString() });
  }
  delete state.finishedAt;
  delete state.durationMs;
  state.result = "RUNNING";
  persist();
}

for (const [name, args] of steps) {
  if (state.steps[name]?.status !== "PASSED") {
    const started = Date.now();
    const result = spawnSync(process.execPath, [npmCli, ...args], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: targetUrl,
        DIRECT_DATABASE_URL: targetUrl,
        NODE_ENV: "test",
      },
      encoding: "utf8",
      timeout: 20 * 60 * 1000,
    });
    state.steps[name] = {
      status: result.status === 0 ? "PASSED" : "FAILED",
      durationMs: Date.now() - started,
      exitCode: result.status,
      stdoutTail: String(result.stdout || "").slice(-4000),
      stderrTail: String(result.stderr || "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_CONNECTION]").slice(-4000),
      error: result.error?.message,
    };
    persist();
    if (result.status !== 0) {
      state.result = "NO-GO";
      persist();
      console.error(`MIG-012 falló en ${name}. Reanuda con el mismo MIG012_STATE_FILE.`);
      process.exit(result.status || 1);
    }
  }
  if (injection === name && !state.injections.includes(name)) {
    state.injections.push(name);
    state.result = "INJECTED_FAILURE";
    persist();
    console.error(`Fallo controlado inyectado después de ${name}; checkpoint persistido.`);
    process.exit(86);
  }
}

state.finishedAt = new Date().toISOString();
state.wallClockDurationMs = new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime();
state.durationMs = Object.values(state.steps).reduce(
  (total, step) => total + (Number(step.durationMs) || 0),
  0,
);
state.result = state.injections.length >= 3 ? "READY_FOR_GO_NO_GO" : "NO-GO_MISSING_FAILURE_INJECTIONS";
persist();
console.log(JSON.stringify({ stateFile, result: state.result, durationMs: state.durationMs, injections: state.injections }));
