/**
 * Envelope encryption for the Keyrail vault.
 *
 * Production: tenant DEKs are wrapped by AWS KMS and stored ciphertext-only in
 * PostgreSQL. Development may use an ephemeral local wrapping key.
 */
import crypto from 'node:crypto';
import { KMSClient, EncryptCommand, DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { cfg, pool, withTenant } from './db.js';

const kms = cfg.kmsProvider === 'aws' ? new KMSClient({}) : null;
const LOCAL_MASTER = cfg.nodeEnv === 'production' ? null : crypto.createHash('sha256').update(`${cfg.cookieSecret}:keyrail-local-v1`).digest();
if (cfg.nodeEnv === 'production' && !kms) throw new Error('Production requires KMS_PROVIDER=aws');

async function localWrap(dek: Buffer) {
  if (!LOCAL_MASTER) throw new Error('Local KMS key unavailable in production');
  const iv=crypto.randomBytes(12); const c=crypto.createCipheriv('aes-256-gcm',LOCAL_MASTER,iv); return Buffer.concat([iv,c.update(dek),c.final(),c.getAuthTag()]);
}
async function localUnwrap(wrapped: Buffer) {
  if (!LOCAL_MASTER) throw new Error('Local KMS key unavailable in production');
  const w=toBuffer(wrapped); if(w.length<28)throw new Error('Invalid wrapped DEK'); const iv=w.subarray(0,12);const tag=w.subarray(w.length-16);const d=crypto.createDecipheriv('aes-256-gcm',LOCAL_MASTER,iv);d.setAuthTag(tag);return Buffer.concat([d.update(w.subarray(12,w.length-16)),d.final()]);
}
export function toBytea(buf:Buffer):string{return '\\x'+buf.toString('hex');}
export function toBuffer(val:any):Buffer{if(!val)return Buffer.alloc(0);if(Buffer.isBuffer(val)){const s=val.toString('utf8');return s.startsWith('\\x')?Buffer.from(s.slice(2),'hex'):val;}if(val instanceof Uint8Array)return Buffer.from(val);if(typeof val==='string')return val.startsWith('\\x')?Buffer.from(val.slice(2),'hex'):Buffer.from(val,'hex');return Buffer.from(val);}

export async function generateDek(tenantId:string){return withTenant(tenantId,async(client)=>{const {rows}=await client.query(`SELECT coalesce(max(key_version),0)+1 AS v FROM encryption_keys WHERE tenant_id=$1`,[tenantId]);const version=Number(rows[0].v);let wrapped:Buffer;if(kms){const out=await kms.send(new GenerateDataKeyCommand({KeyId:cfg.kmsKeyId,KeySpec:'AES_256'}));if(!out.Plaintext||!out.CiphertextBlob)throw new Error('KMS did not return a complete data key');const plaintext=Buffer.from(out.Plaintext);wrapped=Buffer.from(out.CiphertextBlob);plaintext.fill(0);}else{const dek=crypto.randomBytes(32);wrapped=await localWrap(dek);dek.fill(0);}await client.query(`INSERT INTO encryption_keys (tenant_id,key_version,wrapped_dek) VALUES ($1,$2,$3)`,[tenantId,version,toBytea(wrapped)]);return {version};});}

async function wrapDek(dek:Buffer){if(kms){const out=await kms.send(new EncryptCommand({KeyId:cfg.kmsKeyId,Plaintext:dek}));if(!out.CiphertextBlob)throw new Error('KMS encryption failed');return Buffer.from(out.CiphertextBlob);}return localWrap(dek);}
async function unwrapDek(wrapped:Buffer){if(kms){const out=await kms.send(new DecryptCommand({CiphertextBlob:wrapped}));if(!out.Plaintext)throw new Error('KMS decryption failed');return Buffer.from(out.Plaintext);}return localUnwrap(wrapped);}

const dekCache=new Map<string,{dek:Buffer;expiresAt:number}>();
const DEK_CACHE_MS=5*60*1000;
export async function getDek(tenantId:string,version:number){const key=`${tenantId}:${version}`;const hit=dekCache.get(key);if(hit&&hit.expiresAt>Date.now())return hit.dek;if(hit){hit.dek.fill(0);dekCache.delete(key);}const {rows}=await withTenant(tenantId,c=>c.query(`SELECT wrapped_dek FROM encryption_keys WHERE tenant_id=$1 AND key_version=$2`,[tenantId,version]));if(!rows.length)throw new Error('unknown key version');const dek=await unwrapDek(toBuffer(rows[0].wrapped_dek));dekCache.set(key,{dek,expiresAt:Date.now()+DEK_CACHE_MS});return dek;}

export interface Sealed{ct:Buffer;nonce:Buffer;tag:Buffer}
export async function seal(tenantId:string,version:number,plaintext:string):Promise<Sealed>{const dek=await getDek(tenantId,version);const nonce=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',dek,nonce);const ct=Buffer.concat([c.update(plaintext,'utf8'),c.final()]);return{ct:toBytea(ct) as any,nonce:toBytea(nonce) as any,tag:toBytea(c.getAuthTag()) as any};}
export async function unseal(tenantId:string,version:number,s:Sealed){const dek=await getDek(tenantId,version);const nonce=toBuffer(s.nonce),tag=toBuffer(s.tag),ct=toBuffer(s.ct);const d=crypto.createDecipheriv('aes-256-gcm',dek,nonce);d.setAuthTag(tag);return Buffer.concat([d.update(ct),d.final()]);}
export async function withUnsealedSecret<T>(tenantId:string,version:number,s:Sealed,fn:(plaintext:string)=>Promise<T>):Promise<T>{const buf=await unseal(tenantId,version,s);try{return await fn(buf.toString('utf8'));}finally{buf.fill(0);}}
export async function rotateTenantDek(tenantId:string){const next=await generateDek(tenantId);await withTenant(tenantId,c=>c.query(`UPDATE encryption_keys SET state='ROTATING' WHERE tenant_id=$1 AND key_version<$2 AND state='ACTIVE'`,[tenantId,next.version]));for(const [key,v] of dekCache.entries()){if(key.startsWith(`${tenantId}:`)){v.dek.fill(0);dekCache.delete(key);}}return next;}

const SECRET_PATTERNS=[/(password|secret|token|api_?key|otp|nonce)["']?\s*[:=]\s*["']?[^"'\s,}]{4,}/gi,/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g];
export function redact(input:string){let out=input;for(const re of SECRET_PATTERNS)out=out.replace(re,m=>`${m.slice(0,8)}=[REDACTED]`);return out;}
export const randomToken=(bytes=24)=>crypto.randomBytes(bytes).toString('base64url');
export const sha256=(b:Buffer|string)=>crypto.createHash('sha256').update(b).digest();
export const chainHash=(parts:string)=>crypto.createHash('sha256').update(parts).digest('hex');

const cacheSweep=setInterval(()=>{const now=Date.now();for(const [key,v] of dekCache.entries()){if(v.expiresAt<=now){v.dek.fill(0);dekCache.delete(key);}}},60_000);cacheSweep.unref();