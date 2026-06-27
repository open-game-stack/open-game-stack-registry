import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { projectDefinition } from "../project.js";
import { runBuild, type BuildResult } from "./engine.js";
import { normalizeRootDomain } from "./utils.js";
import type { JsonObject } from "./types.js";

interface FileTarget {
  resourceType: string;
  resourceId: string;
  versionId?: string;
}

// Represents one associatedMedia item ready to copy/download and verify
interface DownloadItem {
  localPath: string; // destination in test/downloads/
  sourcePath: string; // local file path (local) or https:// URL (external)
  contentUrl: string; // original contentUrl value — used for YAML block matching
  docUrlPath: string; // e.g. /games/cdogs-sdl/versions/2.4.0
  declaredSha256: string;
  declaredContentSize: number;
  isExternal: boolean;
}

function parseTargetFile(filePath: string): FileTarget | undefined {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const resourcesIdx = parts.indexOf("resources");
  if (resourcesIdx === -1) return undefined;

  const resourceType = parts[resourcesIdx + 1];
  const resourceId = parts[resourcesIdx + 2];
  if (!resourceType || !resourceId) return undefined;

  const versionsIdx = parts.indexOf("versions", resourcesIdx);
  if (versionsIdx !== -1) {
    const versionFile = parts[versionsIdx + 1];
    const versionId = versionFile?.replace(/\.yaml$/, "");
    if (versionId) return { resourceType, resourceId, versionId };
  }

  return { resourceType, resourceId };
}

function docMatchesTarget(urlPath: string, target: FileTarget): boolean {
  if (target.versionId) {
    return urlPath === `/${target.resourceType}/${target.resourceId}/versions/${target.versionId}`;
  }
  return urlPath === `/${target.resourceType}/${target.resourceId}`;
}

async function computeSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

// Stream an https:// URL to a local file without buffering the full body in memory
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("Empty response body");
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
    createWriteStream(destPath),
  );
}

// /games/cdogs-sdl/versions/2.4.0 → <cwd>/resources/games/cdogs-sdl/versions/2.4.0.yaml
function sourceYamlPath(cwd: string, docUrlPath: string): string {
  return path.join(cwd, "resources", `${docUrlPath.replace(/^\//, "")}.yaml`);
}

// Update sha256 and contentSize for a specific contentUrl block within a YAML file
async function fixYamlEntry(
  filePath: string,
  contentUrl: string,
  correctSha256: string,
  correctContentSize: number,
): Promise<boolean> {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split("\n");

  const urlIdx = lines.findIndex((l) => l.trimStart() === `contentUrl: ${contentUrl}`);
  if (urlIdx === -1) return false;

  const urlLine = lines[urlIdx] ?? "";
  const indent = urlLine.search(/\S/);
  const listIndent = Math.max(0, indent - 2);

  let blockStart = 0;
  for (let i = urlIdx - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (line.search(/\S/) <= listIndent && line.trimStart().startsWith("- ")) {
      blockStart = i;
      break;
    }
  }

  let blockEnd = lines.length;
  for (let i = urlIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (line.search(/\S/) <= listIndent && line.trimStart().startsWith("- ")) {
      blockEnd = i;
      break;
    }
  }

  let changed = false;
  for (let i = blockStart; i < blockEnd; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (line.search(/\S/) !== indent) continue;
    const t = line.trimStart();
    if (t.startsWith("sha256:")) {
      lines[i] = `${" ".repeat(indent)}sha256: ${correctSha256}`;
      changed = true;
    } else if (t.startsWith("contentSize:")) {
      lines[i] = `${" ".repeat(indent)}contentSize: ${correctContentSize}`;
      changed = true;
    }
  }

  if (changed) await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return changed;
}

// Collect all associatedMedia items (local + external) as DownloadItems
function collectItems(
  result: BuildResult,
  target: FileTarget | undefined,
  rootDomain: string,
  downloadsDir: string,
): DownloadItem[] {
  const assetByUrlPath = new Map(result.assets.map((a) => [a.urlPath, a]));
  const items: DownloadItem[] = [];

  for (const doc of result.documents) {
    if (target && !docMatchesTarget(doc.urlPath, target)) continue;
    if (doc.urlPath.endsWith("/versions/latest")) continue;
    const document = doc.document;
    if (!Array.isArray(document.associatedMedia)) continue;

    for (const media of document.associatedMedia as JsonObject[]) {
      const contentUrl = media.contentUrl as string | undefined;
      if (typeof contentUrl !== "string") continue;
      const declaredSha256 = media.sha256 as string | undefined;
      const declaredContentSize = media.contentSize as number | undefined;
      if (!declaredSha256 || declaredContentSize === undefined) continue;

      if (contentUrl.startsWith(rootDomain)) {
        // Local asset — source is in resources/, destination mirrors the output path
        const urlPath = contentUrl.slice(rootDomain.length);
        const asset = assetByUrlPath.get(urlPath);
        if (!asset) continue;
        items.push({
          localPath: path.join(downloadsDir, asset.outputPath),
          sourcePath: asset.sourcePath,
          contentUrl,
          docUrlPath: doc.urlPath,
          declaredSha256,
          declaredContentSize,
          isExternal: false,
        });
      } else {
        // External URL — derive a local path mirroring the version's asset directory
        const filename = path.basename(new URL(contentUrl).pathname);
        const relDir = doc.urlPath.replace(/^\//, "");
        items.push({
          localPath: path.join(downloadsDir, relDir, "assets", filename),
          sourcePath: contentUrl,
          contentUrl,
          docUrlPath: doc.urlPath,
          declaredSha256,
          declaredContentSize,
          isExternal: true,
        });
      }
    }
  }

  return items;
}

// Copy local files and stream external URLs into test/downloads/
async function downloadAll(items: DownloadItem[]): Promise<string[]> {
  const errors: string[] = [];
  for (const item of items) {
    await fs.mkdir(path.dirname(item.localPath), { recursive: true });
    const filename = path.basename(item.localPath);

    const alreadyExists = await fs
      .access(item.localPath)
      .then(() => true)
      .catch(() => false);
    if (alreadyExists) {
      console.log(`  skip   ${filename} (already in downloads)`);
      continue;
    }

    try {
      if (item.isExternal) {
        console.log(`  fetch  ${filename}`);
        console.log(`         ${item.contentUrl}`);
        await downloadToFile(item.sourcePath, item.localPath);
        console.log(`         done`);
      } else {
        console.log(`  copy   ${filename}`);
        await fs.copyFile(item.sourcePath, item.localPath);
      }
    } catch (e) {
      errors.push(`Failed to prepare "${item.contentUrl}": ${(e as Error).message}`);
    }
  }
  return errors;
}

// Compute sha256/contentSize from each file in downloads, compare with declared, fix YAML if needed
async function verifyAll(cwd: string, items: DownloadItem[]): Promise<{ errors: string[]; fixed: string[] }> {
  const errors: string[] = [];
  const fixed: string[] = [];

  for (const item of items) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(item.localPath);
    } catch {
      errors.push(`File missing from downloads: ${item.localPath}`);
      continue;
    }

    const actualSha256 = await computeSha256(item.localPath);
    const actualContentSize = stat.size;
    const sha256Ok = actualSha256 === item.declaredSha256;
    const sizeOk = actualContentSize === item.declaredContentSize;

    if (sha256Ok && sizeOk) continue;

    if (!item.isExternal) {
      // Build-computed values should always match — flag as a real error
      errors.push(
        `Local asset mismatch for "${item.contentUrl}": ` +
          `sha256 ${sha256Ok ? "ok" : `${item.declaredSha256} → ${actualSha256}`}, ` +
          `contentSize ${sizeOk ? "ok" : `${item.declaredContentSize} → ${actualContentSize}`}`,
      );
      continue;
    }

    // External URL — update the source YAML with correct values
    const yamlPath = sourceYamlPath(cwd, item.docUrlPath);
    try {
      const updated = await fixYamlEntry(yamlPath, item.contentUrl, actualSha256, actualContentSize);
      if (updated) {
        const rel = path.relative(cwd, yamlPath);
        if (!sha256Ok) {
          console.log(`  sha256: ${item.declaredSha256.slice(0, 8)}... → ${actualSha256.slice(0, 8)}...`);
          fixed.push(`${rel}: sha256 corrected for ${path.basename(item.localPath)}`);
        }
        if (!sizeOk) {
          console.log(`  contentSize: ${item.declaredContentSize} → ${actualContentSize}`);
          fixed.push(`${rel}: contentSize corrected (${item.declaredContentSize} → ${actualContentSize})`);
        }
      } else {
        errors.push(`Mismatch for "${item.contentUrl}" but could not locate entry in ${yamlPath}`);
      }
    } catch (e) {
      errors.push(`Failed to update ${yamlPath}: ${(e as Error).message}`);
    }
  }

  return { errors, fixed };
}

// Validate image fields on resource documents (not downloaded — must exist as local assets)
async function validateImages(result: BuildResult, target: FileTarget | undefined): Promise<string[]> {
  const rootDomain = normalizeRootDomain(result.config.rootDomain);
  const assetByUrlPath = new Map(result.assets.map((a) => [a.urlPath, a]));
  const errors: string[] = [];

  for (const doc of result.documents) {
    if (target && !docMatchesTarget(doc.urlPath, target)) continue;
    const imageUrl = doc.document.image as string | undefined;
    if (typeof imageUrl !== "string") continue;

    const urlPath = imageUrl.startsWith(rootDomain) ? imageUrl.slice(rootDomain.length) : imageUrl;
    const asset = assetByUrlPath.get(urlPath);
    if (!asset) {
      errors.push(`${doc.outputPath}: image "${imageUrl}" has no matching local asset`);
    } else {
      try {
        await fs.stat(asset.sourcePath);
      } catch {
        errors.push(`${doc.outputPath}: local image file not found: "${asset.sourcePath}"`);
      }
    }
  }

  return errors;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const mode = args.includes("--mode=production") ? "production" : "development";
  const targetFilePath = args.find((a) => !a.startsWith("--"));
  const target = targetFilePath ? parseTargetFile(targetFilePath) : undefined;

  if (targetFilePath) {
    console.log(`Validating: ${targetFilePath}`);
    if (!target) {
      console.error(`Could not parse resource path from: ${targetFilePath}`);
      process.exitCode = 1;
      return;
    }
  }

  try {
    const result = await runBuild({ cwd, write: false, mode }, projectDefinition.schemaRegistry);
    const rootDomain = normalizeRootDomain(result.config.rootDomain);
    const downloadsDir = path.join(cwd, "test", "downloads");
    console.log(`Build: ${result.documents.length} documents, ${result.assets.length} assets`);

    // Image validation (local assets only, no download needed)
    const imageErrors = await validateImages(result, target);
    if (imageErrors.length > 0) {
      for (const e of imageErrors) console.error(`Error: ${e}`);
      process.exitCode = 1;
      return;
    }

    // Collect all media items (local + external)
    const items = collectItems(result, target, rootDomain, downloadsDir);
    if (items.length === 0) {
      console.log("Validation complete.");
      return;
    }

    // Copy local files and download external files into test/downloads/
    console.log(`\nPreparing ${items.length} file(s) in test/downloads/...`);
    const downloadErrors = await downloadAll(items);
    if (downloadErrors.length > 0) {
      for (const e of downloadErrors) console.error(`Error: ${e}`);
      process.exitCode = 1;
      return;
    }

    // Verify sha256 and contentSize from the downloaded files
    console.log(`\nVerifying ${items.length} file(s) in test/downloads/...`);
    const { errors: verifyErrors, fixed } = await verifyAll(cwd, items);

    if (fixed.length > 0) {
      console.log(`\nUpdated ${fixed.length} YAML value(s) — review and commit:`);
      for (const f of fixed) console.log(`  ${f}`);
    }

    if (verifyErrors.length > 0) {
      for (const e of verifyErrors) console.error(`Error: ${e}`);
      process.exitCode = 1;
      return;
    }

    console.log("Validation complete.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
