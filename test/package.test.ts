import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_VERSION, VERSION } from "../src/version.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("package metadata", () => {
  const pkg = read("../package.json");
  const manifest = read("../server.json");
  const spec = read(`../openapi/openapi-${API_VERSION}.json`);

  it("keeps versions in step", () => {
    expect(VERSION).toBe(pkg.version);
    expect(manifest.version).toBe(pkg.version);
    for (const p of manifest.packages) expect(p.version).toBe(pkg.version);
    expect(manifest.name).toBe(pkg.mcpName);
  });

  it("targets the API version of the bundled OpenAPI snapshot", () => {
    expect(spec.info.version).toBe(API_VERSION);
  });
});
