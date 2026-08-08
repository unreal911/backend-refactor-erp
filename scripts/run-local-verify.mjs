import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

const { Client } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL;

if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL es obligatorio para preparar la base de pruebas local.');
}

const testDatabaseUrl = new URL(baseDatabaseUrl);
const baseDatabaseName = decodeURIComponent(testDatabaseUrl.pathname.replace(/^\//, ''));
const testDatabaseName = `${baseDatabaseName}_test`;

if (!/^[a-zA-Z0-9_]+$/.test(testDatabaseName)) {
  throw new Error(`Nombre de base de pruebas local invalido: ${testDatabaseName}`);
}

testDatabaseUrl.pathname = `/${testDatabaseName}`;

function runNpm(args, env = process.env) {
  const npmCliPath = process.env.npm_execpath;
  const executable = npmCliPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const executableArgs = npmCliPath ? [npmCliPath, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runNpm(['run', 'local:infra']);

const adminDatabaseUrl = new URL(baseDatabaseUrl);
adminDatabaseUrl.pathname = '/postgres';
const adminClient = new Client({ connectionString: adminDatabaseUrl.toString() });

await adminClient.connect();
try {
  const existing = await adminClient.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [testDatabaseName],
  );
  if (existing.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE "${testDatabaseName}"`);
    console.log(`Base de pruebas local creada: ${testDatabaseName}`);
  }
} finally {
  await adminClient.end();
}

const testEnvironment = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl.toString(),
};

console.log(`Verificacion aislada en PostgreSQL: ${testDatabaseName}`);
runNpm(['run', 'db:migrate:deploy'], testEnvironment);
runNpm(['run', 'tenant:runtime-grants'], testEnvironment);
runNpm(['run', 'seed'], testEnvironment);
runNpm(['run', 'build'], testEnvironment);
runNpm(['test'], testEnvironment);
runNpm(['run', 'test:moto'], testEnvironment);
