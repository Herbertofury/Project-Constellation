(() => {
  'use strict';

  const VERSION = 1;
  const STOP = new Set(['the','and','for','with','from','this','that','chat','project','help','make','into','your','have','what','how','can','use','using','new','fix','update','build','create','please','need','want','about','more','like','just','all','its','are','was','you','me','my','our','not','but','work','working','continue','latest','version','release','artifact','file','source']);
  const RELATION_WORDS = /\b(depends? on|requires?|blocked by|blocks?|after|before|based on|built on|uses?|needs?)\b/i;
  const GENERAL_HINTS = new Set(['performance','optimization','benchmark','compatibility','workflow','toolchain','validation','testing','release','recovery','stability','memory','latency','rendering','network','build','runtime','server','client']);
  const IMPORTANT_KINDS = new Set(['decision','follow-up','recommendation','idea','command','code','version','repository','package','mod','document','reference','link']);

  function text(value, max = 6000) { return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max); }
  function hashString(input) { let hash = 2166136261; for (const ch of String(input || '')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
  function tokens(value, limit = 72) {
    const out=[]; const seen=new Set();
    for(const raw of text(value,9000).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._+#-]{1,47}/gu)||[]){
      const token=raw.replace(/^[-_.]+|[-_.]+$/g,'');
      if(!token||token.length<3||STOP.has(token)||/^\d+$/.test(token)||seen.has(token))continue;
      seen.add(token);out.push(token);if(out.length>=limit)break;
    }
    return out;
  }
  function overlap(a,b){const aa=a instanceof Set?a:new Set(a||[]),bb=b instanceof Set?b:new Set(b||[]);if(!aa.size||!bb.size)return {shared:[],score:0};const shared=[...aa].filter((t)=>bb.has(t));return {shared,score:shared.length/Math.max(1,Math.min(aa.size,bb.size))};}
  function chatBucket(chat={}){if(chat.organizedArchived)return'archived';const s=String(chat.status||'idle');if(s==='running')return'active';if(['paused','waiting-user','blocked-approval','delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','rate-limited','errored','stalled','auth-required','unavailable'].includes(s))return'attention';return'completed';}
  function sourceLabel(row={}){return text(row.title||row.text||row.name||'Project evidence',220);}
  function canonical(row={}){return String(row.canonicalKey||row.id||`${row.kind||'item'}:${sourceLabel(row).toLocaleLowerCase()}`);}

  function parseVersion(value){
    const s=text(value,500);
    const m=s.match(/(?:^|[^\d])v?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?(?:[.-]([0-9A-Za-z][0-9A-Za-z.-]{0,30}))?/);
    if(!m)return null;
    return {raw:m[0].trim().replace(/^[^\dv]+/i,''),major:Number(m[1]),minor:Number(m[2]),patch:Number(m[3]||0),pre:m[4]||''};
  }
  function compareVersion(a,b){
    if(!a&&!b)return 0;if(!a)return-1;if(!b)return 1;
    for(const key of ['major','minor','patch']){if(a[key]!==b[key])return a[key]>b[key]?1:-1;}
    if(a.pre===b.pre)return 0;if(!a.pre)return 1;if(!b.pre)return-1;return a.pre.localeCompare(b.pre,undefined,{numeric:true,sensitivity:'base'});
  }
  function artifactFamily(value, fallback='project'){
    let s=text(value,500).toLocaleLowerCase();
    s=s.replace(/\.(zip|jar|crx|tgz|tar|gz|7z|rar|exe|msi|json|md|txt)$/i,'');
    s=s.replace(/(?:^|[-_\s])v?\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:[-_.][0-9a-z.-]+)?/gi,' ');
    s=s.replace(/\b(source|sources|unpacked|build|release|checkpoint|actions|artifact|dev|production|prod|final)\b/gi,' ');
    s=s.replace(/\b[0-9a-f]{8,64}\b/gi,' ').replace(/[-_.\s]+/g,' ').trim();
    return s||fallback;
  }

  function buildVersionAwareness({project={},items=[],files=[]}={}){
    const rows=[];
    for(const item of items){if(item.kind!=='version')continue;const version=parseVersion(`${item.title||''} ${item.text||''}`);if(!version)continue;rows.push({id:`knowledge:${item.id}`,entityType:'knowledge',entityId:item.id,family:`project:${project.id||'project'}`,familyLabel:project.name||'Project',version,versionText:version.raw,label:sourceLabel(item),chatId:item.chatId||'',url:item.url||item.sourceUrl||'',updatedAt:Number(item.updatedAt||0)});}
    for(const file of files){const version=parseVersion(file.name||file.title||'');if(!version)continue;const family=artifactFamily(file.name||file.title||'',project.name||project.id||'project');rows.push({id:`file:${file.id}`,entityType:'file',entityId:file.id,family:`artifact:${family}`,familyLabel:family,version,versionText:version.raw,label:text(file.name||file.title||'Artifact',240),chatId:file.chatId||'',url:file.externalUrl||file.href||'',updatedAt:Number(file.updatedAt||0)});}
    const families=[];const grouped=new Map();for(const row of rows){const list=grouped.get(row.family)||[];list.push(row);grouped.set(row.family,list);}
    for(const [family,list] of grouped){list.sort((a,b)=>compareVersion(b.version,a.version)||b.updatedAt-a.updatedAt);const current=list[0];const entries=list.slice(0,12).map((row,index)=>({...row,status:index===0?'current-observed':'older-observed',newerId:index===0?'':current.id,newerVersion:index===0?'':current.versionText}));families.push({family,label:current.familyLabel,current:entries[0],entries,observedCount:list.length});}
    families.sort((a,b)=>(b.current?.updatedAt||0)-(a.current?.updatedAt||0));
    const older=families.flatMap((f)=>f.entries.filter((e)=>e.status==='older-observed').slice(0,6).map((e)=>({...e,familyLabel:f.label,currentVersion:f.current.versionText}))).slice(0,24);
    return {families:families.slice(0,20),older,currentProjectVersion:(families.find((f)=>f.family===`project:${project.id||'project'}`)?.current?.versionText)||''};
  }

  function buildDependencies({chats=[],items=[],files=[],versions={}}={}){
    const chatMap=new Map(chats.map((c)=>[c.id,c]));
    const candidates=items.filter((i)=>IMPORTANT_KINDS.has(i.kind)).slice(0,280);
    const itemTokens=new Map(candidates.map((i)=>[i.id,new Set(tokens(`${i.title||''} ${i.text||''}`,48))]));
    const nodes=[];const nodeIds=new Set();
    function addNode(node){if(!node?.id||nodeIds.has(node.id))return;nodeIds.add(node.id);nodes.push(node);}
    for(const i of candidates)addNode({id:`knowledge:${i.id}`,entityType:'knowledge',entityId:i.id,kind:i.kind,label:sourceLabel(i),chatId:i.chatId||'',url:i.url||i.sourceUrl||'',updatedAt:Number(i.updatedAt||0),canonicalKey:canonical(i)});
    for(const f of files.slice(0,80))addNode({id:`file:${f.id}`,entityType:'file',entityId:f.id,kind:'artifact',label:text(f.name||'Artifact',220),chatId:f.chatId||'',url:f.externalUrl||f.href||'',updatedAt:Number(f.updatedAt||0),canonicalKey:`file:${artifactFamily(f.name||'',f.id)}`});
    const edges=[];const edgeKeys=new Set();
    const byChat=new Map();for(const i of candidates){if(!i.chatId)continue;const list=byChat.get(i.chatId)||[];list.push(i);byChat.set(i.chatId,list);}
    for(const [chatId,list] of byChat){list.sort((a,b)=>(a.updatedAt||0)-(b.updatedAt||0));for(let i=0;i<list.length;i++){const a=list[i];for(let j=i+1;j<Math.min(list.length,i+7);j++){const b=list[j];const ov=overlap(itemTokens.get(a.id),itemTokens.get(b.id));const explicit=RELATION_WORDS.test(`${a.text||''} ${b.text||''}`);if(!explicit&&ov.shared.length<2)continue;const confidence=Math.min(.97,(explicit?.68:.48)+Math.min(.28,ov.score*.5));const key=`knowledge:${a.id}>knowledge:${b.id}`;if(edgeKeys.has(key))continue;edgeKeys.add(key);edges.push({id:hashString(key),from:`knowledge:${a.id}`,to:`knowledge:${b.id}`,relation:explicit?'explicit-signal':'inferred-sequence',confidence:Number(confidence.toFixed(3)),sharedTerms:ov.shared.slice(0,6),sourceChatId:chatId});}}}
    const filesByChat=new Map();for(const f of files.slice(0,120)){if(!f.chatId)continue;const list=filesByChat.get(f.chatId)||[];list.push(f);filesByChat.set(f.chatId,list);}
    for(const [chatId,list] of filesByChat){const knowledgeRows=(byChat.get(chatId)||[]).slice(-14);for(const f of list.slice(0,10)){const ft=new Set(tokens(f.name||'',40));for(const i of knowledgeRows){const it=itemTokens.get(i.id)||new Set();const ov=overlap(ft,it);const temporal=Number(f.updatedAt||0)>=Number(i.updatedAt||0);if(ov.shared.length<1&&!(temporal&&['decision','follow-up','version'].includes(i.kind)))continue;const key=`knowledge:${i.id}>file:${f.id}`;if(edgeKeys.has(key))continue;edgeKeys.add(key);edges.push({id:hashString(key),from:`knowledge:${i.id}`,to:`file:${f.id}`,relation:'artifact-produced-after',confidence:Number(Math.min(.88,.52+(ov.score*.25)+(temporal?.08:0)).toFixed(3)),sharedTerms:ov.shared.slice(0,6),sourceChatId:chatId});}}
    }
    const stale=[];for(const family of versions.families||[]){for(const entry of family.entries||[]){if(entry.status!=='older-observed')continue;stale.push({id:entry.id,status:'older-version',reason:`Observed ${family.current.versionText} after ${entry.versionText}.`,newerId:family.current.id,newerVersion:family.current.versionText,label:entry.label,chatId:entry.chatId||'',updatedAt:entry.updatedAt||0});}}
    const staleIds=new Set(stale.map((s)=>s.id));for(const edge of edges){if(!staleIds.has(edge.from))continue;const target=nodes.find((n)=>n.id===edge.to);if(!target)continue;if(staleIds.has(target.id))continue;staleIds.add(target.id);stale.push({id:target.id,status:'possibly-stale',reason:'This evidence depends on an older observed version.',upstreamId:edge.from,label:target.label,chatId:target.chatId||'',updatedAt:target.updatedAt||0});}
    return {nodes:nodes.slice(0,360),edges:edges.sort((a,b)=>b.confidence-a.confidence).slice(0,160),stale:stale.slice(0,60),chatCount:chatMap.size};
  }

  function itemByChat(items=[]){const map=new Map();for(const i of items){if(!i.chatId)continue;const list=map.get(i.chatId)||[];list.push(i);map.set(i.chatId,list);}for(const list of map.values())list.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));return map;}
  function buildDuplicates({chats=[],items=[],coordination={}}={}){
    const byChat=itemByChat(items);const rows=[];
    for(const pair of coordination.pairs||[]){if(pair.kind!=='parallel-overlap')continue;const left=(byChat.get(pair.left.id)||[]).slice(0,10),right=(byChat.get(pair.right.id)||[]).slice(0,10);let conceptMatch='';const rightKeys=new Set(right.map(canonical));for(const item of left){const key=canonical(item);if(rightKeys.has(key)){conceptMatch=key;break;}}
      const sameTitle=text(pair.left.title,180).toLocaleLowerCase()===text(pair.right.title,180).toLocaleLowerCase();const score=Math.min(1,Number(pair.score||0)+(conceptMatch?.22:0)+(sameTitle?.18:0));if(score<.55)continue;rows.push({id:hashString(`dup:${pair.id}:${conceptMatch}`),kind:'possible-duplicate',score:Number(score.toFixed(3)),sharedTerms:(pair.sharedTerms||[]).slice(0,6),sharedConcept:conceptMatch,left:pair.left,right:pair.right,reason:conceptMatch?'Both active chats contain the same source-backed project concept.':'Both active chats have strong overlapping work focus. Review before duplicating effort.'});}
    return rows.sort((a,b)=>b.score-a.score).slice(0,12);
  }

  function buildHandoffs({chats=[],items=[],files=[]}={}){
    const working=chats.filter((c)=>['active','attention'].includes(chatBucket(c))).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,18);
    const other=chats.filter((c)=>!working.some((w)=>w.id===c.id)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,36);
    const byChat=itemByChat(items);const fileByChat=new Map();for(const f of files){if(!f.chatId)continue;const list=fileByChat.get(f.chatId)||[];list.push(f);fileByChat.set(f.chatId,list);}const vectors=new Map(chats.slice(0,80).map((c)=>[c.id,new Set(tokens(`${c.title||''} ${c.lastUserExcerpt||''} ${c.lastExcerpt||''}`,48))]));
    const sources=[...working,...other];const rows=[];
    for(const target of working){const tt=vectors.get(target.id)||new Set();for(const source of sources){if(source.id===target.id)continue;const recent=(byChat.get(source.id)||[]).filter((i)=>IMPORTANT_KINDS.has(i.kind)).slice(0,6);const artifacts=(fileByChat.get(source.id)||[]).slice(0,3);if(!recent.length&&!artifacts.length)continue;const st=vectors.get(source.id)||new Set();const ov=overlap(tt,st);if(ov.shared.length<2||ov.score<.25)continue;const sourceAt=Math.max(Number(source.updatedAt||0),...recent.map((i)=>Number(i.updatedAt||0)),...artifacts.map((f)=>Number(f.updatedAt||0)));if(sourceAt<=Number(target.updatedAt||0)-7*86400000)continue;const evidence=recent.slice(0,3).map((i)=>({id:i.id,kind:i.kind,label:sourceLabel(i),updatedAt:Number(i.updatedAt||0),url:i.url||i.sourceUrl||''}));if(artifacts[0])evidence.push({id:artifacts[0].id,kind:'artifact',label:text(artifacts[0].name||'Artifact',220),updatedAt:Number(artifacts[0].updatedAt||0),url:artifacts[0].externalUrl||artifacts[0].href||''});const score=Math.min(1,.42+ov.score*.45+(chatBucket(source)==='completed'?.08:0));if(score<.56)continue;rows.push({id:hashString(`handoff:${source.id}:${target.id}:${evidence.map((e)=>e.id).join(',')}`),kind:'cross-chat-handoff',score:Number(score.toFixed(3)),sharedTerms:ov.shared.slice(0,6),source:{id:source.id,title:text(source.title||'Source chat',180),url:source.url||'',bucket:chatBucket(source),updatedAt:Number(source.updatedAt||0)},target:{id:target.id,title:text(target.title||'Target chat',180),url:target.url||'',bucket:chatBucket(target),updatedAt:Number(target.updatedAt||0)},evidence:evidence.slice(0,4)});}
    }
    const seen=new Set();return rows.sort((a,b)=>b.score-a.score).filter((r)=>{const key=`${r.source.id}>${r.target.id}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,16);
  }

  function buildChanges({chats=[],items=[],files=[],watermarkAt=0}={}){
    const at=Math.max(0,Number(watermarkAt||0));const rows=[];
    for(const i of items){if(Number(i.updatedAt||0)<=at)continue;rows.push({id:`knowledge:${i.id}`,kind:i.kind||'knowledge',label:sourceLabel(i),detail:text(i.text||'',400),chatId:i.chatId||'',url:i.url||i.sourceUrl||'',updatedAt:Number(i.updatedAt||0)});}
    for(const f of files){if(Number(f.updatedAt||0)<=at)continue;rows.push({id:`file:${f.id}`,kind:'artifact',label:text(f.name||'Artifact',220),detail:'New or updated project artifact.',chatId:f.chatId||'',url:f.externalUrl||f.href||'',updatedAt:Number(f.updatedAt||0)});}
    for(const c of chats){if(Number(c.updatedAt||0)<=at)continue;rows.push({id:`chat:${c.id}`,kind:`chat-${chatBucket(c)}`,label:text(c.title||'Chat update',220),detail:text(c.statusDetail||c.lastExcerpt||'',400),chatId:c.id,url:c.url||'',updatedAt:Number(c.updatedAt||0)});}
    rows.sort((a,b)=>b.updatedAt-a.updatedAt);const unique=[];const seen=new Set();for(const row of rows){const key=`${row.kind}:${row.label.toLocaleLowerCase()}:${row.chatId}`;if(seen.has(key))continue;seen.add(key);unique.push(row);if(unique.length>=30)break;}
    return {watermarkAt:at,items:unique,totalSinceWatermark:rows.length,latestAt:rows[0]?.updatedAt||at};
  }

  function generalityStats(items=[]){const concepts=new Map();for(const i of items){const key=canonical(i);const row=concepts.get(key)||{chatIds:new Set(),count:0};if(i.chatId)row.chatIds.add(i.chatId);row.count+=1;concepts.set(key,row);}return concepts;}
  function itemGeneralScore(item,stats){const key=canonical(item),row=stats.get(key);let score=0;if(item.memoryPinned)score+=4;if((row?.chatIds?.size||0)>=2)score+=3;if(['command','code','recommendation','decision','reference','repository','document'].includes(item.kind))score+=1;const ts=tokens(`${item.title||''} ${item.text||''}`,32);if(ts.some((t)=>GENERAL_HINTS.has(t)))score+=2;return score;}
  function compileChatContext({project={},chat={},chats=[],items=[],files=[],brain={},intelligence={}}={}){
    const targetTerms=new Set(tokens(`${chat.title||''} ${chat.note||''} ${chat.lastUserExcerpt||''} ${chat.lastExcerpt||''}`,64));const stats=generalityStats(items);const candidates=[];
    for(const i of items){if(String(i.memoryDisposition||'active')==='ignored'||String(i.memoryDisposition||'active')==='superseded')continue;const its=new Set(tokens(`${i.title||''} ${i.text||''}`,48));const ov=overlap(targetTerms,its);const general=itemGeneralScore(i,stats);const sameChat=i.chatId===chat.id;const score=(Number(i.confidence??.8)*.5)+(ov.score*1.5)+(Math.min(5,general)*.16)+(i.memoryPinned?.5:0)+(sameChat?.1:0);if(ov.shared.length<1&&general<2&&!i.memoryPinned)continue;candidates.push({id:i.id,kind:i.kind||'',label:sourceLabel(i),text:text(i.text||i.title||'',700),url:i.url||i.sourceUrl||'',chatId:i.chatId||'',updatedAt:Number(i.updatedAt||0),score:Number(score.toFixed(3)),sharedTerms:ov.shared.slice(0,6),generalScore:general,pinned:Boolean(i.memoryPinned)});}
    candidates.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.score-a.score||b.updatedAt-a.updatedAt);
    const relevant=candidates.slice(0,12);const generalLessons=candidates.filter((r)=>r.generalScore>=3&&r.chatId!==chat.id).slice(0,6);
    const staleIds=new Set((intelligence.dependencies?.stale||[]).map((s)=>s.id));const warnings=relevant.filter((r)=>staleIds.has(`knowledge:${r.id}`)).map((r)=>({id:r.id,label:r.label,reason:(intelligence.dependencies.stale||[]).find((s)=>s.id===`knowledge:${r.id}`)?.reason||'Possibly stale'})).slice(0,6);
    const handoffs=(intelligence.handoffs||[]).filter((h)=>h.target.id===chat.id).slice(0,4);const duplicates=(intelligence.duplicates||[]).filter((d)=>d.left.id===chat.id||d.right.id===chat.id).slice(0,4);const currentVersion=intelligence.versions?.currentProjectVersion||'';
    const filesForChat=files.filter((f)=>f.chatId===chat.id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,3).map((f)=>({id:f.id,name:text(f.name||'Artifact',220),url:f.externalUrl||f.href||'',updatedAt:Number(f.updatedAt||0)}));
    const packet={schema:'project-constellation-chat-context',version:1,projectId:project.id||'',projectName:project.name||'Project',chatId:chat.id||'',chatTitle:chat.title||'Chat',currentProjectVersion:currentVersion,relevant,generalLessons,warnings,handoffs,duplicates,artifacts:filesForChat,generatedAt:Date.now()};
    packet.fingerprint=hashString(JSON.stringify({projectId:packet.projectId,chatId:packet.chatId,currentProjectVersion:packet.currentProjectVersion,relevant:relevant.map((r)=>[r.id,r.updatedAt]),general:generalLessons.map((r)=>[r.id,r.updatedAt]),warnings:warnings.map((w)=>w.id),handoffs:handoffs.map((h)=>h.id),duplicates:duplicates.map((d)=>d.id)}));
    return packet;
  }

  function contextMarkdown(packet={}){
    const lines=[`# Project Context — ${packet.projectName||'Project'}`,`Target chat: ${packet.chatTitle||'Chat'}`];if(packet.currentProjectVersion)lines.push(`Current observed project version: ${packet.currentProjectVersion}`);lines.push('');
    if(packet.warnings?.length){lines.push('## Version / dependency warnings');for(const w of packet.warnings)lines.push(`- ${w.label}: ${w.reason}`);lines.push('');}
    if(packet.handoffs?.length){lines.push('## Cross-chat handoffs');for(const h of packet.handoffs)lines.push(`- From ${h.source.title}: ${(h.evidence||[]).map((e)=>e.label).join('; ')}`);lines.push('');}
    if(packet.relevant?.length){lines.push('## Relevant project context');for(const r of packet.relevant.slice(0,10))lines.push(`- [${r.kind||'context'}] ${r.text||r.label}`);lines.push('');}
    if(packet.generalLessons?.length){lines.push('## Reusable project-wide lessons');for(const r of packet.generalLessons.slice(0,6))lines.push(`- ${r.text||r.label}`);lines.push('');}
    if(packet.duplicates?.length){lines.push('## Coordination warning');lines.push('- Another active project chat may overlap with this task. Review the Project Room before duplicating work.');lines.push('');}
    lines.push('Use only the context above that is still relevant to the current task. Project Constellation prepared this packet from source-backed project evidence; it was not sent automatically.');return lines.join('\n');
  }

  function compileAutopilot({project={},chats=[],items=[],files=[],brain={},intelligence={},ledger={}}={}){
    const proposals=[];
    function add(type,targetChat,summary,reason,preview,refs=[],priority=.5){const targetId=targetChat?.id||'';const fingerprint=hashString(JSON.stringify({type,targetId,summary,refs:refs.map((r)=>r.id||r)}));const policy=ledger[fingerprint]||{};if(policy.status==='denied'&&policy.fingerprint===fingerprint)return;proposals.push({id:`auto:${fingerprint}`,fingerprint,type,targetChatId:targetId,targetChatTitle:targetChat?.title||'',targetChatUrl:targetChat?.url||'',summary,reason,preview:text(policy.editedText||preview,12000),priority,status:policy.status||'pending',reviewedAt:Number(policy.reviewedAt||0),requiresApproval:true,providerWrite:type==='context-refresh'||type==='handoff',refs:refs.slice(0,8)});}
    for(const d of (intelligence.duplicates||[]).slice(0,6)){const target=chats.find((c)=>c.id===d.right.id)||d.right;add('duplicate-review',target,'Possible duplicate work',`${d.left.title} and ${d.right.title} overlap strongly. Constellation will not stop or redirect either chat automatically.`,`Review whether ${d.left.title} and ${d.right.title} are duplicating the same work before continuing.`,[{id:d.id}],.86);}
    for(const h of (intelligence.handoffs||[]).slice(0,8)){const target=chats.find((c)=>c.id===h.target.id)||h.target;const preview=`Handoff from ${h.source.title}:\n${(h.evidence||[]).map((e)=>`- ${e.label}`).join('\n')}`;add('handoff',target,`Handoff available from ${h.source.title}`,'Another project chat has source-backed work that appears relevant to this chat.',preview,[{id:h.id},...(h.evidence||[])],.78);}
    for(const stale of (intelligence.dependencies?.stale||[]).filter((s)=>s.status==='possibly-stale').slice(0,6)){const target=chats.find((c)=>c.id===stale.chatId);add('stale-version',target,'Dependency may be stale',stale.reason,`Review before relying on: ${stale.label}. ${stale.reason}`,[{id:stale.id}],.7);}
    const active=chats.filter((c)=>['active','attention'].includes(chatBucket(c))).slice(0,8);for(const target of active){const packet=compileChatContext({project,chat:target,chats,items,files,brain,intelligence});const hasExternal=packet.handoffs.length||packet.warnings.length||packet.generalLessons.length>=2;if(!hasExternal)continue;add('context-refresh',target,'Fresh project context is available','Relevant cross-chat evidence, reusable project lessons, or version warnings changed.',contextMarkdown(packet),[{id:packet.fingerprint}],.66);}
    proposals.sort((a,b)=>b.priority-a.priority||a.summary.localeCompare(b.summary));return {proposals:proposals.slice(0,20),pending:proposals.filter((p)=>p.status==='pending').length,approved:proposals.filter((p)=>p.status==='approved').length};
  }

  function compileProjectIntelligence({project={},chats=[],items=[],files=[],brain={},ledger={},watermarkAt=0}={}){
    const versions=buildVersionAwareness({project,items,files});
    const dependencies=buildDependencies({chats,items,files,versions});
    const duplicates=buildDuplicates({chats,items,coordination:brain.coordination||{}});
    const handoffs=buildHandoffs({chats,items,files});
    const changes=buildChanges({chats,items,files,watermarkAt});
    const base={schema:'project-constellation-project-intelligence',version:VERSION,projectId:project.id||'',projectName:project.name||'Project',versions,dependencies,duplicates,handoffs,changes};
    const autopilot=compileAutopilot({project,chats,items,files,brain,intelligence:base,ledger});
    const fingerprint=hashString(JSON.stringify({v:VERSION,projectId:base.projectId,versions:versions.families.map((f)=>[f.family,f.current?.versionText]),edges:dependencies.edges.map((e)=>e.id),stale:dependencies.stale.map((s)=>[s.id,s.status]),duplicates:duplicates.map((d)=>d.id),handoffs:handoffs.map((h)=>h.id),changes:changes.items.map((c)=>[c.id,c.updatedAt]),autopilot:autopilot.proposals.map((p)=>[p.fingerprint,p.status])}));
    return {...base,autopilot,fingerprint,compiledAt:Date.now()};
  }

  globalThis.ProjectConstellationProjectIntelligenceCore=Object.freeze({VERSION,text,hashString,tokens,overlap,parseVersion,compareVersion,artifactFamily,buildVersionAwareness,buildDependencies,buildDuplicates,buildHandoffs,buildChanges,compileChatContext,contextMarkdown,compileAutopilot,compileProjectIntelligence});
  if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.ProjectConstellationProjectIntelligenceCore;
})();
