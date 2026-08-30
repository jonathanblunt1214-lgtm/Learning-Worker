const crypto = require('node:crypto');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('CRUCIBLE1');
const AAD = Buffer.from('github:jonathanblunt1214-lgtm/Learning-Worker\0v1');

function keyFromEnvironment() { const key = Buffer.from(process.env.LEARNING_WORKER_KEY || '', 'base64'); if (key.length !== 32) throw new Error('LEARNING_WORKER_KEY must decode to exactly 32 bytes.'); return key; }
async function encrypt(input, output) { const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',keyFromEnvironment(),iv); cipher.setAAD(AAD); const temporary=`${output}.${process.pid}.tmp`; try { const destination=fs.createWriteStream(temporary,{flags:'wx',mode:0o600}); destination.write(MAGIC); destination.write(iv); await pipeline(fs.createReadStream(input),cipher,destination,{end:false}); await new Promise((resolve,reject)=>destination.end(cipher.getAuthTag(),(error)=>error?reject(error):resolve())); fs.renameSync(temporary,output); } catch(error) { fs.rmSync(temporary,{force:true}); throw error; } }
async function decrypt(input, output) { const size=fs.statSync(input).size; if(size<=MAGIC.length+28) throw new Error('Encrypted bundle is truncated.'); const handle=fs.openSync(input,'r'); const temporary=`${output}.${process.pid}.tmp`; try { const magic=Buffer.alloc(MAGIC.length),iv=Buffer.alloc(12),tag=Buffer.alloc(16); fs.readSync(handle,magic,0,magic.length,0); fs.readSync(handle,iv,0,iv.length,magic.length); fs.readSync(handle,tag,0,tag.length,size-tag.length); if(!crypto.timingSafeEqual(magic,MAGIC)) throw new Error('Encrypted bundle header is invalid.'); const decipher=crypto.createDecipheriv('aes-256-gcm',keyFromEnvironment(),iv); decipher.setAAD(AAD); decipher.setAuthTag(tag); await pipeline(fs.createReadStream(input,{start:MAGIC.length+iv.length,end:size-tag.length-1}),decipher,fs.createWriteStream(temporary,{flags:'wx',mode:0o600})); fs.renameSync(temporary,output); } catch(error) { fs.rmSync(temporary,{force:true}); throw error; } finally { fs.closeSync(handle); } }
async function main(){const [operation,input,output]=process.argv.slice(2);if(!['encrypt','decrypt'].includes(operation)||!input||!output)throw new Error('Usage: crypt-bundle.js <encrypt|decrypt> <input> <output>');if(operation==='encrypt')await encrypt(input,output);else await decrypt(input,output);}
if(require.main===module)main().catch((error)=>{console.error(error.message);process.exitCode=1;});
module.exports={encrypt,decrypt};
