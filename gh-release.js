const semver = require('semver')
const { Octokit } = require("@octokit/rest");
const shell = require('shelljs');
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const yargs = require('yargs');

const GH_COMMITTER = 'web-flow';
const REFS = 'refs/';

/** Github client. The GITHUB_TOKEN environment variable must be set.
 * @type {Octokit}
 */
const github = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

function exec(command) {
  return shell.exec(command, { silent: true });
}

/** Returns the version number from the root module.
 * @return {string} version number following the semver convention.
 */
function baseVersion() {
  return JSON.parse(readFileSync(join(__dirname, 'package.json'))).version;
}

/** Resolves the part of the version (according to semver) that should be bumped.
 *
 * In order to detect whether the last merge comes from the develop branch, it assumes that
 * the commit message is the default message generated by github when a pull request is merged.
 *
 * @param {string} currentRef Current branch ref.
 * @param {string} owner Github repository owner.
 * @param {string} repo Github repository name.
 * @return {Promise<string>} either 'minor' or 'revision' depending on the last merge.
 */
async function resolveNextSemver({ currentRef, owner, repo }) {
  const developRef = `${owner}/develop`;
  const branchRef = await github.git.getRef({
    owner,
    repo,
    ref: currentRef
  });
  const headCommit = await github.repos.getCommit({
    owner,
    repo,
    ref: branchRef.data.object.sha
  });

  const lastCommit = headCommit.data.commit.message.split("\n").shift();
  const lastCommitRef = lastCommit.substr(-developRef.length);
  const isHotfix = lastCommitRef !== developRef;

  return isHotfix ? 'patch' : 'minor';
}

/** Iterates the subdirectories searching for submodules and bumps the versions up to the
 * root module version. It does not create git tags, it just bumps versions and stage all
 * changes.
 */
function bumpModules({ workingDir, nextVersion }) {
  const modules = readdirSync(workingDir, { withFileTypes: true }).filter(inode =>
    inode.isDirectory() && existsSync(join(workingDir, inode.name, 'package.json'))
  ).map(inode =>
    inode.name
  );
  console.log(`bumping modules versions up to ${nextVersion}: ${modules.join(', ')}`);

  modules.forEach(moduleName => {
    shell.cd(join(workingDir, moduleName));
    exec(`npm version ${nextVersion} --no-git-tag-version`)
  });

  shell.cd(workingDir);
  exec(`git add .`);
}

/** Bumps the release version based on the last merge commit.
 *
 * If the last merge is from the develop branch, y bumps the minor version. Otherwise, it
 * assumes the merge is a hotfix and bumps the revision number.
 *
 * Once it bumps the version, it commits all changes, creates the git tag,
 * and pushes all changes to the remote repository.
 *
 * @param {object} args Arguments provided in the command line.
 * @param {string} args.owner Github repository owner.
 * @param {string} args.repo Github repository name.
 */
async function release(args) {
  let currentRef = process.env.CURRENT_REF || 'refs/heads/master';

  if (currentRef.indexOf(REFS) === 0) {
    currentRef = currentRef.substr(REFS.length);
  }
  const workingDir = __dirname;
  const versionBump = await resolveNextSemver({
    currentRef,
    ...args
  });

  const nextVersion = semver.inc(baseVersion(), versionBump);
  console.log(`preparing ${versionBump} release: ${nextVersion}`);
  bumpModules({ workingDir, nextVersion });

  const versionResult = exec(`npm version ${versionBump} --force -m 'New release: %s'`);

  if (versionResult.code !== 0) {
    console.info('error preparing the release');
    console.error(versionResult.stderr);
    process.exit(1);
  } else {
    console.log(versionResult.stdout);
    console.log(`release prepared successfully, new version is ${baseVersion()}`);
    console.log('pushing new release to github');
    exec('git push && git push --tags');
    console.log('release successful');
  }
}

(async function __init() {
  return yargs
    .command('release', 'bumps the project version and tags the new release in git', {
      owner: {
        description: 'the repository owner',
        type: 'string',
        required: true
      },
      repo: {
        description: 'the repository name',
        type: 'string',
        required: true
      }
    }, release)
    .demandCommand(1)
    .argv
}());
