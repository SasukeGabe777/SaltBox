/**
 * Build a bounded regional Overture places extract for local discovery.
 *
 * One operator-triggered run reads the public Overture GeoParquet release
 * (bbox-filtered, places only, selected columns) and writes a small local
 * parquet + manifest under the git-ignored .data/overture directory. The
 * discovery adapter then answers queries entirely from that local file.
 *
 * Usage:
 *   pnpm discovery:data --location "Ogden, UT" --radius-km 30
 *   pnpm discovery:data --location "Salt Lake City, UT" --radius-km 25 --release 2026-08-19.0
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_OVERTURE_RELEASE,
} from "../src/adapters/overture.ts";
import { radiusBoundingBox } from "../src/adapters/overture.ts";
import {
  DEFAULT_OVERTURE_DATA_DIR,
  OVERTURE_EXTRACT_SCHEMA_VERSION,
  sqlStringLiteral,
  type OvertureExtractManifest,
} from "../src/duckdb/overture-local-dataset.ts";
import { NominatimResolver } from "../src/location/nominatim.ts";
import { DiscoverySourceError } from "../src/errors.ts";

const MAX_EXTRACT_RADIUS_KM = 100;

const { values } = parseArgs({
  options: {
    location: { type: "string", short: "l" },
    "radius-km": { type: "string", default: "30" },
    release: { type: "string", default: DEFAULT_OVERTURE_RELEASE },
    area: { type: "string" },
    "data-dir": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.location) {
  console.error(
    'Usage: pnpm discovery:data --location "Ogden, UT" [--radius-km 30] ' +
      `[--release ${DEFAULT_OVERTURE_RELEASE}] [--area ogden-ut] [--data-dir .data/overture]`,
  );
  process.exit(values.help ? 0 : 1);
}

const radiusKm = Number(values["radius-km"]);
if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > MAX_EXTRACT_RADIUS_KM) {
  console.error(`--radius-km must be between 1 and ${MAX_EXTRACT_RADIUS_KM}.`);
  process.exit(1);
}
const release = values.release!.trim();
if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$/.test(release)) {
  console.error(`--release must look like ${DEFAULT_OVERTURE_RELEASE}.`);
  process.exit(1);
}
const dataDir = values["data-dir"] ? resolve(values["data-dir"]) : DEFAULT_OVERTURE_DATA_DIR;

const resolver = new NominatimResolver({
  userAgent: process.env.SALTBOX_DISCOVERY_USER_AGENT ?? "SaltBox-Discovery/0.1 (+https://github.com/SasukeGabe777/SaltBox)",
});

try {
  console.log(`\nOVERTURE EXTRACT · release ${release}`);
  const location = await resolver.resolveLocation(values.location);
  console.log(`Location resolved: ${location.displayName}`);
  const bbox = radiusBoundingBox(location.latitude, location.longitude, radiusKm);
  const area =
    values.area?.trim() ||
    location.query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const baseName = `${area}-r${Math.round(radiusKm)}km-${release}`;
  mkdirSync(dataDir, { recursive: true });
  const parquetPath = resolve(dataDir, `${baseName}.parquet`).replaceAll("\\", "/");
  const manifestPath = resolve(dataDir, `${baseName}.manifest.json`);

  console.log(`Area: ${area} · radius ${radiusKm} km`);
  console.log(`bbox: [${bbox.minLon.toFixed(4)}, ${bbox.minLat.toFixed(4)}] → [${bbox.maxLon.toFixed(4)}, ${bbox.maxLat.toFixed(4)}]`);
  console.log("Reading public Overture GeoParquet (bounded bbox scan, one-time)...\n");

  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run("INSTALL httpfs; LOAD httpfs;");
  await connection.run("CREATE OR REPLACE SECRET overture (TYPE s3, REGION 'us-west-2');");

  const remote = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;
  const describeReader = await connection.runAndReadAll(
    `DESCRIBE SELECT * FROM read_parquet(${sqlStringLiteral(remote)}, hive_partitioning=1)`,
  );
  const remoteColumns = new Set(
    describeReader.getRowObjects().map((row) => String((row as { column_name: unknown }).column_name)),
  );
  const operatingStatusSelect = remoteColumns.has("operating_status")
    ? "    operating_status,"
    : "    NULL AS operating_status,";
  const copySql = [
    "COPY (",
    "  SELECT",
    "    id AS external_id,",
    "    names.\"primary\" AS name,",
    "    bbox.ymin AS lat,",
    "    bbox.xmin AS lon,",
    "    categories.\"primary\" AS category_primary,",
    "    confidence,",
    operatingStatusSelect,
    "    to_json(websites)::VARCHAR AS websites_json,",
    "    to_json(phones)::VARCHAR AS phones_json,",
    "    to_json(emails)::VARCHAR AS emails_json,",
    "    to_json(addresses[1])::VARCHAR AS address_json,",
    "    to_json(sources)::VARCHAR AS sources_json",
    `  FROM read_parquet(${sqlStringLiteral(remote)}, hive_partitioning=1)`,
    `  WHERE bbox.xmin BETWEEN ${bbox.minLon} AND ${bbox.maxLon}`,
    `    AND bbox.ymin BETWEEN ${bbox.minLat} AND ${bbox.maxLat}`,
    `) TO ${sqlStringLiteral(parquetPath)} (FORMAT PARQUET);`,
  ].join("\n");
  await connection.run(copySql);

  const countReader = await connection.runAndReadAll(
    `SELECT count(*) AS n FROM read_parquet(${sqlStringLiteral(parquetPath)})`,
  );
  const rowCount = Number((countReader.getRowObjects()[0] as { n: unknown }).n);
  connection.closeSync();
  instance.closeSync();

  const manifest: OvertureExtractManifest = {
    schemaVersion: OVERTURE_EXTRACT_SCHEMA_VERSION,
    release,
    area,
    bbox,
    rowCount,
    retrievedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Extract written: ${parquetPath}`);
  console.log(`Manifest:        ${manifestPath}`);
  console.log(`Places in area:  ${rowCount}`);
  console.log("\nAttribution: Overture Maps Foundation, overturemaps.org (CDLA Permissive 2.0 / Apache 2.0)");
} catch (error) {
  if (error instanceof DiscoverySourceError) {
    console.error(`\nSOURCE FAILURE (${error.code}): ${error.message}`);
  } else {
    console.error(`\nEXTRACT FAILURE: ${error instanceof Error ? error.message : "unknown failure"}`);
  }
  process.exitCode = 1;
}
