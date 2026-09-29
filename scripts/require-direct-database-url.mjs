if (
  String(process.env.NODE_ENV ?? "").toLowerCase() === "production"
  && !String(process.env.DIRECT_DATABASE_URL ?? "").trim()
) {
  console.error("La tarea de migraciones en producción requiere DIRECT_DATABASE_URL.");
  process.exitCode = 1;
}
