import { generateKeyPairSync } from "node:crypto";
import { serializeComparisonExport } from "../comparison-export";
import type { ComparisonSnapshot } from "../reconciliation";
import type { ComparisonSigningKey, ComparisonTrust } from "../comparison-signature";
/** Ephemeral synthetic keys only. Never written to disk and never used by the application. */
const pair=generateKeyPairSync("ed25519");
export const syntheticSigningKey:ComparisonSigningKey={keyId:"synthetic-comparison-key",privateKeyPem:pair.privateKey.export({format:"pem",type:"pkcs8"}).toString()};
export const syntheticComparisonTrust:ComparisonTrust={keyId:syntheticSigningKey.keyId,publicKeyPem:pair.publicKey.export({format:"pem",type:"spki"}).toString()};
export function enableSyntheticComparisonTrust(){
  process.env.PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_KEY_ID=syntheticComparisonTrust.keyId;
  process.env.PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_PUBLIC_KEY_PEM=syntheticComparisonTrust.publicKeyPem;
}
enableSyntheticComparisonTrust();
export function serializeSyntheticComparisonExport(input:unknown,now?:string){return serializeComparisonExport(input,now,syntheticSigningKey);}
export function resignSyntheticComparisonSnapshot(snapshot:ComparisonSnapshot):ComparisonSnapshot {
  const {snapshotSha256:_hash,signature:_signature,...content}=snapshot;void _hash;void _signature;
  return serializeSyntheticComparisonExport(content,snapshot.capturedAt).snapshot;
}
