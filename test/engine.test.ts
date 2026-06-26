import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import { runBuild } from "../src/core/engine.js";
import type { JsonObject, SchemaRegistry } from "../src/core/types.js";
import { resolvePublicUrl } from "../src/core/utils.js";
import { makeFixture, makeTestConfig } from "./helpers.js";

const registry: SchemaRegistry = {
  games: {
    resourceSchema: z.object({
      type: z.literal("SoftwareApplication"),
      name: z.string(),
      genre: z.string().optional(),
      publisher: z.string().optional(),
      image: z.string().optional(),
    }),
    versionSchema: z.object({
      type: z.literal("SoftwareSourceCode"),
      version: z.string(),
      datePublished: z.string(),
    }),
    resourceJsonLdType: "SoftwareApplication",
    versionJsonLdType: "SoftwareSourceCode",
    allowedResourceTypes: ["SoftwareApplication"],
    allowedVersionTypes: ["SoftwareSourceCode"],
    compileResource({ resource, helper }) {
      const fields: JsonObject = {
        name: resource.data.name as string,
        versions: helper.versionReferences(),
      };
      if (resource.data.genre) {
        fields.genre = resource.data.genre as string;
      }
      if (resource.data.publisher) {
        fields.publisher = helper.resolveInternalReference(resource.data.publisher as string);
      }
      if (resource.data.image) {
        fields.image = resolvePublicUrl("https://example.com", resource.data.image as string);
      }
      const latest = helper.latestVersionReference();
      if (latest) {
        fields.latestVersion = latest;
      }
      return helper.makeJsonLdDocument("SoftwareApplication", fields);
    },
    compileVersion({ version, helper }) {
      return helper.makeJsonLdDocumentAt(helper.versionUrl(version.versionId), "SoftwareSourceCode", {
        version: version.data.version as string,
        datePublished: version.data.datePublished as string,
      });
    },
  },
  publishers: {
    resourceSchema: z.object({
      type: z.literal("Organization"),
      name: z.string(),
    }),
    resourceJsonLdType: "Organization",
    allowedResourceTypes: ["Organization"],
    compileResource({ resource, helper }) {
      return helper.makeJsonLdDocument("Organization", {
        name: resource.data.name as string,
      });
    },
  },
};

test("builds resources, versions, latest alias, and search indexes", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
    "resources/games/test/index.yaml":
      "type: SoftwareApplication\nname: Test Game\ngenre: Action\npublisher: /publishers/acme\n",
    "resources/games/test/versions/1.2.0.yaml": "type: SoftwareSourceCode\nversion: 1.2.0\ndatePublished: 2024-01-01\n",
    "resources/games/test/versions/1.1.0.yaml": "type: SoftwareSourceCode\nversion: 1.1.0\ndatePublished: 2023-01-01\n",
  });

  const result = await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  assert.ok(result.documents.some((document) => document.outputPath === "games/test/versions/latest/index.json"));
  assert.ok(result.documents.some((document) => document.outputPath === "games/search/genre/action/index.json"));

  const latest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"));
  assert.equal(latest["@id"], "https://example.com/games/test/versions/1.2.0");

  const rootIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/index.json"), "utf8"));
  assert.equal(rootIndex.name, "Example API");
  // Search manifests are now in hasPart, not about
  assert.ok(rootIndex.hasPart.some((item: JsonObject) => item["@id"] === "https://example.com/games/search"));
  assert.equal(rootIndex["@type"], "DataCatalog");

  const publishersIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/publishers/index.json"), "utf8"));
  assert.equal(publishersIndex.itemListElement[0]["@type"], "ListItem");
  assert.equal(publishersIndex.itemListElement[0].item["@type"], "Organization");
  assert.equal(publishersIndex.itemListElement[0].item.name, "Acme Games");

  const gamesSearchIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/games/search/genre/action/index.json"), "utf8"),
  );
  assert.equal(gamesSearchIndex.itemListElement[0]["@type"], "ListItem");
  assert.equal(gamesSearchIndex.itemListElement[0].item["@type"], "SoftwareApplication");
  assert.equal(gamesSearchIndex.itemListElement[0].item.name, "Test Game");
});

test("writes formatted JSON in development mode and minified JSON in production mode", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ publishers: {} }), mode: "development" }, registry);
  const developmentJson = await fs.readFile(path.join(cwd, "out/publishers/acme/index.json"), "utf8");
  assert.match(developmentJson, /\n {2}"@context":/);

  await runBuild({ cwd, write: true, config: makeTestConfig({ publishers: {} }), mode: "production" }, registry);
  const productionJson = await fs.readFile(path.join(cwd, "out/publishers/acme/index.json"), "utf8");
  assert.doesNotMatch(productionJson, /\n {2}"@context":/);
  assert.ok(!productionJson.includes("\n"));
});

test("fails on duplicate YAML keys", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme\nname: Duplicate\n",
  });

  await assert.rejects(() => runBuild({ cwd, write: false, config: makeTestConfig({ publishers: {} }) }, registry));
});

test("fails with context when a referenced local asset does not exist", async () => {
  const assetRegistry: SchemaRegistry = {
    games: {
      resourceSchema: z.object({
        type: z.literal("SoftwareApplication"),
        name: z.string(),
      }),
      versionSchema: z.object({
        type: z.literal("SoftwareSourceCode"),
        version: z.string(),
        file: z.object({
          path: z.string(),
        }),
      }),
      resourceJsonLdType: "SoftwareApplication",
      versionJsonLdType: "SoftwareSourceCode",
      allowedResourceTypes: ["SoftwareApplication"],
      allowedVersionTypes: ["SoftwareSourceCode"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("SoftwareApplication", {
          name: resource.data.name as string,
        });
      },
      compileVersion({ version, helper }) {
        return helper.makeJsonLdDocumentAt(helper.versionUrl(version.versionId), "SoftwareSourceCode", {
          version: version.data.version as string,
          file: helper.copyAsset(
            { path: (version.data.file as JsonObject).path as string },
            {
              resourceType: version.resourceType,
              resourceId: version.resourceId,
              versionId: version.versionId,
            },
          ),
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/1.0.0.yaml":
      "type: SoftwareSourceCode\nversion: 1.0.0\nfile:\n  path: /games/test/files/missing.zip\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" }, assetRegistry),
    (error: unknown) =>
      error instanceof Error && error.message.includes("Referenced local asset does not exist") && "fieldPath" in error,
  );
});

test("copies same-origin resource images into the published output path", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\nimage: /games/test/index.jpg\n",
    "resources/games/test/index.jpg": "jpg payload",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);

  const resource = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/index.json"), "utf8"));
  assert.equal(resource.image, "https://example.com/games/test/index.jpg");
  assert.equal(await fs.readFile(path.join(cwd, "out/games/test/index.jpg"), "utf8"), "jpg payload");
});

test("resolves root-relative resource URLs against the configured root domain", async () => {
  const urlRegistry: SchemaRegistry = {
    games: {
      resourceSchema: z.object({
        type: z.literal("SoftwareApplication"),
        name: z.string(),
        url: z.string(),
        image: z.string().optional(),
      }),
      resourceJsonLdType: "SoftwareApplication",
      allowedResourceTypes: ["SoftwareApplication"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("SoftwareApplication", {
          name: resource.data.name as string,
          url: resolvePublicUrl(helper.rootDomain(), resource.data.url as string),
          image: resource.data.image ? resolvePublicUrl(helper.rootDomain(), resource.data.image as string) : null,
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/games/test/index.yaml":
      "type: SoftwareApplication\nname: Test Game\nurl: /games/test\nimage: /games/test/index.jpg\n",
    "resources/games/test/index.jpg": "jpg payload",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, urlRegistry);

  const resource = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/index.json"), "utf8"));
  assert.equal(resource.url, "https://example.com/games/test");
  assert.equal(resource.image, "https://example.com/games/test/index.jpg");
});

test("fails when a same-origin resource image is missing", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\nimage: /games/test/index.jpg\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" }, registry),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Referenced local asset does not exist") &&
      "fieldPath" in error &&
      error.fieldPath === "image",
  );
});

test("rebuilds latest alias to the next-highest version when the highest version is removed", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/2.0.0.yaml": "type: SoftwareSourceCode\nversion: 2.0.0\ndatePublished: 2025-01-01\n",
    "resources/games/test/versions/1.0.0.yaml": "type: SoftwareSourceCode\nversion: 1.0.0\ndatePublished: 2024-01-01\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);
  let latest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"));
  assert.equal(latest.version, "2.0.0");

  await fs.rm(path.join(cwd, "resources/games/test/versions/2.0.0.yaml"));
  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }), mode: "development" }, registry);

  latest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/latest/index.json"), "utf8"));
  assert.equal(latest.version, "1.0.0");
});

test("creates empty attribute search indexes when no resources match", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
  });

  await runBuild(
    { cwd, write: true, config: makeTestConfig({ games: { searchAttributes: ["genre"] } }), mode: "development" },
    registry,
  );

  const attributeIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/genre/index.json"), "utf8"));
  assert.deepEqual(attributeIndex.itemListElement, []);
});

test("fails when a declared resource type is incompatible with its directory resource type", async () => {
  const mismatchRegistry: SchemaRegistry = {
    publishers: {
      resourceSchema: z.object({
        type: z.string(),
        name: z.string(),
      }),
      resourceJsonLdType: "Organization",
      allowedResourceTypes: ["Organization"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Organization", {
          name: resource.data.name as string,
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: SoftwareApplication\nname: Wrong Type\n",
  });

  await assert.rejects(
    () =>
      runBuild(
        { cwd, write: false, config: makeTestConfig({ publishers: {} }), mode: "development" },
        mismatchRegistry,
      ),
    (error: unknown) => error instanceof Error && error.message.includes("Declared resource type is incompatible"),
  );
});

test("fails when an internal reference target does not exist", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\npublisher: /publishers/missing\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ games: {} }), mode: "development" }, registry),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Referenced internal resource or version does not exist") &&
      "referencePath" in error,
  );
});

test("indexes arrays, numbers, booleans and ignores empty, missing, and mixed values", async () => {
  const indexingRegistry: SchemaRegistry = {
    items: {
      resourceSchema: z.object({
        type: z.literal("Thing"),
        name: z.string(),
        tags: z.array(z.string()).optional(),
        rating: z.number().optional(),
        featured: z.boolean().optional(),
        emptyLabel: z.string().optional(),
        maybeNull: z.string().nullable().optional(),
        mixed: z.array(z.union([z.string(), z.object({ bad: z.string() })])).optional(),
      }),
      resourceJsonLdType: "Thing",
      allowedResourceTypes: ["Thing"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Thing", {
          name: resource.data.name as string,
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/items/alpha/index.yaml": [
      "type: Thing",
      "name: Alpha",
      "tags:",
      "  - red",
      "  - blue",
      "rating: 5",
      "featured: true",
      'emptyLabel: ""',
      "maybeNull: null",
      "mixed:",
      "  - valid",
      "  - bad: nope",
      "",
    ].join("\n"),
  });

  await runBuild(
    {
      cwd,
      write: true,
      mode: "development",
      config: makeTestConfig({
        items: {
          searchAttributes: ["tags", "rating", "featured", "emptyLabel", "missing", "maybeNull", "mixed"],
        },
      }),
    },
    indexingRegistry,
  );

  const tagsIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/items/search/tags/red/index.json"), "utf8"));
  assert.equal(tagsIndex.itemListElement[0].item.name, "Alpha");

  const ratingIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/items/search/rating/5/index.json"), "utf8"));
  assert.equal(ratingIndex.about.find((a: JsonObject) => a["@type"] === "DefinedTerm")?.name, "5");

  const featuredIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/featured/true/index.json"), "utf8"),
  );
  assert.equal(featuredIndex.about.find((a: JsonObject) => a["@type"] === "DefinedTerm")?.name, "true");

  const emptyAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/emptyLabel/index.json"), "utf8"),
  );
  assert.deepEqual(emptyAttributeIndex.itemListElement, []);

  const missingAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/missing/index.json"), "utf8"),
  );
  assert.deepEqual(missingAttributeIndex.itemListElement, []);

  const nullAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/maybeNull/index.json"), "utf8"),
  );
  assert.deepEqual(nullAttributeIndex.itemListElement, []);

  const mixedAttributeIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/items/search/mixed/index.json"), "utf8"),
  );
  assert.deepEqual(mixedAttributeIndex.itemListElement, []);
});

test("fails with detailed diagnostics for search normalization collisions", async () => {
  const cwd = await makeFixture({
    "resources/items/first/index.yaml": "type: Thing\nname: First Item\ntag: C++\n",
    "resources/items/second/index.yaml": "type: Thing\nname: Second Item\ntag: C\n",
  });

  const indexingRegistry: SchemaRegistry = {
    items: {
      resourceSchema: z.object({
        type: z.literal("Thing"),
        name: z.string(),
        tag: z.string(),
      }),
      resourceJsonLdType: "Thing",
      allowedResourceTypes: ["Thing"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Thing", {
          name: resource.data.name as string,
        });
      },
    },
  };

  await assert.rejects(
    () =>
      runBuild(
        {
          cwd,
          write: false,
          mode: "development",
          config: makeTestConfig({
            items: {
              searchAttributes: ["tag"],
            },
          }),
        },
        indexingRegistry,
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Search value normalization collision detected") &&
      "normalizedValue" in error &&
      "originalValue" in error &&
      "conflictingSource" in error,
  );
});

test("fails with detailed diagnostics for reserved path segments", async () => {
  const cwd = await makeFixture({
    "resources/publishers/search/index.yaml": "type: Organization\nname: Reserved\n",
  });

  await assert.rejects(
    () => runBuild({ cwd, write: false, config: makeTestConfig({ publishers: {} }), mode: "development" }, registry),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("reserved generated path segment") &&
      "originalValue" in error &&
      "normalizedValue" in error,
  );
});

test("allows circular references without recursive compile loops", async () => {
  const circularRegistry: SchemaRegistry = {
    nodes: {
      resourceSchema: z.object({
        type: z.literal("Thing"),
        name: z.string(),
        related: z.string(),
      }),
      resourceJsonLdType: "Thing",
      allowedResourceTypes: ["Thing"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("Thing", {
          name: resource.data.name as string,
          related: helper.resolveInternalReference(resource.data.related as string),
        });
      },
    },
  };

  const cwd = await makeFixture({
    "resources/nodes/alpha/index.yaml": "type: Thing\nname: Alpha\nrelated: /nodes/beta\n",
    "resources/nodes/beta/index.yaml": "type: Thing\nname: Beta\nrelated: /nodes/alpha\n",
  });

  await runBuild(
    {
      cwd,
      write: true,
      mode: "development",
      config: makeTestConfig({ nodes: {} }),
    },
    circularRegistry,
  );

  const alpha = JSON.parse(await fs.readFile(path.join(cwd, "out/nodes/alpha/index.json"), "utf8"));
  const beta = JSON.parse(await fs.readFile(path.join(cwd, "out/nodes/beta/index.json"), "utf8"));

  assert.equal(alpha.related["@id"], "https://example.com/nodes/beta");
  assert.equal(beta.related["@id"], "https://example.com/nodes/alpha");
});

test("fails cleanly when the configured resources root is not a readable directory", async () => {
  const cwd = await makeFixture({
    resources: "not a directory",
  });

  await assert.rejects(
    () =>
      runBuild(
        {
          cwd,
          write: false,
          mode: "development",
          config: {
            ...makeTestConfig(),
            resourcesRoot: "resources",
          },
        },
        registry,
      ),
    (error: unknown) => error instanceof Error && error.message.includes("Required source directory cannot be read"),
  );
});

test("generates consistent root, collection, search, and version index documents", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml":
      "type: Organization\nname: Acme Games\ndescription: Publisher\nurl: https://example.com/publishers/acme\n",
    "resources/games/test/index.yaml": [
      "type: SoftwareApplication",
      "name: Test Game",
      "description: Example game",
      "genre: Action",
      "publisher: /publishers/acme",
      "url: https://example.com/games/test",
      "",
    ].join("\n"),
    "resources/games/test/versions/1.0.0.yaml": [
      "type: SoftwareSourceCode",
      "version: 1.0.0",
      "datePublished: 2024-01-01",
      "releaseNotes: First release",
      "files:",
      "  - name: Test Game macOS",
      "    path: /games/test/assets/test-game-1.0.0.zip",
      "    encodingFormat: application/zip",
      "    license: https://spdx.org/licenses/CC0-1.0.html",
      "",
    ].join("\n"),
    "resources/games/test/assets/test-game-1.0.0.zip": "zip payload",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  const rootIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/index.json"), "utf8"));
  assert.equal(rootIndex["@type"], "DataCatalog");
  // Collections and search manifests are all in hasPart as ItemList
  assert.equal(rootIndex.hasPart[0]["@type"], "ItemList");
  assert.ok(rootIndex.hasPart.some((h: JsonObject) => h["@id"] === "https://example.com/games/search"));
  assert.ok(!rootIndex.about, "root should not have about");

  const collectionIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/index.json"), "utf8"));
  assert.ok(!collectionIndex.about, "collection should not have about");
  assert.equal(collectionIndex.itemListElement[0].item["@id"], "https://example.com/games/test");
  assert.equal(collectionIndex.$schema, "https://example.com/schema/collection");

  const searchManifest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/index.json"), "utf8"));
  assert.equal(searchManifest.about[0]["@id"], "https://example.com/games");
  assert.equal(searchManifest.itemListElement[0].item["@id"], "https://example.com/games/search/genre");

  const searchValueIndex = JSON.parse(
    await fs.readFile(path.join(cwd, "out/games/search/genre/action/index.json"), "utf8"),
  );
  assert.equal(searchValueIndex.about[0]["@id"], "https://example.com/games");
  // value is now a DefinedTerm in about, not a top-level property
  const definedTerm = searchValueIndex.about.find((a: JsonObject) => a["@type"] === "DefinedTerm");
  assert.equal(definedTerm?.name, "Action");
  assert.ok(!searchValueIndex.value, "value property should be removed");

  const versionIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/index.json"), "utf8"));
  assert.equal(versionIndex.about[0]["@id"], "https://example.com/games/test");
  assert.equal(versionIndex.itemListElement[0]["@type"], "ListItem");
  assert.equal(versionIndex.itemListElement[0].item["@type"], "SoftwareSourceCode");
  assert.equal(versionIndex.itemListElement[0].position, undefined);
});

test("generates documentation with example requests and example responses", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml":
      "type: Organization\nname: Acme Games\ndescription: Publisher\nurl: https://example.com/publishers/acme\n",
    "resources/games/test/index.yaml": [
      "type: SoftwareApplication",
      "name: Test Game",
      "description: Example game",
      "genre: Action",
      "publisher: /publishers/acme",
      "url: https://example.com/games/test",
      "tags:",
      "  - action",
      "",
    ].join("\n"),
    "resources/games/test/versions/1.0.0.yaml": [
      "type: SoftwareSourceCode",
      "version: 1.0.0",
      "datePublished: 2024-01-01",
      "releaseNotes: First release",
      "files:",
      "  - name: Test Game macOS",
      "    path: /games/test/assets/test-game-1.0.0.zip",
      "    encodingFormat: application/zip",
      "    license: https://spdx.org/licenses/CC0-1.0.html",
      "",
    ].join("\n"),
    "resources/games/test/assets/test-game-1.0.0.zip": "zip payload",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  const docsHtml = await fs.readFile(path.join(cwd, "out/docs/index.html"), "utf8");
  assert.match(docsHtml, /Example Request:/);
  assert.match(docsHtml, /Example Response:/);
  assert.match(docsHtml, /https:\/\/example\.com\/games\/test/);
  assert.match(docsHtml, /https:\/\/example\.com\/games\/test\/versions\/1\.0\.0/);
  assert.match(docsHtml, /https:\/\/example\.com\/games\/search/);
});

test("publishes machine-readable type definitions for generated document shapes", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
    "resources/games/test/index.yaml":
      "type: SoftwareApplication\nname: Test Game\ngenre: Action\npublisher: /publishers/acme\n",
    "resources/games/test/versions/1.0.0.yaml": "type: SoftwareSourceCode\nversion: 1.0.0\ndatePublished: 2024-01-01\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig(), mode: "development" }, registry);

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, "out/schema/index.json"), "utf8"));
  assert.equal(manifest.apiName, "Example API");
  assert.ok(manifest.definitions.some((entry: { name: string }) => entry.name === "root"));
  assert.ok(manifest.definitions.some((entry: { name: string }) => entry.name === "games-resource"));
  assert.ok(manifest.definitions.some((entry: { name: string }) => entry.name === "games-version"));

  // Check that manifest paths are directory-based (no filenames)
  const gamesResourceDef = manifest.definitions.find((entry: { name: string }) => entry.name === "games-resource");
  assert.equal(gamesResourceDef.path, "/schema/games");
  assert.equal(gamesResourceDef.url, "https://example.com/schema/games");

  const gamesVersionDef = manifest.definitions.find((entry: { name: string }) => entry.name === "games-version");
  assert.equal(gamesVersionDef.path, "/schema/games/versions");
  assert.equal(gamesVersionDef.url, "https://example.com/schema/games/versions");

  const rootIndexSchema = JSON.parse(await fs.readFile(path.join(cwd, "out/schema/root/index.json"), "utf8"));
  assert.equal(rootIndexSchema["$id"], "https://example.com/schema/root");
  assert.equal(rootIndexSchema.type, "object");
  assert.ok(rootIndexSchema.required.includes("@context"));
  assert.ok(rootIndexSchema.required.includes("hasPart"));

  const resourceSchema = JSON.parse(await fs.readFile(path.join(cwd, "out/schema/games/index.json"), "utf8"));
  assert.equal(resourceSchema["$id"], "https://example.com/schema/games");
  assert.equal(resourceSchema.type, "object");
  assert.ok(resourceSchema.required.includes("@context"));
});

test("resolves publisher name into internal reference objects", async () => {
  const cwd = await makeFixture({
    "resources/publishers/acme/index.yaml": "type: Organization\nname: Acme Games\n",
    "resources/games/test/index.yaml":
      "type: SoftwareApplication\nname: Test Game\ngenre: Action\npublisher: /publishers/acme\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {}, publishers: {} }) }, registry);

  const game = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/index.json"), "utf8"));
  assert.equal(game.publisher["@id"], "https://example.com/publishers/acme");
  assert.equal(game.publisher["@type"], "Organization");
  assert.equal(game.publisher.name, "Acme Games");
});

test("includes name in version list items and latest version reference", async () => {
  const cwd = await makeFixture({
    "resources/games/test/index.yaml": "type: SoftwareApplication\nname: Test Game\n",
    "resources/games/test/versions/1.0.0.yaml": "type: SoftwareSourceCode\nversion: 1.0.0\ndatePublished: 2024-01-01\n",
  });

  await runBuild({ cwd, write: true, config: makeTestConfig({ games: {} }) }, registry);

  const versionIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/versions/index.json"), "utf8"));
  assert.equal(versionIndex.itemListElement[0].item.name, "Test Game 1.0.0");

  const game = JSON.parse(await fs.readFile(path.join(cwd, "out/games/test/index.json"), "utf8"));
  assert.equal(game.latestVersion?.name, "Test Game 1.0.0");
});

test("generates substring name search indexes covering all character positions", async () => {
  const cwd = await makeFixture({
    "resources/games/alpha/index.yaml": "type: SoftwareApplication\nname: Alpha\n",
    "resources/games/beta/index.yaml": "type: SoftwareApplication\nname: Beta\n",
  });

  const substringRegistry: SchemaRegistry = {
    games: {
      resourceSchema: z.object({ type: z.literal("SoftwareApplication"), name: z.string() }),
      resourceJsonLdType: "SoftwareApplication",
      allowedResourceTypes: ["SoftwareApplication"],
      compileResource({ resource, helper }) {
        return helper.makeJsonLdDocument("SoftwareApplication", { name: resource.data.name as string });
      },
    },
  };

  await runBuild(
    {
      cwd,
      write: true,
      config: makeTestConfig({ games: { searchAttributes: [{ attribute: "name", strategy: "substring" as const }] } }),
      mode: "development",
    },
    substringRegistry,
  );

  // "a" appears in both "alpha" and "beta"
  const aIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/name/a/index.json"), "utf8"));
  assert.equal(aIndex.itemListElement.length, 2);
  assert.equal(aIndex.itemListElement[0].position, undefined);

  // "al" appears only in "alpha"
  const alIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/name/al/index.json"), "utf8"));
  assert.equal(alIndex.itemListElement.length, 1);
  assert.equal(alIndex.itemListElement[0].item.name, "Alpha");

  // "et" appears only in "beta"
  const etIndex = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/name/et/index.json"), "utf8"));
  assert.equal(etIndex.itemListElement.length, 1);
  assert.equal(etIndex.itemListElement[0].item.name, "Beta");

  // name manifest lists single-char entries only
  const nameManifest = JSON.parse(await fs.readFile(path.join(cwd, "out/games/search/name/index.json"), "utf8"));
  assert.ok(nameManifest.itemListElement.every((item: JsonObject) => {
    const id = (item.item as JsonObject)["@id"] as string;
    const lastSegment = id.split("/").at(-1) ?? "";
    return lastSegment.length === 1;
  }));
});
