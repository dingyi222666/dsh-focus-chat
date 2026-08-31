/**
 * One-time backfill: delete every existing release + tag for the version
 * table below and recreate all of them with the full ChatLuna-style body
 * (hand-written 新特性 / 修复 & 改进 + mechanical What's Changed).
 *
 * Run with:
 *   yarn tsx scripts/backfill-releases.ts
 *
 * Safe to re-run: every version is deleted and recreated from scratch.
 * @module dsh-focus-chat/backfill-releases
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseBody } from './release-body.ts'
import { RELEASE_NOTES } from './release-notes.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = 'dingyi222666/dsh-focus-chat'

/** Version -> the commit the `v<version>` tag points at. */
const VERSIONS: ReadonlyArray<readonly [version: string, commit: string]> = [
  ['0.1.0', '95a678ab0'],
  ['0.1.1', '0844db528'],
  ['0.1.2', 'b29b83d5c'],
  ['0.1.3', '223207083'],
  ['0.1.4', '3cf1728b2'],
  ['0.1.5', '6d72675c0'],
  ['0.1.6', 'c7161a964'],
  ['0.1.7', '0cf097bec'],
  ['0.1.8', '351b0ce1c'],
  ['0.1.9', '732291a9d'],
  ['0.1.10', '63c7db1c6'],
  ['0.1.11', '8127d69c2'],
  ['0.1.12', '9818fd6bd'],
  ['0.1.13', 'a996986a1'],
  ['0.1.14', '1f7df1fb5'],
  ['0.1.15', '72407adaf'],
  ['0.1.16', '363162a99'],
  ['0.1.17', '7739f81fb'],
  ['0.1.18', 'c5ba180ce'],
  ['0.1.19', 'd3bf6a678'],
  ['0.1.20', '90bcf05d3'],
  ['0.1.21', '6c4878a29'],
  ['0.1.22', '98cb98323'],
  ['0.2.0', 'c15dce1e3'],
  ['0.2.1', '4e134462b'],
  ['0.2.2', '2d79250b2'],
  ['0.2.3', '095e7a297'],
  ['0.2.4', '46f778d6a'],
  ['0.2.5', 'a0d924892'],
  ['0.2.6', 'a412efe50'],
]

/** GitHub logins by git author email. */
const AUTHOR_BY_EMAIL: Record<string, string> = {
  'dingyi222666@foxmail.com': 'dingyi222666',
  'dingyi222666@users.noreply.github.com': 'dingyi222666',
  'linsmc@126.com': 'HuanLinOTO',
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** Commits of one version: the range from the previous tag's commit to this one. */
function commitsFor(version: string, commit: string, previousCommit: string | undefined): Array<{ hash: string; subject: string; author: string | undefined }> {
  const range = previousCommit === undefined ? commit : `${previousCommit}..${commit}`
  const raw = git('log', '--format=%H%x09%an <%ae>%x09%s', range)
  if (raw === '') return []
  return raw.split('\n').map(line => {
    const [hash, identity, ...subjectParts] = line.split('\t')
    const email = identity.match(/<(.+)>/)?.[1] ?? ''
    return {
      hash,
      subject: subjectParts.join('\t'),
      author: AUTHOR_BY_EMAIL[email] ?? undefined,
    }
  })
}

function run(label: string, cmd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`  !! ${label} failed:\n${result.stderr || result.stdout}`)
    return { ok: false, out: result.stderr || result.stdout }
  }
  return { ok: true, out: result.stdout }
}

const failed: string[] = []
for (let i = 0; i < VERSIONS.length; i++) {
  const [version, commit] = VERSIONS[i]
  const tag = `v${version}`
  const previousCommit = i === 0 ? undefined : VERSIONS[i - 1]![1]
  const notes = RELEASE_NOTES[version]
  if (notes === undefined) {
    console.error(`backfill: no hand-written release notes for ${version} — aborting`)
    process.exit(1)
  }

  console.log(`\n=== ${tag} @ ${commit} ===`)

  // Delete the existing release (if any) and the tag (local + remote).
  const rel = run('delete release', 'gh', ['release', 'delete', tag, '--repo', REPO, '--yes'])
  if (!rel.ok && !rel.out.includes('not found') && !rel.out.includes('GraphQL')) {
    // gh says "not found" for missing releases; anything else is a hard error.
    failed.push(tag)
    continue
  }
  const tagLocal = run('delete local tag', 'git', ['tag', '-d', tag])
  if (!tagLocal.ok && !tagLocal.out.includes('not found')) {
    failed.push(tag)
    continue
  }
  const tagRemote = run('delete remote tag', 'git', ['push', 'origin', `:refs/tags/${tag}`])
  if (!tagRemote.ok && !tagRemote.out.includes('does not exist') && !tagRemote.out.includes('not found')) {
    failed.push(tag)
    continue
  }

  const commits = commitsFor(version, commit, previousCommit)
  const body = buildReleaseBody(version, previousCommit === undefined ? undefined : `v${VERSIONS[i - 1]![0]}`, commits, notes)

  const dir = mkdtempSync(join(tmpdir(), 'dsh-backfill-'))
  const notesFile = join(dir, 'notes.md')
  writeFileSync(notesFile, `${body}\n`)

  // Create the tag at the release commit and push it first: gh cannot
  // create a release for a tag that does not exist yet (422 on --target).
  const tagCreated = run('create local tag', 'git', ['tag', tag, commit])
  if (!tagCreated.ok) {
    failed.push(tag)
    continue
  }
  const pushed = run('push tag', 'git', ['push', 'origin', tag])
  if (!pushed.ok) {
    failed.push(tag)
    continue
  }
  const created = run('create release', 'gh', [
    'release', 'create', tag,
    '--repo', REPO,
    '--title', tag,
    '--notes-file', notesFile,
  ])
  if (!created.ok) {
    failed.push(tag)
    continue
  }
  console.log(`  ok (${commits.length} commits)`)
}

console.log('\n=== done ===')
if (failed.length > 0) {
  console.error(`failed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('all releases recreated')
