import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalJson, object } from "./model";
export type ComparisonSignature = {algorithm:"Ed25519";keyId:string;signatureBase64:string};
export type ComparisonSigningKey = {keyId:string;privateKeyPem:string};
export type ComparisonTrust = {keyId:string;publicKeyPem:string};
const keyId=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const domain="caseload-prospect-enrichment-comparison-signature/v1";
function message(snapshot:Record<string,unknown>,id:string):Buffer {
  const {signature:_signature,...content}=snapshot;
  void _signature;
  return Buffer.from(canonicalJson({domain,algorithm:"Ed25519",keyId:id,snapshot:content}),"utf8");
}
export function configuredComparisonTrust(env:Partial<NodeJS.ProcessEnv>=process.env):ComparisonTrust|null {
  const id=env.PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_KEY_ID,pem=env.PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_PUBLIC_KEY_PEM;
  return keyId(id)&&typeof pem==="string"&&pem.trim()?{keyId:id,publicKeyPem:pem}:null;
}
/** Server-only callers supply a private key explicitly. No key generation, environment loading or I/O. */
export function signComparisonSnapshot<T extends Record<string,unknown>>(snapshot:T,key:ComparisonSigningKey):T&{signature:ComparisonSignature} {
  if(!key||!keyId(key.keyId)||typeof key.privateKeyPem!=="string"||!key.privateKeyPem.trim())throw Error("comparison_signing_key_missing");
  let signature:Buffer;
  try{
    const privateKey=createPrivateKey(key.privateKeyPem);
    if(privateKey.asymmetricKeyType!=="ed25519")throw Error();
    signature=sign(null,message(snapshot,key.keyId),privateKey);
  }catch{throw Error("comparison_signing_key_invalid");}
  return{...snapshot,signature:{algorithm:"Ed25519",keyId:key.keyId,signatureBase64:signature.toString("base64")}};
}
export function signingKeyTrust(key:ComparisonSigningKey):ComparisonTrust {
  try{
    const privateKey=createPrivateKey(key.privateKeyPem);
    if(privateKey.asymmetricKeyType!=="ed25519")throw Error();
    return{keyId:key.keyId,publicKeyPem:createPublicKey(privateKey).export({format:"pem",type:"spki"}).toString()};
  }catch{throw Error("comparison_signing_key_invalid");}
}
/** An unkeyed boolean or content digest never establishes server provenance. */
export function verifyComparisonSignature(snapshot:unknown,trust:ComparisonTrust|null=configuredComparisonTrust()):string|null {
  if(!trust||!keyId(trust.keyId)||typeof trust.publicKeyPem!=="string"||!trust.publicKeyPem.trim())return"comparison_trust_config_missing";
  if(!object(snapshot)||!object(snapshot.signature)||Object.keys(snapshot.signature).length!==3||snapshot.signature.algorithm!=="Ed25519"||!keyId(snapshot.signature.keyId)||typeof snapshot.signature.signatureBase64!=="string"||!/^[A-Za-z0-9+/]{86}==$/.test(snapshot.signature.signatureBase64))return"comparison_signature_missing_or_invalid";
  if(snapshot.signature.keyId!==trust.keyId)return"comparison_signature_unknown_key";
  try{
    if(!/^\s*-----BEGIN PUBLIC KEY-----/.test(trust.publicKeyPem))return"comparison_trust_key_invalid";
    const publicKey=createPublicKey(trust.publicKeyPem);
    if(publicKey.asymmetricKeyType!=="ed25519")return"comparison_trust_key_invalid";
    const bytes=Buffer.from(snapshot.signature.signatureBase64,"base64");
    if(bytes.length!==64||bytes.toString("base64")!==snapshot.signature.signatureBase64||!verify(null,message(snapshot,snapshot.signature.keyId),publicKey,bytes))return"comparison_signature_invalid";
    return null;
  }catch{return"comparison_trust_key_invalid";}
}
