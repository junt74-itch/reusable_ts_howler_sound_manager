import { CatalogFailureError } from "./errors.js";

/** Raw catalog JSON shape (version 1). */
export interface CatalogJson {
  version: number;
  resources: Record<string, { src: string[] }>;
  groups: Record<string, string[]>;
}

export interface RegisteredResource {
  readonly urls: readonly string[];
}

/**
 * Validates and stores catalog definitions. Does not load audio files.
 */
export class Catalog {
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly groups = new Map<string, readonly string[]>();

  get size(): number {
    return this.resources.size;
  }

  hasResource(soundId: string): boolean {
    return this.resources.has(soundId);
  }

  hasGroup(groupName: string): boolean {
    return this.groups.has(groupName);
  }

  getResource(soundId: string): RegisteredResource | undefined {
    return this.resources.get(soundId);
  }

  getGroupSoundIds(groupName: string): readonly string[] | undefined {
    return this.groups.get(groupName);
  }

  clear(): void {
    this.resources.clear();
    this.groups.clear();
  }

  async loadFromUrl(
    catalogUrl: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetchFn(catalogUrl);
    } catch (error) {
      throw new CatalogFailureError(
        `Failed to fetch catalog: ${catalogUrl}`,
        error,
      );
    }

    if (!response.ok) {
      throw new CatalogFailureError(
        `Failed to fetch catalog: ${catalogUrl} (${response.status})`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new CatalogFailureError(
        `Failed to parse catalog JSON: ${catalogUrl}`,
        error,
      );
    }

    this.registerParsed(json, response.url || catalogUrl);
  }

  registerParsed(json: unknown, catalogUrl: string): void {
    const catalog = parseCatalogJson(json);
    this.registerCatalog(catalog, catalogUrl);
  }

  private registerCatalog(catalog: CatalogJson, catalogUrl: string): void {
    if (catalog.version !== 1) {
      throw new CatalogFailureError(
        `Unsupported catalog version: ${String(catalog.version)}`,
      );
    }

    const newResources = parseResources(catalog.resources, catalogUrl);
    for (const soundId of newResources.keys()) {
      if (this.resources.has(soundId)) {
        throw new CatalogFailureError(`Duplicate sound ID: ${soundId}`);
      }
    }

    const knownResources = new Map(this.resources);
    for (const [soundId, resource] of newResources) {
      knownResources.set(soundId, resource);
    }

    const newGroups = parseGroups(catalog.groups, knownResources);
    for (const groupName of newGroups.keys()) {
      if (this.groups.has(groupName)) {
        throw new CatalogFailureError(`Duplicate group name: ${groupName}`);
      }
    }

    for (const [soundId, resource] of newResources) {
      this.resources.set(soundId, resource);
    }
    for (const [groupName, soundIds] of newGroups) {
      this.groups.set(groupName, soundIds);
    }
  }
}

function parseCatalogJson(json: unknown): CatalogJson {
  if (!json || typeof json !== "object") {
    throw new CatalogFailureError("Catalog JSON must be an object");
  }

  const record = json as Record<string, unknown>;
  if (typeof record.version !== "number") {
    throw new CatalogFailureError("Catalog version must be a number");
  }
  if (!record.resources || typeof record.resources !== "object") {
    throw new CatalogFailureError("Catalog resources must be an object");
  }
  if (!record.groups || typeof record.groups !== "object") {
    throw new CatalogFailureError("Catalog groups must be an object");
  }

  return {
    version: record.version,
    resources: record.resources as CatalogJson["resources"],
    groups: record.groups as CatalogJson["groups"],
  };
}

function parseResources(
  resources: CatalogJson["resources"],
  catalogUrl: string,
): Map<string, RegisteredResource> {
  const parsed = new Map<string, RegisteredResource>();

  for (const [soundId, definition] of Object.entries(resources)) {
    if (!definition || typeof definition !== "object") {
      throw new CatalogFailureError(`Invalid resource definition: ${soundId}`);
    }

    const src = definition.src;
    if (!Array.isArray(src) || src.length === 0) {
      throw new CatalogFailureError(
        `Resource ${soundId} must have a non-empty src array`,
      );
    }

    const urls: string[] = [];
    for (const entry of src) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new CatalogFailureError(
          `Resource ${soundId} src entries must be non-empty strings`,
        );
      }
      urls.push(resolveCatalogUrl(entry, catalogUrl));
    }

    parsed.set(soundId, { urls });
  }

  return parsed;
}

function parseGroups(
  groups: CatalogJson["groups"],
  resources: Map<string, RegisteredResource>,
): Map<string, readonly string[]> {
  const parsed = new Map<string, readonly string[]>();

  for (const [groupName, soundIds] of Object.entries(groups)) {
    if (!Array.isArray(soundIds)) {
      throw new CatalogFailureError(`Group ${groupName} must be an array`);
    }

    for (const soundId of soundIds) {
      if (typeof soundId !== "string" || soundId.length === 0) {
        throw new CatalogFailureError(
          `Group ${groupName} contains an invalid sound ID`,
        );
      }
      if (!resources.has(soundId)) {
        throw new CatalogFailureError(
          `Group ${groupName} references unknown sound ID: ${soundId}`,
        );
      }
    }

    parsed.set(groupName, [...soundIds]);
  }

  return parsed;
}

function resolveCatalogUrl(src: string, catalogUrl: string): string {
  try {
    const baseUrl = toAbsoluteCatalogBase(catalogUrl);
    return new URL(src, baseUrl).href;
  } catch (error) {
    throw new CatalogFailureError(`Invalid catalog URL: ${catalogUrl}`, error);
  }
}

function toAbsoluteCatalogBase(catalogUrl: string): string {
  try {
    return new URL(catalogUrl).href;
  } catch {
    return new URL(catalogUrl, "https://sound-manager.local/").href;
  }
}
