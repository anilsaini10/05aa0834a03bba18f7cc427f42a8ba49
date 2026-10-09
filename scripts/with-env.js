// Runs a command with an env profile loaded, e.g.
//   node scripts/with-env.js .env.live prisma studio
//
// Values from the profile are set first; the app's own dotenv.config()
// and the Prisma CLI never override existing variables, so anything the
// profile doesn't define still falls back to .env.
const path      = require('path');
const { spawn } = require('child_process');
const dotenv    = require('dotenv');

const [envFile, command, ...args] = process.argv.slice(2);

if (!envFile || !command) {
  console.error('Usage: node scripts/with-env.js <env-file> <command> [args...]');
  process.exit(1);
}

const result = dotenv.config({ path: path.resolve(process.cwd(), envFile) });
if (result.error) {
  console.error(`❌ Env profile not found: ${envFile} (copy ${envFile}.example and fill it in)`);
  process.exit(1);
}

const dbHost = (process.env.DATABASE_URL ?? '').split('@')[1]?.split('/')[0] ?? 'unknown';
console.log(`🌐 Env profile: ${envFile}  →  DB: ${dbHost}`);

const child = spawn(command, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
