// Token Radar v2 — the entrypoint (Node 22, standard library only).
//
// Run it from the repository root:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// It reads the sealed snapshot, fits the log-space value model on the
// snapshot's tokenised protocols, ranks every eligible pre-token protocol by
// implied launch value, and writes the board, the dashboard's data file, the
// dashboard and the screenshots into the output directory. Last it writes
// dossier.json with the kit's make.fun library, which the scorer rebuilds
// byte for byte from the same output. The program is deterministic: two runs
// on the same snapshot write the same bytes, because nothing here reads the
// clock, the network or a random source.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output
// and --input names the snapshot file or the directory holding it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap, and the screenshot caps from the gate. */
const DOSSIER_TEXT_BYTES = 65_536;
const SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputPath = flag('input', '/input');
const snapshotFile = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  process.stderr.write(`token radar v2: no snapshot at ${snapshotFile} — pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) {
  process.stderr.write(`token radar v2: the board fails the gate: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `dest`, skipping dot-names. */
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const done: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dest, name));
    done.push(name);
  }
  return done;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (dashFiles.length === 0) {
  process.stderr.write('token radar v2: dashboard/ is empty: hand in the page, its CSS and its JS\n');
  process.exit(1);
}
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar v2: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar v2: screenshots/${name} is not a plain dossier name\n`);
    process.exit(1);
  }
}

// The dossier goes last: it is built from the output just written, so the
// scorer's rebuild from the same files matches it byte for byte.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_BYTES, screenshots: SCREENSHOTS, dashboard: DASHBOARD }),
);

const top = radar.rows[0]!;
process.stdout.write(
  `token radar v2: ${snapshot.protocols.length} protocols in the snapshot, ${radar.eligible_size} eligible, ${radar.watchlist_size} on the watchlist\n` +
    `token radar v2: model fitted on ${radar.calibration.trained_on} tokenised protocols (R^2 ${radar.calibration.r_squared.toFixed(3)}), board of ${board.length} rows\n` +
    `token radar v2: top row ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')} implied value\n` +
    `token radar v2: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shots.length} images), ${join(outDir, 'dossier.json')}\n`,
);
