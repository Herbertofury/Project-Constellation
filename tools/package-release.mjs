import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(fs.readFileSync(path.join(repoRoot,'package.json'),'utf8'));
const version=pkg.version;
const buildInfo=JSON.parse(fs.readFileSync(path.join(repoRoot,'build','build-info.json'),'utf8'));
const allowDevelopment=process.argv.includes('--allow-development');
if(buildInfo.version!==version)throw new Error('Build metadata version does not match package.json.');
if(buildInfo.mode!=='production'&&!allowDevelopment)throw new Error('Release packaging blocked: build mode is not production.');
if(buildInfo.mode==='production'&&(!buildInfo.oauth?.google||!buildInfo.oauth?.github))throw new Error('Release packaging blocked: OAuth provisioning is incomplete.');

const sourceCommitResult=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:repoRoot,encoding:'utf8'});
if(sourceCommitResult.status!==0)throw new Error('Release packaging requires a committed source tree.');
const sourceCommit=sourceCommitResult.stdout.trim();
if(buildInfo.mode==='production'){
  const status=spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repoRoot,encoding:'utf8'});
  if(status.status!==0||status.stdout.trim())throw new Error('Production release packaging requires a clean tracked source tree.');
}

const releaseDir=path.join(repoRoot,'releases',`v${version}`);
const unpacked=path.join(repoRoot,'build','unpacked');
const installZip=path.join(releaseDir,`Project-Constellation-v${version}-unpacked.zip`);
const sourceZip=path.join(releaseDir,`Project-Constellation-v${version}-source.zip`);
fs.mkdirSync(releaseDir,{recursive:true});
for(const target of [installZip,sourceZip])fs.rmSync(target,{force:true});

function run(command,args,cwd=repoRoot){const result=spawnSync(command,args,{cwd,encoding:'utf8',stdio:'pipe'});if(result.status!==0)throw new Error(`${command} failed: ${result.stderr||result.stdout}`);}
if(process.platform==='win32'){
  const quote=(value)=>String(value).replaceAll("'","''");
  run('powershell.exe',['-NoProfile','-Command',`Compress-Archive -Path '${quote(path.join(unpacked,'*'))}' -DestinationPath '${quote(installZip)}' -CompressionLevel Optimal -Force`]);
}else run('zip',['-X','-q','-r',installZip,'.'],unpacked);

run('git',['archive','--format=zip',`--output=${sourceZip}`,sourceCommit]);

const artifacts=[installZip,sourceZip];
const sha256=(file)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checksums=artifacts.map((file)=>`${sha256(file)}  ${path.basename(file)}`).join('\n')+'\n';
fs.writeFileSync(path.join(releaseDir,'SHA256SUMS.txt'),checksums);
const receipt={schema:'project-constellation-release',version,tag:`v${version}`,mode:buildInfo.mode,oauth:buildInfo.oauth,extensionId:'geljambmkfjkhodgkpjhnmfojkpcamig',sourceCommit,buildCreatedAt:buildInfo.builtAt,artifacts:artifacts.map((file)=>({name:path.basename(file),bytes:fs.statSync(file).size,sha256:sha256(file)})),createdAt:new Date().toISOString()};
fs.writeFileSync(path.join(releaseDir,'RELEASE-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
