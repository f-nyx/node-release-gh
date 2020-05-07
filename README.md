# node-release-gh

This workflow bumps the project's version when a pull request is merged into master. It uses the standard semver
convention.

If the source branch is `develop`, it bumps the minor version. Otherwise, it assumes the source branch is a hotfix
and it bumps the revision number.
