# Instructions for Agents: Contributing via command line

## 1. Setup git repo

Check to see if you are inside the registry repository:

```bash
git status
```

If you see an error message like `fatal: not a git repository`, then use GitHub CLI to fork the repository:

```bash
gh repo fork open-game-stack/open-game-stack-registry --clone
cd open-game-stack-registry
```

Ensure you are on the main branch and up-to-date with changes:

```bash
git checkout main
git pull
npm install
```

Then continue to step 2.

## 2. Contributing changes

You can contribute either functional changes to the codebase or add new entries (games, publishers) to the registry.
Infer the type of change from the user prompt. If unclear ask them to clarify.

- For functional changes continue to step 2a.
- For adding new registry entries continue to step 2b.

## 2a. Contributing functional changes

Create a new branch for your contribution. Use descriptive branch names following these conventions:

- `feature/feature-name` for new features
- `fix/fix-name` for bug fixes

Edit TypeScript/JavaScript files in the codebase using your tools. Ensure changes follow the project's coding standards, enforced by Prettier (.prettierrc) for code formatting, ESLint (eslint.config.js) for linting, and the test suite (test/\*.test.ts).

Then proceed to step 3.

## 2b. Contributing a game

Create a new branch for your contribution. Use descriptive branch names following these conventions:

- `game/game-name` for game additions
- `publisher/publisher-name` for publisher additions

If not already supplied by the user, prompt for the game's GitHub repository URL. For example: `https://github.com/cxong/cdogs-sdl`.

Use the GitHub API to retrieve game and release information:

```bash
curl -s https://api.github.com/repos/cxong/cdogs-sdl
curl -s https://raw.githubusercontent.com/cxong/cdogs-sdl/refs/heads/master/README.md
curl -s https://api.github.com/repos/cxong/cdogs-sdl/releases
curl -s https://api.github.com/repos/cxong/cdogs-sdl/releases/tags/2.4.0
```

The release API response includes each asset's `browser_download_url` and `size` (contentSize). You do not need to compute sha256 manually — use the placeholder value and the validate script will auto-correct it (see step 3).

### Publisher

First create a publisher directory and `index.yaml` if one does not already exist for the GitHub organisation. Use [kebab-case](https://developer.mozilla.org/en-US/docs/Glossary/Kebab_case):

    resources/publishers/org-name/index.yaml

Example (`resources/publishers/cdogs-sdl-community/index.yaml`):

```yaml
type: Organization
name: C-Dogs SDL Community
description: Open-source community maintaining the C-Dogs SDL classic arcade shooter.
url: https://github.com/cxong
```

### Game

Create a directory for the game using its repository name in kebab-case:

    resources/games/game-name/index.yaml

Example (`resources/games/cdogs-sdl/index.yaml`):

```yaml
type: SoftwareApplication
name: C-Dogs SDL
description: Classic top-down arcade run-and-gun shooter featuring local co-op, custom campaigns, and map editors.
applicationCategory: action
publisher: /publishers/cdogs-sdl-community
url: https://github.com/cxong/cdogs-sdl
image: /games/cdogs-sdl/index.jpg
keywords:
  - retro
  - top-down
  - arcade
  - shooter
  - co-op
  - multiplayer
```

Valid `applicationCategory` values: `action`, `adventure`, `arcade`, `casual`, `platformer`, `puzzle`, `racing`, `rpg`, `shooter`, `simulation`, `sports`, `strategy`.

If the repository README links to a screenshot or logo image, download it and save it as a JPEG at:

    resources/games/game-name/index.jpg

Use ffmpeg if format conversion is needed, preserving quality as much as possible.

### Versions

Create a version file for each release using [Semantic Versioning](https://semver.org). Date-based release tags (e.g. `20231010`) must be converted to semver (e.g. `2023.10.10`). Pre-release tags like `alpha39` become `0.39.0`:

    resources/games/game-name/versions/1.0.0.yaml

Example (`resources/games/cdogs-sdl/versions/2.4.0.yaml`):

```yaml
type: SoftwareApplication
version: 2.4.0
datePublished: 2026-01-26
releaseNotes: Adds new campaign missions, improves online multiplayer stability, and refreshes the map editor UI.
associatedMedia:
  - name: C-Dogs SDL 2.4.0 Linux
    contentUrl: https://github.com/cxong/cdogs-sdl/releases/download/2.4.0/C-Dogs.SDL-2.4.0-Linux.tar.gz
    encodingFormat: application/gzip
    license: https://spdx.org/licenses/BSD-2-Clause.html
    operatingSystem:
      - linux
    sha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
    contentSize: 29387336
  - name: C-Dogs SDL 2.4.0 macOS
    contentUrl: https://github.com/cxong/cdogs-sdl/releases/download/2.4.0/C-Dogs.SDL-2.4.0-OSX.dmg
    encodingFormat: application/x-apple-diskimage
    license: https://spdx.org/licenses/BSD-2-Clause.html
    operatingSystem:
      - macos
    sha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
    contentSize: 31104984
  - name: C-Dogs SDL 2.4.0 Windows 32-bit
    contentUrl: https://github.com/cxong/cdogs-sdl/releases/download/2.4.0/C-Dogs.SDL-2.4.0-win32.exe
    encodingFormat: application/vnd.microsoft.portable-executable
    license: https://spdx.org/licenses/BSD-2-Clause.html
    operatingSystem:
      - windows
    processorRequirements:
      - x86
    sha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
    contentSize: 31941555
```

The `sha256` placeholder value (`fff...`) is intentionally invalid — the validate script will download each file, compute the real hash, and rewrite the YAML automatically.

Get `contentSize` (bytes) from the GitHub release API (`size` field on each asset). Set `sha256` to `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` (64 `f` characters).

Valid `operatingSystem` values: `linux`, `macos`, `windows`.  
Valid `processorRequirements` values: `x86`, `x86_64`, `arm64`.  
Common `encodingFormat` values:

- `application/zip` — .zip
- `application/gzip` — .tar.gz
- `application/x-7z-compressed` — .7z
- `application/x-apple-diskimage` — .dmg
- `application/vnd.microsoft.portable-executable` — .exe
- `application/x-debian-package` — .deb
- `application/octet-stream` — .AppImage

## 3. Validate Changes

Run the validate command against the file you have just added or changed. This will download the release binaries, compute real sha256 hashes and content sizes, and auto-correct any mismatches in the YAML:

```bash
npm run validate -- resources/games/cdogs-sdl/versions/2.4.0.yaml
```

If the script reports `Updated N YAML value(s)`, the source YAML has been rewritten with correct values — review the diff and confirm the changes look right.

To validate all resources at once:

```bash
npm run validate
```

Files are cached in `test/downloads/` after the first download, so subsequent runs skip already-downloaded binaries.

Then run the full check command to confirm formatting, linting, and tests all pass:

```bash
npm run check
```

Return the generated yaml files to the user for them to read/review.

Ask user for [Y/N] approval to proceed to Commit Changes, Push Changes and Submit Pull Request.

- If the user answers Yes or Y, continue to step 4.
- If the user answers No or N, ask them what changes they would like to make, and iterate until they are happy with the result, each time asking for approval before continuing to step 4.

## 4. Commit, push and pr changes

Stage and commit your changes. Use descriptive commit messages with prefixes following these conventions:

- `[feature]` for new features
- `[fix]` for bug fixes
- `[game]` for game additions
- `[publisher]` for publisher additions

Example:

```bash
git add resources/games/cdogs-sdl resources/publishers/cdogs-sdl-community
git commit -m "[game] Add C-Dogs SDL with publisher and release binaries"
```

Push the branch to your forked repository:

```bash
git push origin game/cdogs-sdl
```

Create a pull request using GitHub CLI:

```bash
gh pr create --title "Your PR Title" --body "Description of your changes"
```

Then proceed to step 5.

## 5. Conclusion

Respond to the user that the contribution has been submitted for review, with the url to the PR for them to view VirusTotal scans and peer review.
