import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { projectDefinition } from "../project.js";
import { runBuild, type BuildResult } from "./engine.js";
import { normalizeRootDomain } from "./utils.js";
import type { JsonObject } from "./types.js";

interface FileTarget {
  resourceType: string;
  resourceId: string;
  versionId?: string;
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

function assetMatchesTarget(urlPath: string, target: FileTarget): boolean {
  if (target.versionId) {
    return urlPath.startsWith(`/${target.resourceType}/${target.resourceId}/versions/${target.versionId}/`);
  }
  return urlPath.startsWith(`/${target.resourceType}/${target.resourceId}/`) && !urlPath.includes("/versions/");
}

async function computeSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function validateFiles(result: BuildResult, target: FileTarget | undefined): Promise<string[]> {
  const rootDomain = normalizeRootDomain(result.config.rootDomain);
  const assetByUrlPath = new Map(result.assets.map((a) => [a.urlPath, a]));
  const errors: string[] = [];

  for (const doc of result.documents) {
    if (target && !docMatchesTarget(doc.urlPath, target)) continue;

    const document = doc.document;

    // Validate associatedMedia entries in version documents
    if (Array.isArray(document.associatedMedia)) {
      for (const media of document.associatedMedia as JsonObject[]) {
        const contentUrl = media.contentUrl as string | undefined;
        if (typeof contentUrl !== "string") continue;

        const urlPath = contentUrl.startsWith(rootDomain) ? contentUrl.slice(rootDomain.length) : contentUrl;
        const asset = assetByUrlPath.get(urlPath);

        if (!asset) {
          errors.push(`${doc.outputPath}: contentUrl "${contentUrl}" has no matching local asset`);
          continue;
        }

        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(asset.sourcePath);
        } catch {
          errors.push(`${doc.outputPath}: local file not found: "${asset.sourcePath}"`);
          continue;
        }

        const expectedSize = media.contentSize as number;
        if (stat.size !== expectedSize) {
          errors.push(
            `${doc.outputPath}: contentSize mismatch for "${urlPath}": declared ${expectedSize}, actual ${stat.size}`,
          );
        }

        const expectedHash = media.sha256 as string;
        const actualHash = await computeSha256(asset.sourcePath);
        if (actualHash !== expectedHash) {
          errors.push(
            `${doc.outputPath}: sha256 mismatch for "${urlPath}": declared ${expectedHash}, actual ${actualHash}`,
          );
        }
      }
    }

    // Validate image URL exists locally for resource documents
    const imageUrl = document.image as string | undefined;
    if (typeof imageUrl === "string") {
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
  }

  return errors;
}

async function copyDownloads(result: BuildResult, cwd: string, target: FileTarget | undefined): Promise<void> {
  const assets = target ? result.assets.filter((a) => assetMatchesTarget(a.urlPath, target)) : result.assets;
  if (assets.length === 0) return;

  const downloadsDir = path.join(cwd, "test", "downloads");
  for (const asset of assets) {
    const destPath = path.join(downloadsDir, asset.outputPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(asset.sourcePath, destPath);
    console.log(`Copied asset: ${asset.outputPath}`);
  }
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
    console.log(`Validation complete: ${result.documents.length} documents, ${result.assets.length} assets`);

    const errors = await validateFiles(result, target);
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    await copyDownloads(result, cwd, target);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
