import { existsSync, readFileSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const secrets=existsSync('.dev.vars')?readFileSync('.dev.vars','utf8').split(/\r?\n/).flatMap(line=>{const match=line.match(/^([A-Z_]*(?:KEY|TOKEN|SECRET))=["']?([^"'\r\n]+)["']?$/);return match&&match[2].length>10?[match[2]]:[];}):[];
let files=0;
function inspect(directory){for(const name of readdirSync(directory)){const file=path.join(directory,name);const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Artifact path escaped dist.');const stat=lstatSync(file);if(stat.isSymbolicLink())throw new Error('Symlink in build output.');if(stat.isDirectory()){inspect(file);continue;}if(/^\.dev\.vars|^\.env|\.pem$/.test(name)){unlinkSync(file);continue;}const bytes=readFileSync(file);if(secrets.some(secret=>bytes.includes(Buffer.from(secret))))throw new Error('Local secret found in generated artifact. Publishing blocked.');files++;}}
inspect(root);
if(!existsSync(path.join(root,'server/index.js')))throw new Error('Worker entrypoint missing.');
console.log('Verified '+files+' artifact files. Local secret sidecars removed; no configured local secrets found in the distributable.');
