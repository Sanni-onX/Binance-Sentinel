import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const stateRoot =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  join(root, '.wrangler', 'railway-state');
const persistTo = join(stateRoot, 'wrangler-state');
const port = process.env.PORT || '3000';
const config = join(root, 'dist', 'server', 'wrangler.json');
const runtimeConfig = join(root, 'dist', 'server', 'wrangler.railway.json');
const serverDir = dirname(config);
const runtimeConfigName = 'wrangler.railway.json';

if (!existsSync(config)) {
  console.error('Missing dist/server/wrangler.json. Run npm run build first.');
  process.exit(1);
}

const wranglerConfig = JSON.parse(readFileSync(config, 'utf8'));
delete wranglerConfig.configPath;
delete wranglerConfig.userConfigPath;
delete wranglerConfig.dev;
wranglerConfig.main = 'index.js';
wranglerConfig.assets = { directory: '../client' };
wranglerConfig.compatibility_flags = Array.from(
  new Set(wranglerConfig.compatibility_flags || []),
);
const workerVarNames = [
  'APP_ORIGIN',
  'BINANCE_CLIENT_ID',
  'BINANCE_CLIENT_METADATA_URL',
  'ENABLE_LIVE_TRADING',
  'LLM_MODEL',
  'MAX_ORDER_USDT',
  'MODEL',
  'OPENAI_API_KEY',
  'OPENAI_API_MODEL',
  'OPENAI_KEY',
  'OPENAI_MODEL',
  'OPENAI_RESPONSES_MODEL',
  'TOKEN_ENCRYPTION_KEY',
];
wranglerConfig.vars = { ...wranglerConfig.vars };
for (const name of workerVarNames) {
  if (process.env[name]) wranglerConfig.vars[name] = process.env[name];
}
const d1ByName = new Map();
for (const binding of wranglerConfig.d1_databases || []) {
  const existing = d1ByName.get(binding.binding);
  const migrationsPath = binding.migrations_dir
    ? resolve(dirname(config), binding.migrations_dir)
    : '';
  const hasMigrations = migrationsPath && existsSync(migrationsPath);
  if (!existing || (hasMigrations && !existing.hasMigrations))
    d1ByName.set(binding.binding, { binding, hasMigrations });
}
wranglerConfig.d1_databases = Array.from(d1ByName.values()).map(
  ({ binding }) => binding,
);
writeFileSync(runtimeConfig, JSON.stringify(wranglerConfig, null, 2));

mkdirSync(persistTo, { recursive: true });
const env = {
  ...process.env,
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: join(root, '.wrangler', 'logs'),
};

const server = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    'index.js',
    '--config',
    runtimeConfigName,
    '--ip',
    '0.0.0.0',
    '--port',
    port,
    '--persist-to',
    persistTo,
    '--log-level',
    'info',
  ],
  { cwd: serverDir, stdio: 'inherit', env },
);

const shutdown = (signal) => {
  server.kill(signal);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});
