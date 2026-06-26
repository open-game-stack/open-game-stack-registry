import { z } from "zod";

import type { JsonObject, JsonValue, ResourceTypeDefinition } from "../core/types.js";
import { resolvePublicUrl } from "../core/utils.js";

const HttpsUrl = z.string().min(8).max(256).startsWith("https://");
const PublicUrl = z.union([HttpsUrl, z.string().min(1).max(256).startsWith("/")]);

const GameSchema = z.object({
  type: z.literal("SoftwareApplication"),
  name: z.string().min(1).max(256),
  description: z.string().min(1).max(256),
  applicationCategory: z.string().min(1).max(64),
  publisher: z.string().min(3).max(256),
  url: PublicUrl,
  image: PublicUrl.optional(),
  keywords: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
});

const OS = z.enum(["windows", "macos", "linux", "android", "ios", "web"]);
const Arch = z.enum(["x86", "x86_64", "arm", "arm64", "wasm"]);

const LocalPath = z.string().min(1).max(256).startsWith("/");
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const GameFileSchema = z
  .object({
    name: z.string().min(1).max(128),
    contentUrl: z.union([HttpsUrl, LocalPath]),
    encodingFormat: z.string().min(1).max(128),
    license: HttpsUrl,
    operatingSystem: z.array(OS).min(1).optional(),
    processorRequirements: z.array(Arch).min(1).optional(),
    sha256: Sha256.optional(),
    contentSize: z.number().int().nonnegative().optional(),
  })
  .refine((f) => !f.contentUrl.startsWith("https://") || (f.sha256 !== undefined && f.contentSize !== undefined), {
    message: "sha256 and contentSize are required when contentUrl is an external https:// URL",
    path: ["sha256"],
  });

const GameVersionSchema = z.object({
  type: z.literal("SoftwareApplication"),
  version: z.string().min(1).max(64),
  datePublished: z.string().min(1).max(64),
  releaseNotes: z.string().min(1).max(256),
  associatedMedia: z.array(GameFileSchema).min(1).max(16),
});

const GameOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.literal("SoftwareApplication"),
  "@id": z.string().url(),
  name: z.string(),
  description: z.string(),
  applicationCategory: z.string(),
  keywords: z.array(z.string()).optional(),
  publisher: z.object({
    "@id": z.string().url(),
    "@type": z.literal("Organization"),
    name: z.string().optional(),
  }),
  url: z.string().url(),
  image: z.string().url().nullable().optional(),
  versions: z
    .array(
      z.object({
        "@id": z.string().url(),
        "@type": z.literal("SoftwareApplication"),
        name: z.string().optional(),
      }),
    )
    .optional(),
  latestVersion: z
    .object({
      "@id": z.string().url(),
      "@type": z.literal("SoftwareApplication"),
      name: z.string().optional(),
    })
    .optional(),
});

const GameVersionOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.literal("SoftwareApplication"),
  "@id": z.string().url(),
  name: z.string(),
  version: z.string(),
  datePublished: z.string(),
  releaseNotes: z.string(),
  isPartOf: z.object({
    "@id": z.string().url(),
    "@type": z.literal("SoftwareApplication"),
    name: z.string().optional(),
  }),
  associatedMedia: z.array(
    z.object({
      "@type": z.literal("MediaObject"),
      name: z.string(),
      contentSize: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      contentUrl: z.string().url(),
      encodingFormat: z.string(),
      license: z.string().url(),
      operatingSystem: z.array(z.string()).optional(),
      processorRequirements: z.array(z.string()).optional(),
    }),
  ),
});

export const gamesResourceType: ResourceTypeDefinition = {
  resourceSchema: GameSchema,
  versionSchema: GameVersionSchema,
  resourceJsonLdType: "SoftwareApplication",
  versionJsonLdType: "SoftwareApplication",
  allowedResourceTypes: ["SoftwareApplication"],
  allowedVersionTypes: ["SoftwareApplication"],
  resourceOutputSchema: GameOutputSchema,
  versionOutputSchema: GameVersionOutputSchema,
  compileResource({ resource, helper }) {
    const versionRefs = helper.versionReferences();
    const latestVersion = helper.latestVersionReference();

    return helper.makeJsonLdDocument("SoftwareApplication", {
      name: resource.data.name as string,
      description: resource.data.description as string,
      applicationCategory: (resource.data.applicationCategory as string).toLowerCase(),
      ...(resource.data.keywords ? { keywords: resource.data.keywords as string[] } : {}),
      publisher: helper.resolveInternalReference(resource.data.publisher as string),
      url: resolvePublicUrl(helper.rootDomain(), resource.data.url as string),
      ...(resource.data.image ? { image: resolvePublicUrl(helper.rootDomain(), resource.data.image as string) } : {}),
      ...(versionRefs.length > 0 ? { versions: versionRefs } : {}),
      ...(latestVersion ? { latestVersion } : {}),
    });
  },
  compileVersion({ resource, version, helper }) {
    return helper.makeJsonLdDocumentAt(helper.versionUrl(version.versionId), "SoftwareApplication", {
      name: `${resource.data.name as string} ${version.data.version as string}`,
      version: version.data.version as string,
      datePublished: version.data.datePublished as string,
      releaseNotes: version.data.releaseNotes as string,
      isPartOf: helper.toReferenceObject(helper.resourceUrl(), "SoftwareApplication", resource.data.name as string),
      associatedMedia: (
        version.data.associatedMedia as Array<{
          name: string;
          contentUrl: string;
          encodingFormat: string;
          license: string;
          operatingSystem?: string[];
          processorRequirements?: string[];
          sha256?: string;
          contentSize?: number;
        }>
      ).map((file) => {
        const sharedMetadata = {
          encodingFormat: file.encodingFormat,
          license: file.license,
          ...(file.operatingSystem ? { operatingSystem: file.operatingSystem as JsonValue } : {}),
          ...(file.processorRequirements ? { processorRequirements: file.processorRequirements as JsonValue } : {}),
        };
        const fileMetadata: JsonObject = file.contentUrl.startsWith("https://")
          ? {
              ...sharedMetadata,
              contentSize: file.contentSize as number,
              sha256: file.sha256 as string,
              contentUrl: file.contentUrl,
            }
          : (helper.copyAsset(
              { path: file.contentUrl, ...sharedMetadata },
              {
                resourceType: version.resourceType,
                resourceId: version.resourceId,
                versionId: version.versionId,
              },
            ) as JsonObject);
        return { "@type": "MediaObject", name: file.name, ...fileMetadata };
      }),
    });
  },
};
