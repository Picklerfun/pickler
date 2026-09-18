import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const gitRaw = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const git = (cwd, ...args) => gitRaw(cwd, ...args).trim();
export function classifyBranch(cwd, baseline, head) {
  const baseSha = git(cwd, 'rev-parse', '--verify', `${baseline}^{commit}`);
  const headSha = git(cwd, 'rev-parse', '--verify', `${head}^{commit}`);
  try {
    git(cwd, 'merge-base', '--is-ancestor', headSha, baseSha);
    return { status: 'integrated_ancestry', baseSha, headSha };
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const cherry = git(cwd, 'cherry', baseSha, headSha)
    .split('\n')
    .filter(Boolean);
  return {
    status:
      cherry.length && cherry.every((line) => line.startsWith('- '))
        ? 'patch_equivalent_review'
        : 'unknown_review',
    baseSha,
    headSha,
    commitsOutsideBaseline: Number(
      git(cwd, 'rev-list', '--count', `${baseSha}..${headSha}`),
    ),
    evidence:
      'Sin ancestría: equivalencia de parches o diferencias no prueban publicación ni autorizan borrar.',
  };
}
export function inventory(cwd, baseline = 'origin/main') {
  // Freeze refs before reading worktrees; report timestamps instead of claiming live remote state.
  const baseSha = git(cwd, 'rev-parse', '--verify', `${baseline}^{commit}`);
  const refs = git(
    cwd,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    'refs/heads',
    'refs/remotes',
  )
    .split('\n')
    .filter(Boolean);
  return {
    measuredAt: new Date().toISOString(),
    baseline,
    baseSha,
    remoteFreshness: 'local refs; no fetch performed',
    branches: refs
      .filter((line) => !line.startsWith('refs/remotes/origin/HEAD '))
      .map((line) => {
        const [ref, sha] = line.split(' ');
        return { ref, ...classifyBranch(cwd, baseSha, sha) };
      }),
    worktrees: git(cwd, 'worktree', 'list', '--porcelain', '-z')
      .split('\0\0')
      .filter(Boolean)
      .map((block) => {
        const fields = block.split('\0');
        const path = fields.find((f) => f.startsWith('worktree '))?.slice(9);
        if (!path) return { error: 'unrecognized worktree', fields };
        try {
          return {
            path,
            fields,
            changes: gitRaw(path, 'status', '--porcelain=v1', '-z')
              .split('\0')
              .filter(Boolean),
          };
        } catch {
          return {
            path,
            fields,
            error: 'worktree unavailable; inspect manually',
          };
        }
      }),
    stashes: git(cwd, 'stash', 'list', '--format=%gd %H %s')
      .split('\n')
      .filter(Boolean),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(inventory(process.cwd(), process.argv[2]), null, 2),
    );
  } catch (error) {
    console.error(
      `Inventory incomplete: ${error.message}. Specify an existing baseline; never interpret failure as no work.`,
    );
    process.exitCode = 1;
  }
}
