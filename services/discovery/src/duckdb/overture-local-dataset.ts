import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Local Overture places extracts: bounded regional GeoParquet subsets built by
 * `pnpm discovery:data`, stored outside Git under `.data/overture/`. Each
 * extract carries a manifest describing the release, area, bbox, schema
 * version, and row count so the adapter can prove a query is answerable
 * before trusting an empty result.
 */
export const OVERTURE_EXTRACT_SCHEMA_VERSION = "overture-extract-v1";
export const DEFAULT_OVERTURE_DATA_DIR = resolve(process.cwd(), "../../.data/overture");

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface OvertureExtractManifest {
  schemaVersion: string;
  release: string;
  area: string;
  bbox: BoundingBox;
  rowCount: number;
  retrievedAt: string;
}

export interface LocalOvertureDataset {
  parquetPath: string;
  manifest: OvertureExtractManifest;
}

/** Smallest manifest-described extract fully covering the query bbox, or null. */
export function findCoveringDataset(dataDir: string, query: BoundingBox): LocalOvertureDataset | null {
  if (!existsSync(dataDir)) return null;
  const candidates: Array<{ dataset: LocalOvertureDataset; areaSize: number }> = [];
  for (const entry of readdirSync(dataDir)) {
    if (!entry.endsWith(".manifest.json")) continue;
    let manifest: OvertureExtractManifest;
    try {
      manifest = JSON.parse(readFileSync(join(dataDir, entry), "utf8")) as OvertureExtractManifest;
    } catch {
      continue;
    }
    if (manifest.schemaVersion !== OVERTURE_EXTRACT_SCHEMA_VERSION) continue;
    const box = manifest.bbox;
    if (
      !box ||
      ![box.minLon, box.minLat, box.maxLon, box.maxLat].every((value) => Number.isFinite(value)) ||
      box.minLon > query.minLon ||
      box.minLat > query.minLat ||
      box.maxLon < query.maxLon ||
      box.maxLat < query.maxLat
    ) {
      continue;
    }
    const parquetPath = join(dataDir, entry.replace(/\.manifest\.json$/, ".parquet"));
    if (!existsSync(parquetPath)) continue;
    candidates.push({
      dataset: { parquetPath, manifest },
      areaSize: (box.maxLon - box.minLon) * (box.maxLat - box.minLat),
    });
  }
  candidates.sort((a, b) => a.areaSize - b.areaSize);
  return candidates[0]?.dataset ?? null;
}

export interface OvertureQueryExecutor {
  queryRows(sql: string): Promise<Array<Record<string, unknown>>>;
}

/** Lazy DuckDB-backed executor over local parquet files. */
export class DuckDbQueryExecutor implements OvertureQueryExecutor {
  private instancePromise: Promise<{ runAndReadAll: (sql: string) => Promise<unknown> }> | null = null;

  private async connection() {
    if (!this.instancePromise) {
      this.instancePromise = (async () => {
        const { DuckDBInstance } = await import("@duckdb/node-api");
        const instance = await DuckDBInstance.create(":memory:");
        return instance.connect();
      })();
    }
    return this.instancePromise;
  }

  async queryRows(sql: string): Promise<Array<Record<string, unknown>>> {
    const connection = (await this.connection()) as {
      runAndReadAll: (sql: string) => Promise<{ getRowObjects: () => Array<Record<string, unknown>> }>;
    };
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjects().map((row) => {
      const plain: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        plain[key] = typeof value === "bigint" ? Number(value) : value;
      }
      return plain;
    });
  }
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
