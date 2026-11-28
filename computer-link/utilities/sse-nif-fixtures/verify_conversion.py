"""Disposable upstream GPLv3 test-fixture conversion, not game acceptance."""
import hashlib,json,pathlib,shutil,subprocess,tempfile
ROOT=pathlib.Path(__file__).resolve().parent
EXE=ROOT/'delivered/SSE NIF Optimizer.exe'
EXPECTED_EXE='6c04eb6f6fdb041fcd027990ad90ca672e68989dfac65b8970f59d86a6fb0f99'
PIN='846518b3fdfc6c81cddc49188aff77ad7006456a'
INSPECT=ROOT/'parser-build/Release/inspect_nif.exe'
EVIDENCE=ROOT/'evidence'
EVIDENCE.mkdir(exist_ok=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def inspect(p):
 r=subprocess.run([str(INSPECT),str(p)],capture_output=True,text=True,timeout=20)
 require(r.returncode==0,'NIF parser refused fixture/output')
 return json.loads(r.stdout)
require(digest(EXE)==EXPECTED_EXE,'Delivered executable identity mismatch')
require(subprocess.check_output(['git','-C',str(ROOT/'nifly'),'rev-parse','HEAD'],text=True).strip()==PIN,'Fixture source pin mismatch')
require((ROOT/'nifly/LICENSE').is_file(),'Upstream license missing')
results=[]
try:
 with tempfile.TemporaryDirectory(prefix='sse-fixture-copies-') as temp:
  for name,target,start_stream,end_stream in [
   ('TestNifFile_Optimize_LE_to_SE.nif','SSE',83,100),
   ('TestNifFile_Optimize_SE_to_LE.nif','LE',100,83)]:
   original=ROOT/'nifly/tests/input'/name
   golden=ROOT/'nifly/tests/expected'/name
   before_hash=digest(original)
   before=inspect(original)
   require(before['stream']==start_stream and before['user']==12,'Input version mismatch')
   require(before['shapes']>0 and before['vertices']>0 and before['triangles']>0,'Empty geometry fixture')
   case=pathlib.Path(temp)/target;case.mkdir()
   copy=case/name;shutil.copyfile(original,copy)
   log=case/'conversion.log'
   process=subprocess.run([str(EXE),'--optimize',target,'--log',str(log),str(copy)],cwd=case,timeout=60)
   text=log.read_text(encoding='utf-8-sig',errors='strict') if log.exists() else ''
   # Preserve diagnostic log only, not game fixtures or compiled binaries.
   (EVIDENCE/(target+'.log')).write_text(text,encoding='utf-8')
   require(process.returncode==0,'Optimizer nonzero exit')
   require('1 file(s) were found.' in text and '[SUCCESS] Saved file.' in text and 'SSE NIF Optimizer v3.2.2' in text and '[ERROR]' not in text,'Missing or failed processing log')
   after=inspect(copy)
   require(after['stream']==end_stream and after['user']==12,'Output target version mismatch')
   require(not after['unknownBlocks'],'Unexpected unknown output blocks')
   require(after['shapes']==before['shapes'] and after['vertices']==before['vertices'] and after['triangles']==before['triangles'],'Geometry counts changed')
   require(digest(original)==before_hash,'Upstream original modified')
   require(digest(copy)!=before_hash,'Conversion did not change bytes')
   results.append(dict(fixture=name,target=target,exitCode=process.returncode,input=before,output=after,
    originalSha256=before_hash,outputSha256=digest(copy),expectedFixtureSha256=digest(golden),
    matchesUpstreamLibraryGolden=digest(copy)==digest(golden),originalUnchanged=True))
finally:
 (EVIDENCE/'conversion.json').write_text(json.dumps(dict(exeSha256=digest(EXE),nifly=PIN,
  results=results,limitations=['Two upstream conversion fixtures only','Same-library parser is not an independent implementation',
  'Geometry counts do not prove visual, animation or game correctness','No owner assets','No fixture redistribution',
  'CLI defaults include Remove Parallax; backups and GUI option review still required']),indent=2))
print(json.dumps(results,indent=2))
