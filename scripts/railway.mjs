// One railway.json for both services: the role comes from SERVICE_ROLE,
// or from the Railway service name ("worker" in the name → worker, otherwise web).
//   node scripts/railway.mjs build | start
import { spawn } from "node:child_process";

const step = process.argv[2];
const role = (process.env.SERVICE_ROLE || (/worker/i.test(process.env.RAILWAY_SERVICE_NAME ?? "") ? "worker" : "web")).toLowerCase();

const commands = {
  build: { web: "next build", worker: "prisma generate" },
  start: { web: "next start", worker: "tsx src/worker/index.ts" },
};

const cmd = commands[step]?.[role];
if (!cmd) {
  console.error(`usage: railway.mjs build|start (role "${role}" unknown)`);
  process.exit(2);
}
console.log(`[railway] ${step} as ${role}: ${cmd}`);
const child = spawn(cmd, { stdio: "inherit", shell: true });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(signal ? 0 : (code ?? 1)));
