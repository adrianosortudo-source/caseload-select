#!/usr/bin/env node
/**
 * Builds a source-preserving Downtown Plan 41 geocoding queue from the legacy
 * GTA directory artifact. This is discovery support only: a source row remains
 * an unresolved LSO address cluster and never becomes a firm record here.
 *
 * The City of Toronto Secondary Plan layer is queried at run time because the
 * City publishes it as the authoritative geometry. Save the returned GeoJSON
 * beside the output to make an individual run reproducible.
 *
 * Usage:
 *   node scripts/build-legacy-downtown-discovery.mjs
 *   node scripts/build-legacy-downtown-discovery.mjs --geocodes path/to/geocodes.json
 *
 * A geocodes file is an array of objects with sourceRecordKey, longitude,
 * latitude, sourceUrl, and observedOn. Coordinates without a source URL/date
 * are rejected. Do not use postal-code centroids as address coordinates.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_ID = "legacy-gta-directory-2026-07";
const BOUNDARY_QUERY_URL = "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/44/query?where=SECONDARY_PLAN_NUMBER%3D%2741%27&outFields=OBJECTID%2CSECONDARY_PLAN_NUMBER%2CSECONDARY_PLAN_NAME%2CSTATUS&returnGeometry=true&f=geojson&outSR=4326";
const OUTPUT_PATH = resolve(REPO_ROOT, "docs/prospecting/legacy-downtown-discovery/legacy-gta-downtown-geocode-queue.json");
const BOUNDARY_OUTPUT_PATH = resolve(REPO_ROOT, "docs/prospecting/legacy-downtown-discovery/downtown-plan-41-boundary.geojson");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function parseLegacyRows(source) {
  const prefix = "export const PROSPECTS_HTML = ";
  const start = source.indexOf(prefix);
  const end = source.search(/";\r?\n$/);
  if (start < 0 || end < 0) throw new Error("Could not find the legacy prospect artifact string.");
  const html = JSON.parse(source.slice(start + prefix.length, end + 1));
  const dataStart = html.indexOf("const DATA = ");
  const dataEnd = html.indexOf(";\n  const COLS = DATA.columns;", dataStart);
  if (dataStart < 0 || dataEnd < 0) throw new Error("Could not find the legacy artifact data payload.");
  const data = JSON.parse(html.slice(dataStart + "const DATA = ".length, dataEnd));
  const positions = Object.fromEntries(data.columns.map((column, index) => [column, index]));
  for (const field of ["business_name", "lawyer_names", "lawyer_count", "street", "city", "postal_code", "website_url"]) {
    if (!(field in positions)) throw new Error(`Legacy artifact is missing ${field}.`);
  }
  return data.rows.map((row, index) => ({
    sourceRecordKey: `${SOURCE_ID}:row-${index + 1}`,
    sourceId: SOURCE_ID,
    sourceRowNumber: index + 1,
    sourceKind: "lso_address_cluster",
    identityStatus: "unresolved",
    firmId: null,
    canonicalDomain: null,
    candidate: {
      displayName: row[positions.business_name] ?? "",
      lawyerNames: row[positions.lawyer_names] ?? "",
      legacyClusterLawyerCount: Number.parseInt(row[positions.lawyer_count] ?? "", 10) || null,
      street: row[positions.street] ?? "",
      city: row[positions.city] ?? "",
      postalCode: row[positions.postal_code] ?? "",
      websiteUrl: row[positions.website_url] || null,
    },
  }));
}

function pointInRing(longitude, latitude, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[current];
    const [x2, y2] = ring[previous];
    const crosses = (y1 > latitude) !== (y2 > latitude);
    if (crosses && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(longitude, latitude, polygon) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  const [outer, ...holes] = polygon.coordinates;
  return pointInRing(longitude, latitude, outer) && !holes.some((hole) => pointInRing(longitude, latitude, hole));
}

function fullAddress(candidate) {
  return [candidate.street, candidate.city, "ON", candidate.postalCode, "Canada"].filter((value) => value.trim()).join(", ");
}

function hasStreetAddress(candidate) {
  return Boolean(candidate.street.trim() && candidate.city.trim());
}

function geocodingPriority(city) {
  const cityOfTorontoLabels = new Set(["toronto", "north york", "etobicoke", "scarborough", "york", "east york"]);
  return cityOfTorontoLabels.has(city.trim().toLocaleLowerCase())
    ? "city_of_toronto_address_label"
    : "outside_city_of_toronto_address_label";
}

async function readGeocodes(path) {
  if (!path) return new Map();
  const parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Geocodes input must be an array.");
  const result = new Map();
  for (const geocode of parsed) {
    if (!geocode?.sourceRecordKey || !Number.isFinite(geocode.longitude) || !Number.isFinite(geocode.latitude) || !geocode.sourceUrl || !geocode.observedOn) {
      throw new Error("Every geocode requires sourceRecordKey, longitude, latitude, sourceUrl, and observedOn.");
    }
    result.set(geocode.sourceRecordKey, geocode);
  }
  return result;
}

async function downloadBoundary() {
  const response = await fetch(BOUNDARY_QUERY_URL, { headers: { accept: "application/geo+json, application/json" } });
  if (!response.ok) throw new Error(`Downtown Plan 41 boundary request failed: ${response.status}.`);
  const geojson = await response.json();
  const [feature] = geojson.features ?? [];
  if (!feature || feature.properties?.SECONDARY_PLAN_NUMBER !== "41" || feature.geometry?.type !== "Polygon") {
    throw new Error("City boundary response did not contain Downtown Plan Secondary Plan 41 polygon.");
  }
  return geojson;
}

async function main() {
  const [artifact, boundary, geocodes] = await Promise.all([
    readFile(resolve(REPO_ROOT, "src/app/admin/prospects/prospects-content.ts"), "utf8"),
    downloadBoundary(),
    readGeocodes(option("--geocodes")),
  ]);
  const polygon = boundary.features[0].geometry;
  const records = parseLegacyRows(artifact).map((record) => {
    const geocode = geocodes.get(record.sourceRecordKey);
    const address = fullAddress(record.candidate);
    const priority = geocodingPriority(record.candidate.city);
    if (!hasStreetAddress(record.candidate)) {
      return { ...record, fullAddress: address || null, geocodingPriority: priority, downtownPlan41Status: "address_incomplete", geocode: null };
    }
    if (!geocode) {
      return { ...record, fullAddress: address, geocodingPriority: priority, downtownPlan41Status: "requires_manual_geocoding", geocode: null };
    }
    const status = pointInPolygon(geocode.longitude, geocode.latitude, polygon) ? "inside_confirmed" : "outside_confirmed";
    return {
      ...record,
      fullAddress: address,
      geocodingPriority: priority,
      downtownPlan41Status: status,
      geocode: { longitude: geocode.longitude, latitude: geocode.latitude, sourceUrl: geocode.sourceUrl, observedOn: geocode.observedOn },
    };
  });
  const counts = Object.fromEntries(["inside_confirmed", "outside_confirmed", "requires_manual_geocoding", "address_incomplete"].map((status) => [status, records.filter((record) => record.downtownPlan41Status === status).length]));
  const cityOfTorontoAddressLabels = records.filter((record) => record.geocodingPriority === "city_of_toronto_address_label").length;
  const output = {
    generatedAt: new Date().toISOString(),
    purpose: "Discovery queue only. Every record remains an unresolved LSO address-cluster source record; legacy cluster counts are not firm lawyer counts.",
    geography: {
      name: "City of Toronto Downtown Plan, Secondary Plan 41",
      officialBoundaryQueryUrl: BOUNDARY_QUERY_URL,
      feature: boundary.features[0].properties,
      method: "A source-backed street-address coordinate is tested against the City polygon. City name and postal code are retained as evidence but never classify a record as downtown.",
    },
    summary: { sourceRows: records.length, geocodesProvided: geocodes.size, cityOfTorontoAddressLabels, ...counts },
    records,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await Promise.all([
    writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(BOUNDARY_OUTPUT_PATH, `${JSON.stringify(boundary, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({ outputPath: OUTPUT_PATH, boundaryPath: BOUNDARY_OUTPUT_PATH, summary: output.summary }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
