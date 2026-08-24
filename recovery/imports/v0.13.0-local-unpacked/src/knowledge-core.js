(() => {
  'use strict';

  const VERSION = 2;
  const KINDS = Object.freeze([
    'recommendation','link','repository','package','mod','media','document','command','code','decision','follow-up','idea','version','reference'
  ]);

  const normalize = (value, max = 16000) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  const compact = (value, max = 600) => normalize(value, max).replace(/\s*\n\s*/g, ' ');
  const hashString = (value) => {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  };
  const unique = (values, limit = 100) => [...new Set((values || []).filter(Boolean))].slice(0, limit);
  const cleanListPrefix = (line) => String(line || '').replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, '').trim();
  const humanizeSlug = (value) => String(value || '').replace(/\.(?:git|html?)$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

  function canonicalUrl(value) {
    let raw = String(value || '').trim().replace(/[),.;!?\]}>'"]+$/g, '');
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const url = new URL(raw);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|share$|si$|feature$)/i.test(key)) url.searchParams.delete(key);
      return url.href;
    } catch (_) { return raw; }
  }

  function urlInfo(value) {
    const url = canonicalUrl(value);
    if (!url) return { url: '', domain: '', kind: 'link', subtype: 'external' };
    let host = '', parts = [];
    try { const parsed = new URL(url); host = parsed.hostname.toLowerCase().replace(/^www\./, ''); parts = parsed.pathname.split('/').filter(Boolean); } catch (_) {}
    if ((host === 'github.com' || host === 'gitlab.com') && parts.length >= 2) return { url, domain: host, kind: 'repository', subtype: host === 'github.com' ? 'github-repository' : 'gitlab-repository', key: `repo:${host}:${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`, label: `${parts[0]}/${parts[1].replace(/\.git$/i,'')}` };
    if (host === 'curseforge.com' || host === 'modrinth.com' || host === 'nexusmods.com' || host === 'mcpedl.com' || host === 'planetminecraft.com' || (host === 'minecraft.net' && parts.some((part) => /marketplace/i.test(part)))) {
      const subtype = host === 'curseforge.com' ? 'curseforge' : host === 'modrinth.com' ? 'modrinth' : host === 'nexusmods.com' ? 'nexus-mods' : host === 'mcpedl.com' ? 'mcpedl' : host === 'planetminecraft.com' ? 'planet-minecraft' : 'minecraft-marketplace';
      const slug = [...parts].reverse().find((part) => !/^(?:minecraft|mc-mods|mods|modpacks|projects?|marketplace|content)$/i.test(part)) || parts.at(-1) || host;
      return { url, domain: host, kind: 'mod', subtype, key: `mod:${host}:${parts.slice(0,5).join('/').toLowerCase()}`, label: humanizeSlug(slug) };
    }
    if (/^(?:npmjs\.com|pypi\.org|crates\.io|mvnrepository\.com|central\.sonatype\.com)$/.test(host)) return { url, domain: host, kind: 'package', subtype: 'package-registry', key: `pkg:${host}:${parts.join('/').toLowerCase()}` };
    if (/(^|\.)(drive\.google\.com|docs\.google\.com|dropbox\.com|1drv\.ms|onedrive\.live\.com)$/.test(host)) return { url, domain: host, kind: 'document', subtype: 'cloud-document', key: `doc:${url.toLowerCase()}` };
    if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|vimeo\.com)$/.test(host)) return { url, domain: host, kind: 'media', subtype: 'media', key: `media:${url.toLowerCase()}` };
    return { url, domain: host, kind: 'link', subtype: 'external', key: `url:${url.toLowerCase()}` };
  }

  function textUrls(text) {
    const out = [];
    for (const match of String(text || '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
      const value = canonicalUrl(match[0]);
      if (value) out.push({ href: value, text: '', context: '' });
    }
    for (const match of String(text || '').matchAll(/\[([^\]]{1,240})\]\((https?:\/\/[^\s)]+)\)/g)) {
      const href = canonicalUrl(match[2]); if (href) out.push({ href, text: compact(match[1], 240), context: '' });
    }
    return out;
  }

  function sourceLinks(turn) {
    const rows = [...(Array.isArray(turn?.links) ? turn.links : []), ...textUrls(turn?.text || '')];
    const map = new Map();
    for (const row of rows) {
      const href = canonicalUrl(row?.href || row?.url || ''); if (!href) continue;
      const old = map.get(href) || {};
      map.set(href, { href, text: compact(row?.text || old.text || '', 260), context: compact(row?.context || old.context || '', 700) });
    }
    return [...map.values()].slice(0, 80);
  }

  function fencedBlocks(text) {
    const out = [];
    for (const match of String(text || '').matchAll(/```([\w#+.-]{0,30})\s*\n([\s\S]*?)```/g)) {
      out.push({ language: String(match[1] || '').toLowerCase(), text: String(match[2] || '').trim().slice(0, 32000) });
      if (out.length >= 24) break;
    }
    return out;
  }

  function sourceCodeBlocks(turn) {
    const rows = [...(Array.isArray(turn?.codeBlocks) ? turn.codeBlocks : []), ...fencedBlocks(turn?.text || '')];
    const seen = new Set(), out = [];
    for (const row of rows) {
      const text = String(row?.text || '').trim().slice(0, 32000); if (!text) continue;
      const language = String(row?.language || '').toLowerCase().slice(0, 30);
      const sig = `${language}:${hashString(text)}`; if (seen.has(sig)) continue; seen.add(sig);
      out.push({ language, text }); if (out.length >= 24) break;
    }
    return out;
  }

  function codeSymbols(code) {
    const found = [];
    const patterns = [
      [/\b(?:class|interface|enum|record|struct|trait|type)\s+([A-Za-z_$][\w$]*)/g, 'type'],
      [/\b(?:function|def|fn)\s+([A-Za-z_$][\w$]*)\s*\(/g, 'function'],
      [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, 'function'],
      [/\b(?:public|private|protected|static|async|final|override|virtual|synchronized|export\s+)?\s*[A-Za-z_$][\w$<>,.?\[\]]*\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/g, 'method']
    ];
    for (const [pattern, type] of patterns) for (const match of String(code || '').matchAll(pattern)) {
      found.push(`${type}:${match[1]}`); if (found.length >= 80) return unique(found, 80);
    }
    return unique(found, 80);
  }

  function fileReferences(text) {
    const out = [];
    const extensions = 'js|mjs|cjs|ts|tsx|jsx|json|md|java|kt|kts|py|rs|go|cs|cpp|c|h|hpp|gradle|toml|yml|yaml|xml|html|css|scss|sql|ps1|bat|cmd|sh|jar|zip|7z|rar|dll|exe|png|jpg|jpeg|webp|gif|svg|pdf|docx|xlsx|pptx';
    const pathPattern = new RegExp('(?:^|[\\s\"\'`(])((?:[A-Za-z]:\\\\|\\.?\\.?\\/|\\/)?(?:[\\w.@+ -]+[\\\\/])+[\\w.@+ -]+\\.(?:'+extensions+'))(?=$|[\\s\"\'`),:;])','gim');
    for (const match of String(text || '').matchAll(pathPattern)) { out.push(match[1].trim()); if (out.length >= 80) break; }
    if (out.length < 80) {
      const filePattern = new RegExp('(?:^|[\\s\"\'`(])([A-Za-z0-9_.@+-]{1,120}\\.(?:'+extensions+'))(?=$|[\\s\"\'`),:;.?!}\\]])','gim');
      for (const match of String(text || '').matchAll(filePattern)) { out.push(match[1].trim()); if (out.length >= 80) break; }
    }
    return unique(out, 80);
  }

  function versionTokens(text) {
    const out = [];
    for (const match of String(text || '').matchAll(/(?:\b(?:version|release|build)\s*[:#=-]?\s*|\bv)(\d{1,4}(?:\.\d{1,4}){1,3}(?:[-+][0-9A-Za-z.-]+)?)/gi)) {
      out.push(match[1]); if (out.length >= 24) break;
    }
    return unique(out, 24);
  }

  const RECOMMEND_RE = /\b(recommend(?:ed|ation|ing)?|suggest(?:ed|ion)?|best\b|top pick|my pick|use\b|install\b|try\b|consider\b|worth using|good option|great option|strongest|winner|pick\b|choose\b|go with)\b/i;
  const FOLLOW_RE = /\b(todo|to do|remaining|still need(?:s)?|needs? to|next step|follow[- ]?up|blocked on|waiting on|not yet|unfinished|pending|left to do|continue with)\b/i;
  const DECISION_RE = /\b(decided|decision|selected|chosen|approved|final choice|going with|we(?:'ll| will) use|use this as|canonical|source of truth|locked in|keep\b|remove\b)\b/i;
  const IDEA_RE = /\b(idea|i want|we should|should add|add support for|feature request|would be great|want to add|plan is|goal is)\b/i;
  const COMMAND_RE = /^\s*(?:\$\s*)?(?:sudo\s+)?(?:git|gh|npm|pnpm|yarn|bun|npx|node|python\d*|pip\d*|poetry|uv|java|javac|gradle|gradlew|mvn|cargo|go|dotnet|powershell|pwsh|cmd|winget|choco|scoop|docker|kubectl|helm|curl|wget|Invoke-WebRequest|Get-|Set-|New-|Remove-|Start-|Stop-|Test-|where|reg|netsh|ipconfig|sfc|dism)\b/i;

  function lineCandidates(text) {
    const lines = String(text || '').split(/\n/).map((line) => line.trim()).filter(Boolean);
    const out = [];
    let section = '';
    for (const raw of lines.slice(0, 1200)) {
      if (/^#{1,6}\s+/.test(raw) || /:\s*$/.test(raw)) {
        const heading = raw.replace(/^#{1,6}\s+/, '').replace(/:\s*$/, '').trim();
        section = /recommend|best|option|tool|mod|package|resource|link/i.test(heading) ? 'recommendation' : /next|todo|follow|remaining/i.test(heading) ? 'follow-up' : /decision|chosen|selected|final/i.test(heading) ? 'decision' : '';
      }
      const isList = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+/.test(raw);
      const textLine = cleanListPrefix(raw);
      if (textLine.length < 4 || textLine.length > 1400) continue;
      out.push({ raw, text: textLine, isList, section });
    }
    return out;
  }

  function itemId(turnId, kind, canonicalKey, text) { return `${turnId}:k:${hashString(`${kind}|${canonicalKey || ''}|${text || ''}`)}`; }

  function extractTurnKnowledge(turn = {}, context = {}) {
    if (!turn?.id || !turn?.chatId) return { fingerprint: '', items: [] };
    const text = normalize(turn.text || '', 100000);
    const role = String(turn.role || 'unknown').toLowerCase();
    const links = sourceLinks(turn);
    const codeBlocks = sourceCodeBlocks(turn);
    const fingerprint = hashString(JSON.stringify({ v: VERSION, role, text, links, codeBlocks }));
    const base = {
      sourceTurnId: turn.id, chatId: turn.chatId, providerId: turn.providerId || context.providerId || '', projectId: context.projectId || turn.projectId || '',
      workspaceProjectId: context.workspaceProjectId || turn.workspaceProjectId || '', workspaceProjectName: context.workspaceProjectName || '', sourceRole: role,
      sourceOrdinal: Number(turn.ordinal || 0), sourceUrl: turn.url || context.chatUrl || '', source: turn.source || 'captured-turn', updatedAt: Number(turn.updatedAt || Date.now())
    };
    const items = [];
    const add = (kind, payload = {}) => {
      const body = compact(payload.text || payload.title || '', 5000); if (!body && !payload.url) return;
      const canonicalKey = payload.canonicalKey || `${kind}:${hashString(`${payload.url || ''}|${body.toLowerCase()}`)}`;
      const id = itemId(turn.id, kind, canonicalKey, body);
      items.push({ id, kind, subtype: payload.subtype || '', title: compact(payload.title || body, 260), text: body, url: payload.url || '', domain: payload.domain || '', canonicalKey,
        language: payload.language || '', symbols: unique(payload.symbols || [], 80), fileRefs: unique(payload.fileRefs || [], 80), versions: unique(payload.versions || [], 24), relatedUrls: unique(payload.relatedUrls || [], 16),
        confidence: Math.max(0, Math.min(1, Number(payload.confidence ?? 0.8))), tags: unique([kind, payload.subtype, payload.domain, payload.language, ...(payload.tags || [])], 32), fingerprint, ...base });
    };

    for (const link of links) {
      const info = urlInfo(link.href); if (!info.url) continue;
      const title = compact(link.text || link.context || info.label || info.domain || info.url, 260);
      add(info.kind, { title, text: compact(link.context || link.text || info.url, 900), url: info.url, domain: info.domain, subtype: info.subtype, canonicalKey: info.key, confidence: 0.99 });
    }

    const lines = lineCandidates(text);
    for (const row of lines) {
      const urls = textUrls(row.text).map((item) => item.href);
      const decisionLike = DECISION_RE.test(row.text);
      const explicitRecommendation = /\b(recommend(?:ed|ation|ing)?|suggest(?:ed|ion)?|best\b|top pick|my pick|worth using|good option|great option|strongest|winner)\b/i.test(row.text);
      if (role === 'assistant' && (RECOMMEND_RE.test(row.text) || (row.isList && row.section === 'recommendation')) && (!decisionLike || explicitRecommendation)) {
        add('recommendation', { title: row.text, text: row.text, relatedUrls: urls, confidence: RECOMMEND_RE.test(row.text) ? 0.9 : 0.76 });
      }
      if (FOLLOW_RE.test(row.text)) add('follow-up', { title: row.text, text: row.text, relatedUrls: urls, confidence: 0.9 });
      if (DECISION_RE.test(row.text) && (role === 'assistant' || role === 'user')) add('decision', { title: row.text, text: row.text, relatedUrls: urls, confidence: 0.82 });
      if (role === 'user' && IDEA_RE.test(row.text)) add('idea', { title: row.text, text: row.text, relatedUrls: urls, confidence: 0.86 });
      if (COMMAND_RE.test(row.text) && row.text.length < 1200) add('command', { title: row.text.slice(0, 180), text: row.text, confidence: 0.92 });
    }

    for (const block of codeBlocks) {
      const language = block.language || '';
      const symbols = codeSymbols(block.text);
      const fileRefs = fileReferences(block.text);
      const versions = versionTokens(block.text);
      const commandish = /^(?:bash|shell|sh|zsh|fish|powershell|ps1|cmd|bat|console|terminal)$/i.test(language) || block.text.split(/\n/).filter(Boolean).slice(0, 8).some((line) => COMMAND_RE.test(line));
      add(commandish ? 'command' : 'code', {
        title: `${language || (commandish ? 'command' : 'code')} · ${symbols.slice(0, 3).map((s) => s.split(':').pop()).join(', ') || compact(block.text.split(/\n/)[0], 120) || 'snippet'}`,
        text: block.text, language, symbols, fileRefs, versions, confidence: 0.98,
        canonicalKey: `${commandish ? 'command' : 'code'}:${language}:${hashString(block.text)}`
      });
    }

    const refs = fileReferences(text);
    if (refs.length) add('reference', { title: refs.slice(0, 4).join(' · '), text: refs.join('\n'), fileRefs: refs, subtype: 'file-reference', confidence: 0.95, canonicalKey: `refs:${hashString(refs.join('|').toLowerCase())}` });
    const versions = versionTokens(text);
    if (versions.length) add('version', { title: `Versions: ${versions.join(', ')}`, text: versions.join(' '), versions, confidence: 0.93, canonicalKey: `versions:${versions.join('|')}` });

    const deduped = [...new Map(items.map((item) => [`${item.kind}|${item.canonicalKey}|${item.text.toLowerCase()}`, item])).values()];
    return { fingerprint, items: deduped.slice(0, 180) };
  }

  const api = Object.freeze({ VERSION, KINDS, normalize, compact, hashString, canonicalUrl, urlInfo, sourceLinks, sourceCodeBlocks, codeSymbols, fileReferences, versionTokens, extractTurnKnowledge });
  globalThis.ProjectConstellationKnowledgeCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
