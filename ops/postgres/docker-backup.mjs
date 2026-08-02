import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const [rawName, inlineValue] = argument.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      options[rawName] = inlineValue;
      continue;
    }
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[rawName] = 'true';
      continue;
    }
    options[rawName] = next;
    index += 1;
  }
  return { command, options };
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${command} failed with exit code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return capture ? result.stdout.trim() : '';
}

function requireIdentifier(value, label) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${label} must be a simple PostgreSQL identifier.`);
  }
  return value;
}

const { command, options } = parseArguments(process.argv.slice(2));
if (!['backup', 'restore', 'rehearse'].includes(command)) {
  throw new Error('Usage: node ops/postgres/docker-backup.mjs <backup|restore|rehearse> [options]');
}

const project = options.project || 'gravity-staging';
const composeFile = resolve(options.compose || 'docker-compose.staging.yml');
const database = requireIdentifier(options.database || process.env.STAGING_POSTGRES_DB || 'gravity_staging', 'database');
const user = requireIdentifier(options.user || process.env.STAGING_POSTGRES_USER || 'gravity', 'user');
const defaultOutput = `.artifacts/gravity-${command}-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
const output = resolve(options.output || defaultOutput);
const composeArgs = ['compose', '--project-name', project, '--file', composeFile];
const containerId = run('docker', [...composeArgs, 'ps', '--quiet', 'postgres'], { capture: true });

if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
  throw new Error('Could not resolve exactly one PostgreSQL container from the staging compose project.');
}

const containerBackup = `/tmp/gravity-backup-${process.pid}.dump`;

function removeContainerTemp() {
  run('docker', ['exec', containerId, 'rm', '-f', containerBackup]);
}

function backup({ overwrite = false } = {}) {
  if (existsSync(output) && !overwrite) {
    throw new Error(`Backup output already exists: ${output}. Pass --overwrite only after verifying the target.`);
  }
  mkdirSync(dirname(output), { recursive: true });
  try {
    run('docker', ['exec', containerId, 'pg_dump', '--username', user, '--dbname', database, '--format', 'custom', '--file', containerBackup]);
    run('docker', ['cp', `${containerId}:${containerBackup}`, output]);
  } finally {
    removeContainerTemp();
  }
  process.stdout.write(`Backup created: ${output}\n`);
}

function restore() {
  if (options.confirm !== database) {
    throw new Error(`Restore refused. Pass --confirm ${database} to acknowledge the exact destructive target.`);
  }
  if (!existsSync(output)) throw new Error(`Backup file does not exist: ${output}`);
  try {
    run('docker', ['cp', output, `${containerId}:${containerBackup}`]);
    run('docker', [
      'exec',
      containerId,
      'pg_restore',
      '--username',
      user,
      '--dbname',
      database,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--exit-on-error',
      containerBackup,
    ]);
  } finally {
    removeContainerTemp();
  }
  process.stdout.write(`Restore completed for database: ${database}\n`);
}

function durableCounts() {
  const query = [
    "select json_build_object(",
    "'sessions',(select count(*) from sessions),",
    "'participants',(select count(*) from session_participants),",
    "'snapshots',(select count(*) from state_snapshots),",
    "'submissions',(select count(*) from turn_submissions));",
  ].join('');
  return run('docker', ['exec', containerId, 'psql', '--username', user, '--dbname', database, '--tuples-only', '--no-align', '--command', query], {
    capture: true,
  });
}

if (command === 'backup') backup({ overwrite: options.overwrite === 'true' });
if (command === 'restore') restore();
if (command === 'rehearse') {
  const before = durableCounts();
  backup({ overwrite: options.overwrite === 'true' });
  options.confirm = database;
  restore();
  const after = durableCounts();
  if (before !== after) throw new Error(`Backup/restore count mismatch. Before: ${before}; after: ${after}`);
  process.stdout.write(`Backup/restore rehearsal preserved durable counts: ${after}\n`);
}
