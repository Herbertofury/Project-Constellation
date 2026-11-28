from pathlib import Path
import zipfile,struct,json,hashlib,copy,shutil
import argparse,tempfile
parser=argparse.ArgumentParser(description='Build the 0.7.4 app archive and reversible portable repair from verified 0.7.3 artifacts')
parser.add_argument('--baseline-portable',required=True)
parser.add_argument('--baseline-patch',required=True)
parser.add_argument('--source',default=str(Path(__file__).resolve().parents[1]))
parser.add_argument('--output',default='dist-repair')
args=parser.parse_args();R=Path(args.source).resolve();O=Path(args.output).resolve();O.mkdir(parents=True,exist_ok=True);W=Path(tempfile.mkdtemp(prefix='commander-package-'));(W/'evidence').mkdir();V='0.7.4'
hashof=lambda b:hashlib.sha256(b).hexdigest()
def require(condition, message):
 if not condition: raise RuntimeError(message)
patch_base=Path(args.baseline_patch).resolve()
require(hashof(patch_base.read_bytes())=='6a4674740f53d105eb2ff267b19c42448acfd55a3282ffac749339870cf0a6b0','Expected the exact original 0.7.3 manual patch')
with zipfile.ZipFile(patch_base) as basepatch:
 require(basepatch.testzip() is None,'Baseline manual patch has a CRC error')
 destination=(W/'manual').resolve()
 for entry in basepatch.infolist():
  target=(destination/entry.filename).resolve()
  require(target.is_relative_to(destination),'Unsafe path in baseline manual patch')
 basepatch.extractall(destination)
base=Path(args.baseline_portable).resolve()
require(hashof(base.read_bytes())=='0a00bb92e2243b143959ee5273a9b7f43b5de6a42311137ab9164dce31e33e60','Expected the exact original 0.7.3 portable archive')
z=zipfile.ZipFile(base);old=z.read('resources/app.asar');header=json.loads(old[16:16+struct.unpack('<I',old[12:16])[0]])
# Package all application paths, preserving unpacked-native declarations.
files={}
def walk(node,p=''):
 for name,meta in node['files'].items():
  rel=p+name
  if 'files' in meta:walk(meta,rel+'/')
  else:files[rel]=meta
walk(header)
for folder in ['electron','src','native','bin','browser-companion']:
 for p in (R/folder).rglob('*'):
  if p.is_file():files.setdefault(p.relative_to(R).as_posix(),{})
for name in ['package.json','LICENSE','README.md','SECURITY.md']:files.setdefault(name,{})
root={'files':{}};body=bytearray(); checks=[]
for name,oldmeta in sorted(files.items()):
 p=R/name
 if not p.is_file():raise RuntimeError('Missing packaged source '+name)
 data=p.read_bytes();meta={k:v for k,v in oldmeta.items() if k not in ['offset','size','integrity','link']};meta['size']=len(data)
 meta['integrity']={'algorithm':'SHA256','hash':hashof(data),'blockSize':4194304,'blocks':[hashof(data[i:i+4194304]) for i in range(0,len(data),4194304)]}
 if not meta.get('unpacked'):meta['offset']=str(len(body));body.extend(data)
 node=root
 parts=name.split('/')
 for part in parts[:-1]:node=node['files'].setdefault(part,{'files':{}})
 node['files'][parts[-1]]=meta;checks.append({'path':name,'size':len(data),'sha256':hashof(data),'unpacked':bool(meta.get('unpacked'))})
text=json.dumps(root,separators=(',',':'),ensure_ascii=False).encode();payload=struct.pack('<I',len(text))+text;payload+=b'\0'*((-len(payload))%4)
hdr=struct.pack('<I',len(payload))+payload;asar=struct.pack('<II',4,len(hdr))+hdr+body
stage=W/'package';(stage/'resources').mkdir(parents=True,exist_ok=True);(stage/'resources/app.asar').write_bytes(asar)
# Independent structural and byte-for-byte verification.
hsize=struct.unpack('<I',asar[4:8])[0];h=json.loads(asar[16:16+struct.unpack('<I',asar[12:16])[0]])
for check in checks:
 node=h
 for part in check['path'].split('/'):node=node['files'][part]
 if check['unpacked']:
  oldnative=z.read('resources/app.asar.unpacked/'+check['path']);require(oldnative==(R/check['path']).read_bytes(),'Native helper changed unexpectedly')
  p=stage/'resources/app.asar.unpacked'/check['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(oldnative)
 else:
  start=8+hsize+int(node['offset']);b=asar[start:start+node['size']];require(hashof(b)==check['sha256'],'Application entry checksum mismatch');require(b==(R/check['path']).read_bytes(),'Application entry does not match source')
portable=O/f'Constellation-Commander-{V}-Windows-Portable.zip';unchanged=[]
reuse=False
if portable.exists():
 try:
  with zipfile.ZipFile(portable) as current:
   reuse=current.testzip() is None and current.read('resources/app.asar')==asar
 except (zipfile.BadZipFile,EOFError,KeyError):pass
if reuse:
 for info in z.infolist():
  if info.filename!='resources/app.asar' and not info.filename.startswith('START-HERE'):unchanged.append({'path':info.filename,'sha256':hashof(z.read(info.filename))})
else:
 with zipfile.ZipFile(portable,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as out:
  for info in z.infolist():
   data=z.read(info.filename)
   if info.filename=='resources/app.asar':data=asar
   elif info.filename.startswith('START-HERE'):
    data=(f'Constellation Commander {V}\nClose older Commander windows. Extract into a new folder and run Constellation Commander.exe.\nExisting ChatGPT profile and permissions are preserved. Activity contains saved multi-step Tasks.\nWindows launcher/runtime is preserved from 0.7.3. Native Windows and signed-in ChatGPT acceptance have not been performed for this update.\n').encode()
   else:unchanged.append({'path':info.filename,'sha256':hashof(data)})
   out.writestr(info,data)
with zipfile.ZipFile(portable) as out:
 require(out.testzip() is None,'Portable archive CRC verification failed')
 for row in unchanged:require(hashof(out.read(row['path']))==row['sha256'],'Original runtime entry changed: '+row['path'])
manual=W/'manual';(manual/'resources/app.asar').write_bytes(asar);manifest=json.loads((manual/'patch-manifest.json').read_text());manifest['version']=V;manifest['accepted_base_asar_sha256'].append(hashof(old));manifest['accepted_base_asar_sha256']=list(dict.fromkeys(manifest['accepted_base_asar_sha256']));manifest['target_asar_sha256']=hashof(asar);(manual/'patch-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for p in manual.iterdir():
 if p.is_file() and p.suffix.lower() in ['.cmd','.ps1','.md']:
  t=p.read_text().replace('0.7.3','0.7.4').replace('0.7.1 or 0.7.2','0.7.1, 0.7.2 or 0.7.3');p.write_text(t)
patch=O/f'Constellation-Commander-{V}-Manual-Patch.zip'
with zipfile.ZipFile(patch,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as out:
 for p in manual.rglob('*'):
  if p.is_file():out.write(p,p.relative_to(manual))
report={'version':V,'baseline_portable_sha256':hashof(base.read_bytes()),'base_asar_sha256':hashof(old),'new_asar_sha256':hashof(asar),'packaged_source_files':checks,'unchanged_windows_files':unchanged,'portable_sha256':hashof(portable.read_bytes()),'manual_patch_sha256':hashof(patch.read_bytes()),'crc':'PASS','native_windows_run':False}
(W/'evidence/package-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if not isinstance(v,list)},indent=2));print('source entries',len(checks),'unchanged runtime',len(unchanged));shutil.copyfile(W/'evidence/package-verification.json',O/'package-verification.json')

shutil.rmtree(W)
