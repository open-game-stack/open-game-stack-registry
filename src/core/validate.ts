import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { projectDefinition } from "../project.js";
import { runBuild, type BuildResult } from "./engine.js";
import { normalizeRootDomain } from "./utils.js";
import type { JsonObject } from "./types.js";

const execFileAsync = promisify(execFile);

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
  encodingFormat: string;
  declaredEntryPoint: string | undefined;
  isExternal: boolean;
}

interface MetadataFix {
  localPath: string;
  contentUrl: string;
  docUrlPath: string;
  field: string;
  oldValue: string | undefined;
  newValue: string;
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

// Classify a file by its archive kind for inspection purposes
function archiveKind(filePath: string): "zip" | "tar.gz" | "7z" | "appimage" | "skip" | null {
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "tar.gz";
  if (name.endsWith(".7z")) return "7z";
  if (name.endsWith(".appimage")) return "appimage";
  if (name.endsWith(".msi") || name.endsWith(".deb") || name.endsWith(".rpm") || name.endsWith(".pkg")) return "skip";
  return null;
}

// List all entry paths in a ZIP, tar.gz or 7z archive without extracting
async function listArchiveEntries(filePath: string, kind: "zip" | "tar.gz" | "7z"): Promise<string[]> {
  if (kind === "zip") {
    const { stdout } = await execFileAsync("unzip", ["-l", filePath], { timeout: 60_000 });
    const entries: string[] = [];
    for (const line of stdout.split("\n")) {
      // Each file line: "  LENGTH  MM-DD-YYYY HH:MM   name"
      const match = line.match(/^\s*\d+\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/);
      if (match?.[1]) entries.push(match[1].trimEnd());
    }
    return entries;
  }
  if (kind === "tar.gz") {
    const { stdout } = await execFileAsync("tar", ["-tzf", filePath], { timeout: 120_000 });
    return stdout.split("\n").filter((l) => l.trim() !== "");
  }
  if (kind === "7z") {
    const { stdout } = await execFileAsync("7z", ["l", filePath], { timeout: 120_000 });
    const entries: string[] = [];
    for (const line of stdout.split("\n")) {
      // Entry lines start with "YYYY-MM-DD HH:MM:SS" — name is at fixed offset 53
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(line) && line.length > 53) {
        entries.push(line.slice(53).trim());
      }
    }
    return entries;
  }
  return [];
}

// Check whether a declared entryPoint path exists among archive entries
function entryPointInArchive(entryPoint: string, entries: string[]): boolean {
  const ep = entryPoint.replace(/\/$/, "");
  return entries.some((e) => {
    const en = e.replace(/\/$/, "");
    return en === ep || en.startsWith(ep + "/");
  });
}

// Auto-detect the primary executable from an archive entry listing
function detectPrimaryExecutable(entries: string[]): string | undefined {
  // 1. .app bundle at depth ≤ 2 (root or one subfolder)
  for (const entry of entries) {
    const clean = entry.replace(/\/$/, "");
    const parts = clean.split("/");
    const last = parts[parts.length - 1] ?? "";
    if (last.endsWith(".app") && parts.length <= 2) {
      return parts.slice(0, parts.lastIndexOf(last) + 1).join("/");
    }
  }
  // 2. .exe files — prefer shallowest
  const exes = entries
    .filter((e) => !e.endsWith("/") && e.toLowerCase().endsWith(".exe"))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (exes.length > 0) return exes[0];
  // 3. Extension-less files in root or bin/ — prefer shallowest
  const noext = entries
    .filter((e) => {
      if (e.endsWith("/")) return false;
      const base = path.basename(e);
      if (base.includes(".")) return false;
      const depth = e.split("/").length;
      return depth <= 2 || e.includes("/bin/");
    })
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (noext.length > 0) return noext[0];
  return undefined;
}

// Detect Windows EXE type by scanning the binary for installer signatures
async function detectExeFormat(filePath: string): Promise<string> {
  const fd = await fs.open(filePath, "r");
  const buf = Buffer.alloc(512 * 1024);
  const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
  await fd.close();
  const snippet = buf.subarray(0, bytesRead).toString("latin1");
  if (snippet.includes("Nullsoft")) return "application/x-nsis";
  if (snippet.includes("Inno Setup")) return "application/x-inno-setup";
  return "application/vnd.microsoft.portable-executable";
}

// Detect the .app bundle inside a DMG by temporarily mounting it (macOS only).
// Searches the volume root first, then one level deep (some DMGs wrap the .app in a folder).
async function detectDmgEntryPoint(filePath: string): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  const mountPoint = path.join(os.tmpdir(), `validate-dmg-${Date.now()}`);
  await fs.mkdir(mountPoint, { recursive: true });
  try {
    await execFileAsync("hdiutil", ["attach", filePath, "-readonly", "-nobrowse", "-mountpoint", mountPoint], {
      timeout: 30_000,
    });
    const root = await fs.readdir(mountPoint);

    // Root-level .app
    const rootApp = root.find((e) => e.endsWith(".app"));
    if (rootApp) return rootApp;

    // One level deep — some DMGs place the .app inside a named subfolder
    for (const entry of root) {
      if (entry.startsWith(".")) continue;
      try {
        const sub = await fs.readdir(path.join(mountPoint, entry));
        const subApp = sub.find((e) => e.endsWith(".app"));
        if (subApp) return `${entry}/${subApp}`;
      } catch {
        // not a directory or unreadable
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    try {
      await execFileAsync("hdiutil", ["detach", mountPoint, "-quiet"], { timeout: 10_000 });
    } catch {
      // best-effort
    }
    try {
      await fs.rm(mountPoint, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

// Update or insert fields within a specific associatedMedia block in a YAML file
async function fixYamlFields(
  filePath: string,
  contentUrl: string,
  updates: Record<string, string | number>,
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
  const remaining = { ...updates };

  // First pass: update fields that already exist in the block
  for (let i = blockStart; i < blockEnd; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (line.search(/\S/) !== indent) continue;
    const t = line.trimStart();
    const colonIdx = t.indexOf(":");
    if (colonIdx === -1) continue;
    const key = t.slice(0, colonIdx);
    if (key in remaining) {
      lines[i] = `${" ".repeat(indent)}${key}: ${remaining[key]}`;
      delete remaining[key];
      changed = true;
    }
  }

  // Second pass: insert fields not yet present, anchored before sha256/contentSize
  if (Object.keys(remaining).length > 0) {
    let insertBefore = blockEnd;
    for (let i = blockStart; i < blockEnd; i++) {
      const line = lines[i] ?? "";
      if (line.trim() === "") continue;
      if (line.search(/\S/) !== indent) continue;
      const t = line.trimStart();
      if (t.startsWith("sha256:") || t.startsWith("contentSize:")) {
        insertBefore = i;
        break;
      }
    }
    const newLines = Object.entries(remaining).map(([k, v]) => `${" ".repeat(indent)}${k}: ${v}`);
    lines.splice(insertBefore, 0, ...newLines);
    changed = true;
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

      const encodingFormat = (media.encodingFormat as string | undefined) ?? "";
      const declaredEntryPoint = media.entryPoint as string | undefined;

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
          encodingFormat,
          declaredEntryPoint,
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
          encodingFormat,
          declaredEntryPoint,
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
      const fieldUpdates: Record<string, string | number> = {};
      if (!sha256Ok) fieldUpdates.sha256 = actualSha256;
      if (!sizeOk) fieldUpdates.contentSize = actualContentSize;
      const updated = await fixYamlFields(yamlPath, item.contentUrl, fieldUpdates);
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

// Inspect downloaded files: detect EXE installer type, DMG .app entry point, and archive entry points
async function inspectAll(items: DownloadItem[]): Promise<MetadataFix[]> {
  const fixes: MetadataFix[] = [];
  for (const item of items) {
    const filename = path.basename(item.localPath);
    const ext = path.extname(item.localPath).toLowerCase();
    const kind = archiveKind(item.localPath);

    if (ext === ".exe") {
      process.stdout.write(`  exe    ${filename} ...`);
      try {
        const detected = await detectExeFormat(item.localPath);
        const changed = detected !== item.encodingFormat;
        console.log(` ${detected}${changed ? ` (was: ${item.encodingFormat})` : " ok"}`);
        if (changed) {
          fixes.push({
            localPath: item.localPath,
            contentUrl: item.contentUrl,
            docUrlPath: item.docUrlPath,
            field: "encodingFormat",
            oldValue: item.encodingFormat,
            newValue: detected,
          });
        }
      } catch (e) {
        console.log(` error: ${(e as Error).message}`);
      }
    } else if (ext === ".dmg") {
      if (process.platform !== "darwin") {
        console.log(`  dmg    ${filename} (skipped — not macOS)`);
      } else {
        process.stdout.write(`  dmg    ${filename} mounting...`);
        try {
          const detected = await detectDmgEntryPoint(item.localPath);
          if (detected === undefined) {
            console.log(` no .app found`);
          } else {
            const changed = detected !== item.declaredEntryPoint;
            const current = item.declaredEntryPoint ?? "(none)";
            console.log(` ${detected}${changed ? ` (was: ${current})` : " ok"}`);
            if (changed) {
              fixes.push({
                localPath: item.localPath,
                contentUrl: item.contentUrl,
                docUrlPath: item.docUrlPath,
                field: "entryPoint",
                oldValue: item.declaredEntryPoint,
                newValue: detected,
              });
            }
          }
        } catch (e) {
          console.log(` error: ${(e as Error).message}`);
        }
      }
    } else if (kind === "zip" || kind === "tar.gz" || kind === "7z") {
      const tag = kind === "tar.gz" ? "tar" : kind;
      process.stdout.write(`  ${tag.padEnd(6)} ${filename} listing...`);
      try {
        const entries = await listArchiveEntries(item.localPath, kind);
        console.log(` ${entries.length} entries`);

        if (item.declaredEntryPoint) {
          const found = entryPointInArchive(item.declaredEntryPoint, entries);
          if (found) {
            console.log(`         entryPoint: ${item.declaredEntryPoint} ok`);
          } else {
            // Declared entry point not in archive — try auto-detect for a replacement
            const detected = detectPrimaryExecutable(entries);
            if (detected) {
              console.log(`         entryPoint: ${item.declaredEntryPoint} NOT FOUND → auto-detected: ${detected}`);
              fixes.push({
                localPath: item.localPath,
                contentUrl: item.contentUrl,
                docUrlPath: item.docUrlPath,
                field: "entryPoint",
                oldValue: item.declaredEntryPoint,
                newValue: detected,
              });
            } else {
              console.log(`         entryPoint: ${item.declaredEntryPoint} NOT FOUND (manual fix required)`);
            }
          }
        } else {
          // No entry point declared — try to auto-detect one
          const detected = detectPrimaryExecutable(entries);
          if (detected) {
            console.log(`         entryPoint: (none) → auto-detected: ${detected}`);
            fixes.push({
              localPath: item.localPath,
              contentUrl: item.contentUrl,
              docUrlPath: item.docUrlPath,
              field: "entryPoint",
              oldValue: undefined,
              newValue: detected,
            });
          } else {
            console.log(`         entryPoint: (none, could not auto-detect)`);
          }
        }
      } catch (e) {
        console.log(` error: ${(e as Error).message}`);
      }
    } else if (kind === "appimage") {
      console.log(`  skip   ${filename} (AppImage — self-executing)`);
    } else if (kind === "skip") {
      console.log(`  skip   ${filename} (installer/package — no entryPoint)`);
    } else {
      console.log(`  skip   ${filename} (unrecognised format)`);
    }
  }
  return fixes;
}

// Apply detected metadata fixes to source YAML files
async function applyMetadataFixes(cwd: string, fixes: MetadataFix[]): Promise<{ errors: string[]; fixed: string[] }> {
  const errors: string[] = [];
  const fixed: string[] = [];

  for (const fix of fixes) {
    const filename = path.basename(fix.localPath);
    const label = fix.oldValue !== undefined ? `${fix.oldValue} → ${fix.newValue}` : `(missing) → ${fix.newValue}`;
    console.log(`  ${fix.field}: ${label}  [${filename}]`);

    const yamlPath = sourceYamlPath(cwd, fix.docUrlPath);
    try {
      const updated = await fixYamlFields(yamlPath, fix.contentUrl, { [fix.field]: fix.newValue });
      if (updated) {
        const rel = path.relative(cwd, yamlPath);
        fixed.push(`${rel}: ${fix.field} ${label}`);
      } else {
        errors.push(`Could not update ${fix.field} for "${fix.contentUrl}" in ${yamlPath}`);
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
    const { errors: verifyErrors, fixed: verifyFixed } = await verifyAll(cwd, items);

    // Inspect files for encodingFormat and entryPoint correctness
    console.log(`\nInspecting ${items.length} file(s) for metadata...`);
    const metadataFixes = await inspectAll(items);
    const { errors: metaErrors, fixed: metaFixed } =
      metadataFixes.length > 0 ? await applyMetadataFixes(cwd, metadataFixes) : { errors: [], fixed: [] };

    const allFixed = [...verifyFixed, ...metaFixed];
    if (allFixed.length > 0) {
      console.log(`\nUpdated ${allFixed.length} YAML value(s) — review and commit:`);
      for (const f of allFixed) console.log(`  ${f}`);
    }

    const allErrors = [...verifyErrors, ...metaErrors];
    if (allErrors.length > 0) {
      for (const e of allErrors) console.error(`Error: ${e}`);
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
