// @ts-check
/** Build-time Git history for a single Markdown/MDX source file. */
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import migrationManifest from './post-history-migration.json' with { type: 'json' };

/** @typedef {{status: string, old_path: string, path: string}} FileRecord */
/** @typedef {{sha: string, files: FileRecord[]}} HistoryRecord */
/** @typedef {{parents: string[], date: string, message: string, subject: string}} CommitMetadata */
/**
 * @typedef {Object} PostChange
 * @property {string} status
 * @property {string} old_path
 * @property {string} path
 * @property {number | null} additions
 * @property {number | null} deletions
 * @property {string} patch
 * @property {string | null} parent
 */
/**
 * @typedef {Object} PostCommit
 * @property {string} sha
 * @property {string} short_sha
 * @property {string} date
 * @property {string} subject
 * @property {string} message
 * @property {string} url
 * @property {boolean} is_merge
 * @property {PostChange[]} changes
 */
/** @typedef {{ref: string, paths: Record<string, string>}} MigrationManifest */
/** @typedef {{repository?: string, migration?: MigrationManifest | null}} HistoryOptions */

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const STATUS = /^[ACDMRTUXB][0-9]*$/;
const decoder = new TextDecoder('utf-8', { fatal: true });
const diffOptions = [
  '--no-ext-diff', '--no-textconv', '--no-color',
  '--src-prefix=a/', '--dst-prefix=b/',
];

/** @param {string} root @param {...string} args @returns {Buffer} */
function git(root, ...args) {
  try {
    return execFileSync('git', [
      '--no-pager', '--literal-pathspecs', '-c', 'core.quotePath=true', ...args,
    ], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const failure = /** @type {{stderr?: Buffer, message?: string}} */ (error);
    throw new Error(`Git history: ${failure.stderr?.toString('utf8').trim() || failure.message || 'Git command failed.'}`);
  }
}

/** @param {Buffer} raw @returns {Buffer[]} */
function nulFields(raw) {
  const fields = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === 0) {
      fields.push(raw.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < raw.length) fields.push(raw.subarray(start));
  return fields;
}

/** @param {Buffer} raw @returns {string} */
function gitPath(raw) {
  try {
    // Node's subprocess arguments are strings. Reject undecodable paths instead
    // of replacing bytes and accidentally querying a different file.
    return decoder.decode(raw);
  } catch {
    throw new Error('Git history requires UTF-8 source filenames.');
  }
}

/** Parse only structural fields as text; filenames are consumed explicitly.
 * @param {Buffer} raw @returns {HistoryRecord[]}
 */
export function parseHistory(raw) {
  const fields = nulFields(raw);
  /** @type {HistoryRecord[]} */
  const records = [];
  /** @type {HistoryRecord | undefined} */
  let current;
  for (let index = 0; index < fields.length;) {
    const field = fields[index++].toString('ascii').replace(/^\n+/, '');
    if (!field) continue;
    if (SHA.test(field)) {
      current = { sha: field, files: [] };
      records.push(current);
      continue;
    }
    if (!current || !STATUS.test(field)) throw new Error('Unexpected Git history record.');
    const count = /^[RC]/.test(field) ? 2 : 1;
    const paths = fields.slice(index, index + count);
    if (paths.length !== count || paths.some((path) => path.length === 0)) {
      throw new Error('Incomplete Git history path record.');
    }
    index += count;
    current.files.push({ status: field, old_path: gitPath(paths[0]), path: gitPath(paths.at(-1) ?? paths[0]) });
  }
  return records;
}

/** @param {string} root @param {string} path @param {string} ref @returns {HistoryRecord[]} */
function historyRecords(root, path, ref) {
  return parseHistory(git(root, 'log', '--follow', '--find-renames', '--topo-order',
    '--diff-merges=first-parent', '--no-show-signature', '--no-notes', '--no-color',
    '--no-ext-diff', '--no-textconv', '--format=%H', '--name-status', '-z', ref, '--', path));
}

/** @param {string} root @param {string} sha @returns {CommitMetadata} */
function metadata(root, sha) {
  const raw = git(root, 'show', '-s', '--no-show-signature', '--no-notes',
    '--encoding=UTF-8', '--format=%P%x00%cI%x00%B', sha);
  const first = raw.indexOf(0);
  const second = raw.indexOf(0, first + 1);
  if (first < 0 || second < 0) throw new Error('Unexpected Git commit metadata.');
  const message = raw.subarray(second + 1).toString('utf8').replace(/\n$/, '');
  return {
    parents: raw.subarray(0, first).toString('ascii').trim().split(' ').filter(Boolean),
    date: raw.subarray(first + 1, second).toString('ascii'),
    message,
    subject: message.split('\n\n', 1)[0].split('\n').join(' ').trim() || '(No commit message)',
  };
}

/** @param {Buffer} raw @returns {[number | null, number | null]} */
function lineCounts(raw) {
  if (!raw.length) return [0, 0];
  // Blob comparisons can use numstat's two-path form. Only the first two tab
  // fields contain counts; paths themselves may contain tabs or newlines.
  const first = raw.indexOf(9);
  const second = raw.indexOf(9, first + 1);
  if (first < 0 || second < 0) throw new Error('Unexpected Git line-count record.');
  const values = [raw.subarray(0, first), raw.subarray(first + 1, second)].map((field) => {
    const value = field.toString('ascii');
    if (value === '-') return null;
    if (!/^\d+$/.test(value)) throw new Error('Unexpected Git line count.');
    return Number(value);
  });
  return [values[0], values[1]];
}

/** @param {string} path */
function patchLabel(path) {
  return /[\s"\\\x00-\x1f\x7f]/.test(path) ? JSON.stringify(path) : path;
}

/** @param {string} patch @param {string} oldBlob @param {string} newBlob
 * @param {string} oldPath @param {string} newPath @returns {string} */
function relabelPatch(patch, oldBlob, newBlob, oldPath, newPath) {
  const oldLabel = patchLabel(`a/${oldPath}`);
  const newLabel = patchLabel(`b/${newPath}`);
  const replacements = new Map([
    [`diff --git a/${oldBlob} b/${newBlob}`, `diff --git ${oldLabel} ${newLabel}`],
    [`--- a/${oldBlob}`, `--- ${oldLabel}`],
    [`+++ b/${newBlob}`, `+++ ${newLabel}`],
    [`Binary files a/${oldBlob} and b/${newBlob} differ`, `Binary files ${oldLabel} and ${newLabel} differ`],
  ]);
  let inHeader = true;
  return patch.split('\n').map((line) => {
    if (line.startsWith('@@')) inHeader = false;
    return inHeader ? replacements.get(line) ?? line : line;
  }).join('\n');
}

/** @param {string} root @param {string} sha @param {string | null} parent
 * @param {FileRecord} record @returns {PostChange} */
function fileChange(root, sha, parent, record) {
  /** @type {Buffer} */
  let counts;
  /** @type {string} */
  let patch;
  if (/^[RC]/.test(record.status)) {
    if (!parent) throw new Error('A Git rename/copy must have a parent commit.');
    // A diff filtered to both filenames can also contain an unrelated file
    // recreated at the old path. Compare exactly these two post blobs instead.
    const oldBlob = git(root, 'rev-parse', '--verify', `${parent}:${record.old_path}`).toString('ascii').trim();
    const newBlob = git(root, 'rev-parse', '--verify', `${sha}:${record.path}`).toString('ascii').trim();
    const command = ['diff', oldBlob, newBlob, ...diffOptions];
    counts = git(root, ...command, '--numstat', '-z', '--');
    patch = relabelPatch(git(root, ...command, '--patch', '--').toString('utf8'),
      oldBlob, newBlob, record.old_path, record.path);
  } else {
    const command = parent ? ['diff', parent, sha]
      : ['diff-tree', '--root', '--no-commit-id', '-r', sha];
    command.push(...diffOptions, '--no-renames');
    counts = git(root, ...command, '--numstat', '-z', '--', record.path);
    patch = git(root, ...command, '--patch', '--', record.path).toString('utf8');
  }
  const [additions, deletions] = lineCounts(counts);
  return { ...record, additions, deletions, patch, parent: parent?.slice(0, 12) ?? null };
}

/** @param {string} root @param {string} sourcePath @returns {string} */
function repositoryPath(root, sourcePath) {
  const path = relative(root, resolve(root, sourcePath));
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('Post history source must be a file inside the repository.');
  }
  return path.split(sep).join('/');
}

/**
 * Read one post's history during Astro's static build. Source paths may be
 * absolute or repository-relative. Tests/other sites can disable the migration
 * bridge with `migration: null`, or inject their own immutable {ref, paths} map.
 * @param {string} root
 * @param {string} sourcePath
 * @param {HistoryOptions} [options]
 * @returns {PostCommit[]}
 */
export function getPostHistory(root, sourcePath, options = {}) {
  root = resolve(root);
  const path = repositoryPath(root, sourcePath);
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY ?? 'marcus1337/marcus1337.github.io';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('History repository must be a GitHub owner/repository name.');
  }
  if (git(root, 'rev-parse', '--is-shallow-repository').toString('ascii').trim() === 'true') {
    throw new Error('Full Git history is required: use fetch-depth: 0 in Actions or git fetch --unshallow locally.');
  }
  const current = historyRecords(root, path, 'HEAD');
  const records = new Map(current.filter((record) => record.files.length).map((record) => [record.sha, record]));
  const migration = options.migration === undefined ? migrationManifest : options.migration;
  if (migration) {
    const lineage = new Set([path, ...current.flatMap((record) => record.files.flatMap((file) => [file.path, file.old_path]))]);
    const sources = Object.entries(migration.paths).filter(([currentPath]) => lineage.has(currentPath));
    if (sources.length > 1) throw new Error('Post history has ambiguous migration sources.');
    if (sources.length === 1) {
      if (!SHA.test(migration.ref)) throw new Error('History migration ref must be an immutable full commit SHA.');
      git(root, 'merge-base', '--is-ancestor', migration.ref, 'HEAD');
      const legacyPath = repositoryPath(root, sources[0][1]);
      git(root, 'cat-file', '-e', `${migration.ref}:${legacyPath}`);
      for (const record of historyRecords(root, legacyPath, migration.ref)) {
        if (record.files.length && !records.has(record.sha)) records.set(record.sha, record);
      }
    }
  }
  // Re-order the union with Git, rather than trusting commit dates or appending
  // missing ancestors after an already followed portion of the old history.
  const ordered = nulFields(git(root, 'log', '--topo-order', '--no-show-signature',
    '--no-notes', '--no-color', '--format=%H', '-z', 'HEAD'))
    .map((field) => field.toString('ascii')).filter((sha) => records.has(sha));
  return ordered.map((sha) => {
    const record = records.get(sha);
    if (!record) throw new Error('Missing Git history record.');
    const meta = metadata(root, sha);
    const parent = meta.parents[0] ?? null;
    return {
      sha, short_sha: sha.slice(0, 12), date: meta.date, subject: meta.subject,
      message: meta.message, url: `https://github.com/${repository}/commit/${sha}`,
      is_merge: meta.parents.length > 1,
      changes: record.files.map((file) => fileChange(root, sha, parent, file)),
    };
  });
}
