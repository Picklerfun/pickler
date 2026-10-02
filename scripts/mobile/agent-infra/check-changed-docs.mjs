import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
// Run from the repository root: the paths below are relative to it.
const base = process.env.DOCS_BASE_SHA;
let files;
if (base && !/^0+$/.test(base)) {
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    stdio: 'pipe',
  });
  files = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', '-z', base, 'HEAD'],
    { encoding: 'utf8' },
  ).split('\0');
} else {
  // Local working changes; explicit --all remains available for a historical migration.
  files = execFileSync(
    'git',
    ['ls-files', '--modified', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ).split('\0');
}
const docs = [
  ...new Set(
    files
      .filter((f) =>
        /^docs\/mobile\/superpowers\/(specs|plans)\/[^/]+\.(md|html)$/.test(f),
      )
      .map((f) => f.replace(/\.html$/, '.md'))
      .filter((f) => existsSync(f)),
  ),
];
if (docs.length)
  execFileSync(
    process.execPath,
    ['scripts/mobile/docs-md-to-html.mjs', '--check', ...docs],
    { stdio: 'inherit' },
  );
console.log(
  `Generated views verified: ${docs.length} changed documents. Historical existence/parity is checked by agents:check.`,
);
