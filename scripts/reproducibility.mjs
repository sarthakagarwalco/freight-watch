import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = 3;
const runs = [];

for (let i = 0; i < N; i++) {
  const dir = mkdtempSync(join(tmpdir(), `ft-repro-${i}-`));
  execFileSync(process.execPath, [join(ROOT, 'src', 'run.mjs'), '--out', dir], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  runs.push({ i, csv: readFileSync(join(dir, 'freight_flags.csv'), 'utf8'), dir });
}

const hashes = {};
for (const r of runs) {
  hashes[r.i] = createHash('sha256').update(r.csv).digest('hex').slice(0, 12);
}

const allSame = runs.every((r) => r.csv === runs[0].csv);
const report = {
  runs: N,
  byte_identical: allSame,
  sha256_short: hashes,
};

mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
writeFileSync(join(ROOT, 'artifacts', 'reproducibility.json'), JSON.stringify(report, null, 2));

console.log(`Executed ${N} runs. Byte-identical: ${allSame}`, hashes);
for (const r of runs) rmSync(r.dir, { recursive: true, force: true });
process.exit(allSame ? 0 : 1);
