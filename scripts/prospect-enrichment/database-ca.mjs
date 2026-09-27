import fs from "node:fs";
import path from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";

export const DATABASE_CA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "certificates", "prod-ca-2021.crt");
export const DATABASE_CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";

export function verifyDatabaseCa(bytes = fs.readFileSync(DATABASE_CA_PATH), now = Date.now()) {
  if (createHash("sha256").update(bytes).digest("hex") !== DATABASE_CA_SHA256) throw Error("database_ca_hash_mismatch");
  const certificate = new X509Certificate(bytes);
  if (!certificate.ca || !certificate.verify(certificate.publicKey) ||
      now < Date.parse(certificate.validFrom) || now >= Date.parse(certificate.validTo)) throw Error("database_ca_invalid_or_expired");
  return { certificateSha256: DATABASE_CA_SHA256, validTo: certificate.validTo };
}

export function verifyDatabaseCaFile() {
  const stat = fs.lstatSync(DATABASE_CA_PATH);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error("database_ca_file_invalid");
  return verifyDatabaseCa();
}
