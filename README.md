<div align="center">
<h1>Open Game Stack Registry</h1>
<p>Game registry specification and API with a searchable list of open-source games</p>
  <p>
    <a href="https://open-game-stack.github.io/open-game-stack-registry">Registry API</a>
    ⦁︎
    <a href="https://github.com/orgs/open-game-stack/projects">Roadmap</a>
  </p>
<p>

![Test](https://github.com/open-game-stack/open-game-stack-registry/workflows/Test/badge.svg)
![Release](https://github.com/open-game-stack/open-game-stack-registry/workflows/Release/badge.svg)

</div>

# open-game-stack-registry

Game registry with a searchable list of open-source games and their release binaries. Provides a static JSON-LD API with file metadata and URLs for each platform, suitable for use by installers, storefronts, and discovery tools.

This registry is for free, open-source games only. Games should support at least one of Linux, macOS, or Windows. Submissions that do not meet the guidelines may be rejected or removed by a contributor at any time.

## How it works

Community members add YAML files to a new branch, one per game version. After the YAML files have been scanned for security they are merged into main. GitHub Actions generates a static site of JSON-LD files for each resource in the registry. Compatible tools and websites read the JSON files to discover and install games.

On every pull request the CI pipeline:

1. Detects changed `resources/**/*.yaml` files
2. Downloads the release binaries and auto-corrects any wrong `sha256` or `contentSize` values in the YAML
3. Runs VirusTotal scans on all downloaded binaries and posts a report as a PR comment
4. Posts the destination registry URLs as a PR comment for quick review

## Contributing a game

If using a coding agent, point it at `AGENTS.md` to automate the process of submitting a game.

Fork the repository `open-game-stack-registry`. Add new folders for the publisher and game using [kebab-case](https://developer.mozilla.org/en-US/docs/Glossary/Kebab_case):

    resources/publishers/org-name/index.yaml
    resources/games/game-name/index.yaml
    resources/games/game-name/index.jpg
    resources/games/game-name/versions/1.0.0.yaml

Use an existing entry as a starting point:

- Publisher: [resources/publishers/cdogs-sdl-community/index.yaml](https://github.com/open-game-stack/open-game-stack-registry/blob/main/resources/publishers/cdogs-sdl-community/index.yaml)
- Game: [resources/games/cdogs-sdl/index.yaml](https://github.com/open-game-stack/open-game-stack-registry/blob/main/resources/games/cdogs-sdl/index.yaml)
- Version: [resources/games/cdogs-sdl/versions/2.4.0.yaml](https://github.com/open-game-stack/open-game-stack-registry/blob/main/resources/games/cdogs-sdl/versions/2.4.0.yaml)

Version files must use [Semantic Versioning](https://semver.org). Date-based release tags (e.g. `20231010`) should be converted to semver (e.g. `2023.10.10`).

Set `sha256` to the placeholder `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` (64 `f` characters). Get `contentSize` (bytes) from the GitHub release API. The validate script will download each binary, compute the real hash, and rewrite the YAML automatically.

After making your changes, validate them locally:

```bash
npm install
npm run validate -- resources/games/cdogs-sdl/versions/2.4.0.yaml
```

If the script reports `Updated N YAML value(s)`, the YAML has been rewritten with correct values — review the diff before committing. Then run the full check:

```bash
npm run check
```

After validation passes, push your branch to GitHub and open a PR. The CI pipeline will run tests, validate binaries, and perform VirusTotal scans before the PR is merged.

## Developer information

Open Game Stack Registry was built using:

- NodeJS 20.x
- TypeScript 5.x
- eslint 9.x
- prettier 3.x

## Developer installation

Install dependencies using:

    npm install

## Developer usage

Run dev commands using:

    npm run lint
    npm run format
    npm run dev
    npm test

Validate resources:

    npm run validate
    npm run validate -- resources/games/cdogs-sdl/versions/2.4.0.yaml

Create a production build using:

    npm run build

Run the production build:

    npm start

## Developer deployment

GitHub Actions automatically publishes to GitHub Pages on every push to `main`:

    https://open-game-stack.github.io/open-game-stack-registry

To cut a versioned release:

    npm version patch
    git push && git push origin --tags

## Contact

For more information please contact kmturley
