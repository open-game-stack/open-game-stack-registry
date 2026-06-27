# Open Game Stack - Registry - Specification 1.0.0

**Date**: 27th June 2026  
**Status:** Review  
**Authors:** Kim T

This document is licensed under a [Creative Commons 4.0](https://creativecommons.org/licenses/by/4.0/) license.

## Introduction

This document describes an open specification for open-source game metadata stored in a registry. The goal is to enable interoperability between game discovery tools, storefronts, and installers by providing a consistent, machine-readable API for game metadata and release binaries.

The registry is built from YAML source files which are transformed into [JSON-LD](https://json-ld.org) documents using [schema.org](https://schema.org) vocabulary and deployed as a static API on GitHub Pages.

### Definitions

- **Publisher** — Organisation or individual who develops and releases a game.
- **Game** — A software application (open-source game) with metadata describing what it is and how to find it.
- **Version** — A specific release of a game including download binaries for one or more platforms.
- **Binary** — A platform-specific downloadable file (installer, archive, disk image, etc.) associated with a game version.
- **Registry** — Database of game metadata with a read-only JSON-LD API.
- **Game manager** — Tool (app, CLI, website) that reads the registry to discover, download, and install games.

### Problems solved

Players install games from a variety of sources, each with different installation steps, formats, and update mechanisms. The result is:

1. Manual, error-prone installation from individual project pages.
2. Broken or outdated download links.
3. No cross-platform consistency in packaging.
4. No way to verify that a downloaded binary is authentic and unmodified.
5. No programmatic way to discover or enumerate available games.
6. No standard version history or changelog format.

This specification applies conventions from established package managers ([npm](https://docs.npmjs.com), [pip](https://pip.pypa.io), [Homebrew](https://brew.sh)) to open-source games. Tools adopting this specification can interoperate with each other and give players consistent installation and update workflows.

### Use cases

1. Search for games and filter by category, platform, or license.
2. View game details including description, screenshot, and available platforms before downloading.
3. Download a specific version of a game for the current platform.
4. Verify a downloaded binary against a known sha256 hash.
5. Discover the latest version of a game programmatically.
6. Build a storefront or installer that works across all registered games.

## Registry

The registry is a static site generated from YAML source files. All responses are JSON-LD documents using the `https://schema.org/` context.

### Registry root

```
https://open-game-stack.github.io/open-game-stack-registry
```

### Registry versioning

If breaking changes are needed the registry may be versioned:

```
https://open-game-stack.github.io/open-game-stack-registry/v2
```

All endpoints below are relative to the root URL.

## Config

### Application categories

| Name       | Description                                                  | Value        |
| :--------- | :----------------------------------------------------------- | :----------- |
| Action     | Fast-paced games requiring quick reflexes and reaction time. | `action`     |
| Adventure  | Story-driven exploration and puzzle-solving games.           | `adventure`  |
| Arcade     | Score-based games inspired by classic arcade machines.       | `arcade`     |
| Casual     | Accessible games suitable for short play sessions.           | `casual`     |
| Platformer | Side-scrolling or 2D jumping and running games.              | `platformer` |
| Puzzle     | Logic and problem-solving focused games.                     | `puzzle`     |
| Racing     | Vehicle or character racing and time-trial games.            | `racing`     |
| RPG        | Role-playing games with progression, story, and character.   | `rpg`        |
| Shooter    | Games focused on ranged combat, first or third person.       | `shooter`    |
| Simulation | Games simulating real-world or fictional systems.            | `simulation` |
| Sports     | Competitive sports and athletics games.                      | `sports`     |
| Strategy   | Planning and resource management games, often turn-based.    | `strategy`   |

### Operating systems

| Name    | Description                                                        | Value     |
| :------ | :----------------------------------------------------------------- | :-------- |
| Linux   | Open-source operating system used widely on desktop and server.    | `linux`   |
| macOS   | Operating system designed and sold by Apple.                       | `macos`   |
| Windows | Most widely used home operating system, preloaded on most new PCs. | `windows` |

### Processor requirements

| Name         | Description                                                                  | Value    |
| :----------- | :--------------------------------------------------------------------------- | :------- |
| x86 (32-bit) | 32-bit x86 processors, common on older desktop and laptop computers.         | `x86`    |
| x86-64       | 64-bit x86 processors, the standard for modern desktop and laptop computers. | `x86_64` |
| ARM 64-bit   | ARM processors used in Apple Silicon Macs and ARM-based Linux devices.       | `arm64`  |

### Encoding formats

MIME types used for the `encodingFormat` field on binary files.

| MIME type                                       | Extension   | Description                                              |
| :---------------------------------------------- | :---------- | :------------------------------------------------------- |
| `application/zip`                               | `.zip`      | Widely-supported compressed archive.                     |
| `application/gzip`                              | `.tar.gz`   | Compressed tarball, common on Linux.                     |
| `application/x-7z-compressed`                   | `.7z`       | 7-Zip archive with high compression ratio.               |
| `application/x-apple-diskimage`                 | `.dmg`      | macOS disk image, typically contains a drag-install app. |
| `application/vnd.microsoft.portable-executable` | `.exe`      | Windows executable, used for both installers and apps.   |
| `application/x-debian-package`                  | `.deb`      | Debian/Ubuntu Linux package.                             |
| `application/x-redhat-package-manager`          | `.rpm`      | Red Hat / Fedora Linux package.                          |
| `application/octet-stream`                      | `.AppImage` | Self-contained Linux application image.                  |
| `application/x-msdownload`                      | `.msi`      | Windows Installer package.                               |

### Licenses

Licenses are expressed as SPDX URLs in the format `https://spdx.org/licenses/{id}.html`.

| Name                                                                                        | SPDX id        |
| :------------------------------------------------------------------------------------------ | :------------- |
| [GNU General Public License v2.0](https://choosealicense.com/licenses/gpl-2.0)              | `GPL-2.0`      |
| [GNU General Public License v3.0](https://choosealicense.com/licenses/gpl-3.0)              | `GPL-3.0`      |
| [GNU Lesser General Public License v2.1](https://choosealicense.com/licenses/lgpl-2.1)      | `LGPL-2.1`     |
| [GNU Lesser General Public License v3.0](https://choosealicense.com/licenses/lgpl-3.0)      | `LGPL-3.0`     |
| [GNU Affero General Public License v3.0](https://choosealicense.com/licenses/agpl-3.0)      | `AGPL-3.0`     |
| [MIT License](https://choosealicense.com/licenses/mit)                                      | `MIT`          |
| [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0)                        | `Apache-2.0`   |
| [BSD 2-Clause "Simplified" License](https://choosealicense.com/licenses/bsd-2-clause)       | `BSD-2-Clause` |
| [BSD 3-Clause "New" or "Revised" License](https://choosealicense.com/licenses/bsd-3-clause) | `BSD-3-Clause` |
| [Mozilla Public License 2.0](https://choosealicense.com/licenses/mpl-2.0)                   | `MPL-2.0`      |
| [Creative Commons Zero v1.0 Universal](https://choosealicense.com/licenses/cc0-1.0)         | `CC0-1.0`      |
| [The Unlicense](https://choosealicense.com/licenses/unlicense)                              | `Unlicense`    |
| [ISC License](https://choosealicense.com/licenses/isc)                                      | `ISC`          |
| [zlib License](https://choosealicense.com/licenses/zlib)                                    | `Zlib`         |

## Publisher

Publishers are organisations or individuals that develop and release games. Each publisher has a slug derived from their GitHub organisation name in [kebab-case](https://developer.mozilla.org/en-US/docs/Glossary/Kebab_case).

### Publisher YAML fields

| Field       | Type   | Required | Description                                  | Example                                                                      |
| :---------- | :----- | :------- | :------------------------------------------- | :--------------------------------------------------------------------------- |
| type        | string | yes      | Must be `Organization`                       | `Organization`                                                               |
| name        | string | yes      | Publisher display name                       | `"C-Dogs SDL Community"`                                                     |
| description | string | yes      | Short description of the publisher           | `"Open-source community maintaining the C-Dogs SDL classic arcade shooter."` |
| url         | string | yes      | Publisher website or GitHub organisation URL | `"https://github.com/cxong"`                                                 |

### Publisher YAML example

```yaml
type: Organization
name: C-Dogs SDL Community
description: Open-source community maintaining the C-Dogs SDL classic arcade shooter.
url: https://github.com/cxong
```

### Publisher API endpoints

#### List publishers

```
GET /publishers/index.json
{
  "@context": "https://schema.org/",
  "@type": "ItemList",
  "@id": "https://open-game-stack.github.io/open-game-stack-registry/publishers",
  "itemListElement": [
    {
      "@type": "ListItem",
      "item": {
        "@id": "https://open-game-stack.github.io/open-game-stack-registry/publishers/cdogs-sdl-community",
        "@type": "Organization",
        "name": "C-Dogs SDL Community"
      }
    }
  ]
}
```

#### Get publisher by slug

```
GET /publishers/{slug}/index.json
{
  "@context": "https://schema.org/",
  "@type": "Organization",
  "@id": "https://open-game-stack.github.io/open-game-stack-registry/publishers/cdogs-sdl-community",
  "name": "C-Dogs SDL Community",
  "description": "Open-source community maintaining the C-Dogs SDL classic arcade shooter.",
  "url": "https://github.com/cxong"
}
```

## Game

Games are software applications with a slug derived from their GitHub repository name in kebab-case.

### Game YAML fields

| Field               | Type            | Required | Description                                          | Example                                          |
| :------------------ | :-------------- | :------- | :--------------------------------------------------- | :----------------------------------------------- |
| type                | string          | yes      | Must be `SoftwareApplication`                        | `SoftwareApplication`                            |
| name                | string          | yes      | Game display name                                    | `"C-Dogs SDL"`                                   |
| description         | string          | yes      | Short description of the game (one or two sentences) | `"Classic top-down arcade run-and-gun shooter."` |
| applicationCategory | string          | yes      | Category from the table above                        | `"action"`                                       |
| publisher           | string          | yes      | Registry path to the publisher                       | `"/publishers/cdogs-sdl-community"`              |
| url                 | string          | yes      | Game website or GitHub repository URL                | `"https://github.com/cxong/cdogs-sdl"`           |
| image               | string          | no       | Registry path to a JPEG screenshot or logo           | `"/games/cdogs-sdl/index.jpg"`                   |
| keywords            | array\<string\> | no       | Tags for search and discovery                        | `["retro", "co-op", "shooter"]`                  |

### Game YAML example

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

### Game image

If a screenshot or logo is available, save it as a JPEG at `resources/games/{slug}/index.jpg`. Recommended size is around 1000px wide to balance quality and load times. Use ffmpeg to convert other formats if needed:

```bash
ffmpeg -i screenshot.png -q:v 2 resources/games/cdogs-sdl/index.jpg
```

### Game API endpoints

#### List games

```
GET /games/index.json
{
  "@context": "https://schema.org/",
  "@type": "ItemList",
  "@id": "https://open-game-stack.github.io/open-game-stack-registry/games",
  "itemListElement": [
    {
      "@type": "ListItem",
      "item": {
        "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl",
        "@type": "SoftwareApplication",
        "name": "C-Dogs SDL"
      }
    }
  ]
}
```

#### Get game by slug

```
GET /games/{slug}/index.json
{
  "@context": "https://schema.org/",
  "@type": "SoftwareApplication",
  "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl",
  "name": "C-Dogs SDL",
  "description": "Classic top-down arcade run-and-gun shooter featuring local co-op, custom campaigns, and map editors.",
  "applicationCategory": "action",
  "keywords": ["retro", "top-down", "arcade", "shooter", "co-op", "multiplayer"],
  "publisher": {
    "@id": "https://open-game-stack.github.io/open-game-stack-registry/publishers/cdogs-sdl-community",
    "@type": "Organization",
    "name": "C-Dogs SDL Community"
  },
  "url": "https://github.com/cxong/cdogs-sdl",
  "image": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl/index.jpg",
  "versions": [
    {
      "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl/versions/2.4.0",
      "@type": "SoftwareApplication",
      "name": "C-Dogs SDL 2.4.0"
    }
  ],
  "latestVersion": {
    "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl/versions/2.4.0",
    "@type": "SoftwareApplication",
    "name": "C-Dogs SDL 2.4.0"
  }
}
```

## Version

Each version is a specific release of a game. Version files are named after the release using [Semantic Versioning](https://semver.org). Date-based upstream tags (e.g. `20231010`) are converted to semver (e.g. `2023.10.10`).

### Version YAML fields

| Field           | Type                 | Required | Description                                        | Example                |
| :-------------- | :------------------- | :------- | :------------------------------------------------- | :--------------------- |
| type            | string               | yes      | Must be `SoftwareApplication`                      | `SoftwareApplication`  |
| version         | string               | yes      | Semantic version string                            | `"2.4.0"`              |
| datePublished   | string               | yes      | Release date in `YYYY-MM-DD` format                | `"2026-01-26"`         |
| releaseNotes    | string               | no       | Summary of changes in this version                 | `"Adds new missions."` |
| associatedMedia | array\<MediaObject\> | no       | List of downloadable binary files for this version | see below              |

### MediaObject YAML fields

Each entry in `associatedMedia` describes one downloadable binary file.

| Field                 | Type            | Required | Description                                                                              | Example                                                  |
| :-------------------- | :-------------- | :------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| name                  | string          | yes      | Display name for this binary                                                             | `"C-Dogs SDL 2.4.0 Linux"`                               |
| contentUrl            | string          | yes      | Direct download URL (https). GitHub Releases is recommended.                             | `"https://github.com/.../C-Dogs.SDL-2.4.0-Linux.tar.gz"` |
| encodingFormat        | string          | yes      | MIME type of the file (see encoding formats table)                                       | `"application/gzip"`                                     |
| license               | string          | yes      | SPDX license URL                                                                         | `"https://spdx.org/licenses/GPL-3.0.html"`               |
| operatingSystem       | array\<string\> | yes      | Target operating systems (see operating systems table)                                   | `["linux"]`                                              |
| processorRequirements | array\<string\> | no       | Required processor architecture(s) (see processor requirements table)                    | `["x86_64"]`                                             |
| sha256                | string          | yes      | SHA-256 hex digest of the file. Auto-corrected by the validate script.                   | `"f5d9c7f97fde5972..."`                                  |
| contentSize           | number          | yes      | File size in bytes. Available from the GitHub Releases API (`size` field on each asset). | `29387336`                                               |

### Version YAML example

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
    sha256: f5d9c7f97fde5972a6e579813b3102a9233c3381acb03e43dee6acefe14f9bad
    contentSize: 29387336
  - name: C-Dogs SDL 2.4.0 macOS
    contentUrl: https://github.com/cxong/cdogs-sdl/releases/download/2.4.0/C-Dogs.SDL-2.4.0-OSX.dmg
    encodingFormat: application/x-apple-diskimage
    license: https://spdx.org/licenses/BSD-2-Clause.html
    operatingSystem:
      - macos
    sha256: c5c79978f3410a9e7fa077aeb6a5168ebfc70d2752d666753ad1a10e5390bf3b
    contentSize: 31104984
  - name: C-Dogs SDL 2.4.0 Windows 32-bit
    contentUrl: https://github.com/cxong/cdogs-sdl/releases/download/2.4.0/C-Dogs.SDL-2.4.0-win32.exe
    encodingFormat: application/vnd.microsoft.portable-executable
    license: https://spdx.org/licenses/BSD-2-Clause.html
    operatingSystem:
      - windows
    processorRequirements:
      - x86
    sha256: d2c7ea32acb33eacfc5550f847eb4014c38ffe93a1c6c84b6d5b1e3d4c8cbdf8
    contentSize: 31941555
```

### sha256 and contentSize

`contentSize` (bytes) is available from the GitHub Releases API (`size` field on each asset):

```bash
curl -s https://api.github.com/repos/cxong/cdogs-sdl/releases/tags/2.4.0 \
  | python3 -c "import sys,json; [print(a['browser_download_url'], a['size']) for a in json.load(sys.stdin)['assets']]"
```

For `sha256`, use the placeholder `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` (64 `f` characters). The validate script will download each binary, compute the real hash, and rewrite the YAML automatically:

```bash
npm run validate -- resources/games/cdogs-sdl/versions/2.4.0.yaml
```

### Version API endpoints

#### List versions for a game

```
GET /games/{slug}/versions/index.json
{
  "@context": "https://schema.org/",
  "@type": "ItemList",
  "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl/versions",
  "itemListElement": [
    {
      "@type": "ListItem",
      "item": {
        "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl/versions/2.4.0",
        "@type": "SoftwareApplication",
        "name": "C-Dogs SDL 2.4.0"
      }
    }
  ]
}
```

#### Get version by slug and version

```
GET /games/{slug}/versions/{version}/index.json
{
  "@context": "https://schema.org/",
  "@type": "SoftwareApplication",
  "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl/versions/2.4.0",
  "name": "C-Dogs SDL 2.4.0",
  "version": "2.4.0",
  "datePublished": "2026-01-26",
  "releaseNotes": "Adds new campaign missions, improves online multiplayer stability, and refreshes the map editor UI.",
  "isPartOf": {
    "@id": "https://open-game-stack.github.io/open-game-stack-registry/games/cdogs-sdl",
    "@type": "SoftwareApplication",
    "name": "C-Dogs SDL"
  },
  "associatedMedia": [
    {
      "@type": "MediaObject",
      "name": "C-Dogs SDL 2.4.0 Linux",
      "encodingFormat": "application/gzip",
      "license": "https://spdx.org/licenses/BSD-2-Clause.html",
      "operatingSystem": ["linux"],
      "contentSize": 29387336,
      "sha256": "f5d9c7f97fde5972a6e579813b3102a9233c3381acb03e43dee6acefe14f9bad",
      "contentUrl": "https://github.com/cxong/cdogs-sdl/releases/download/2.4.0/C-Dogs.SDL-2.4.0-Linux.tar.gz"
    }
  ]
}
```

#### Get latest version

The registry also exposes an alias document at `/versions/latest` pointing to the highest semver version:

```
GET /games/{slug}/versions/latest/index.json
```

Response shape is identical to the versioned endpoint above.
