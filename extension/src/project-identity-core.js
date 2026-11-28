(() => {
  'use strict';

  const VERSION = 2;
  const DEFAULT_ICON = 'pc:folder';
  const DEFAULT_COLOR = '#7d92ff';
  const EMOJIS = Object.freeze(['✦','📁','💻','🧩','🛠️','🎮','🔬','💡','🎨','🧠','🚀','📚','📝','💼','🏠','⚙️','✨','🌐','🛰️','🛡️','🔥','🌙','🌿','🎵','📦','🔧','🧪','📌','⭐','❤️','🌈','🪄','🧰','🧱','🕹️','🎯','🗂️','📊','🔒','☁️','🐛','🌸','🍄','💎','⚡','🛸','🎬','🎧','🧵']);
  const COLORS = Object.freeze(['#7d92ff','#8b5cf6','#4fa3ff','#27b5a9','#45bd8c','#84cc5a','#f2c94c','#ff9f43','#f47b61','#ff5c64','#e96db2','#a985ff','#8d99ae','#64748b','#c08457','#f5a3bd']);

  // Compact, self-contained outline icons so project/chat identity never depends on a CDN,
  // font package, or provider DOM. Bodies use currentColor and a 24x24 viewBox.
  const VECTOR_ICONS = Object.freeze({
    folder:{label:'Folder',body:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>'},
    sparkles:{label:'Magic',body:'<path d="m12 3 1.1 3.2L16 7.5l-2.9 1.3L12 12l-1.1-3.2L8 7.5l2.9-1.3zM6.5 13l.8 2.2 2.2.8-2.2.8L6.5 19l-.8-2.2-2.2-.8 2.2-.8zM18 12l.9 2.6 2.6.9-2.6.9L18 19l-.9-2.6-2.6-.9 2.6-.9z"/>'},
    code:{label:'Code',body:'<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 5l-3 14"/>'},
    terminal:{label:'Terminal',body:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12.5 15H17"/>'},
    wrench:{label:'Tools',body:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-3-3z"/>'},
    gamepad:{label:'Games',body:'<path d="M8.5 8h7a5.5 5.5 0 0 1 5.3 7l-.7 2.5a2.5 2.5 0 0 1-4.3 1l-1.1-1.5H9.3l-1.1 1.5a2.5 2.5 0 0 1-4.3-1L3.2 15a5.5 5.5 0 0 1 5.3-7z"/><path d="M7 11v4M5 13h4M16.5 12h.01M18.5 14h.01"/>'},
    book:{label:'Book',body:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5z"/>'},
    graduation:{label:'Study',body:'<path d="m3 9 9-5 9 5-9 5z"/><path d="M7 12.5V17c3 2 7 2 10 0v-4.5M21 9v6"/>'},
    pencil:{label:'Writing',body:'<path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16zM14.7 6.5l3 3"/>'},
    compass:{label:'Explore',body:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'},
    globe:{label:'Web',body:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'},
    briefcase:{label:'Work',body:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>'},
    chart:{label:'Analytics',body:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'},
    flask:{label:'Lab',body:'<path d="M9 3h6M10 3v6l-5 8.5A2.3 2.3 0 0 0 7 21h10a2.3 2.3 0 0 0 2-3.5L14 9V3M7.5 15h9"/>'},
    brain:{label:'Brain',body:'<path d="M9.5 4.5A3 3 0 0 0 5 7a3 3 0 0 0 .5 5.8A3.5 3.5 0 0 0 9 19h1V5.5a2 2 0 0 0-.5-1zM14.5 4.5A3 3 0 0 1 19 7a3 3 0 0 1-.5 5.8A3.5 3.5 0 0 1 15 19h-1V5.5a2 2 0 0 1 .5-1z"/><path d="M7 9h3M14 9h3M7.5 14H10M14 14h2.5"/>'},
    heart:{label:'Heart',body:'<path d="M20.5 5.8a5 5 0 0 0-7.1 0L12 7.2l-1.4-1.4a5 5 0 0 0-7.1 7.1L12 21l8.5-8.1a5 5 0 0 0 0-7.1z"/>'},
    flower:{label:'Nature',body:'<circle cx="12" cy="12" r="2"/><path d="M12 10c-4-1-4-6 0-6s4 5 0 6M14 12c1-4 6-4 6 0s-5 4-6 0M12 14c4 1 4 6 0 6s-4-5 0-6M10 12c-1 4-6 4-6 0s5-4 6 0"/>'},
    paw:{label:'Animals',body:'<path d="M8 13c2-3 6-3 8 0 2 3 .2 6-4 6s-6-3-4-6z"/><circle cx="6" cy="9" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="18" cy="9" r="2"/>'},
    dumbbell:{label:'Fitness / combat',body:'<path d="M6 8v8M3.5 9.5v5M18 8v8M20.5 9.5v5M6 12h12"/>'},
    shield:{label:'Security',body:'<path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>'},
    palette:{label:'Design',body:'<path d="M12 3a9 9 0 0 0 0 18h1.3a1.7 1.7 0 0 0 1.2-2.9l-.3-.3a1.7 1.7 0 0 1 1.2-2.9H17a4 4 0 0 0 4-4A8 8 0 0 0 12 3z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="10" cy="6.8" r=".7"/><circle cx="14" cy="6.8" r=".7"/><circle cx="16.5" cy="10" r=".7"/>'},
    music:{label:'Music',body:'<path d="M9 18V6l10-2v12M9 10l10-2"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>'},
    package:{label:'Package',body:'<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>'},
    gem:{label:'Gem',body:'<path d="m6 4-4 6 10 11 10-11-4-6zM2 10h20M8 4l-2 6 6 11 6-11-2-6"/>'},
    moon:{label:'Night',body:'<path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>'},
    plane:{label:'Travel',body:'<path d="m2 16 20-8-7 13-3-7zM12 14 22 8"/>'},
    scale:{label:'Legal / balance',body:'<path d="M12 3v18M7 5h10M4 8l-3 6h6zM20 8l-3 6h6zM7 21h10"/>'},
    stethoscope:{label:'Health',body:'<path d="M6 3v5a5 5 0 0 0 10 0V3M4 3h4M14 3h4M11 13v2a4 4 0 0 0 8 0v-1"/><circle cx="19" cy="12" r="2"/>'},
    thread:{label:'Craft',body:'<path d="M7 4h10l2 5-7 11L5 9zM5 9h14M9 4l3 16 3-16"/>'},
    cube:{label:'Minecraft / 3D',body:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>'}
  });
  const VECTOR_KEYS = Object.freeze(Object.keys(VECTOR_ICONS));

  const GENERIC_TEXT_ICONS = new Set(['','✦','✨','*','p','c','project','folder']);
  const FAMILY_STOP = new Set(['project','projects','mod','mods','the','and','for','work','working','continuation','continue','dev','development','release','latest','new','chat','chats','v']);

  function normalizeIcon(value, fallback = DEFAULT_ICON) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return fallback;
    if (/^pc:[a-z0-9-]+$/i.test(text)) {
      const key = text.slice(3).toLowerCase();
      return VECTOR_ICONS[key] ? `pc:${key}` : fallback;
    }
    return text.slice(0, 16);
  }
  function normalizeColor(value, fallback = DEFAULT_COLOR) {
    const text = String(value ?? '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
  }
  function rgb(color) {
    const value = normalizeColor(color).slice(1);
    return [0,2,4].map((index) => parseInt(value.slice(index,index+2),16));
  }
  function foreground(color) {
    const [r,g,b]=rgb(color).map((value)=>value/255).map((value)=>value<=0.03928?value/12.92:((value+0.055)/1.055)**2.4);
    return (0.2126*r+0.7152*g+0.0722*b) > 0.42 ? '#101423' : '#ffffff';
  }
  function vectorKey(value) {
    const icon = normalizeIcon(value, '');
    if (!icon.startsWith('pc:')) return '';
    const key = icon.slice(3);
    return VECTOR_ICONS[key] ? key : '';
  }
  function iconDefinition(value) {
    const key = vectorKey(value);
    return key ? { key, ...VECTOR_ICONS[key] } : null;
  }
  function iconMarkup(value, className = 'pc-project-vector-icon') {
    const def = iconDefinition(value);
    if (!def) return '';
    const safeClass = String(className || 'pc-project-vector-icon').replace(/[^a-z0-9 _-]/gi,'').trim() || 'pc-project-vector-icon';
    return `<svg class="${safeClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${def.body}</svg>`;
  }
  function semanticIcon(value) {
    const text = String(value || '').toLocaleLowerCase();
    const rules = [
      [/curseforge|patch|repair|fix|tool|utility|optimi|driver|support/, 'wrench'],
      [/minecraft|creeper|boomshroom|block|voxel|model|forge|fabric|neoforge|ender/, 'cube'],
      [/spell|magic|witch|wizard|arcane|mana|enchant|mystic/, 'sparkles'],
      [/combat|weapon|sword|battle|fighter|strength|gym|fitness/, 'dumbbell'],
      [/code|coding|developer|extension|browser|github|api|software|script/, 'code'],
      [/terminal|powershell|linux|shell|command|cli/, 'terminal'],
      [/game|gaming|steam|skyrim|rpg|quest/, 'gamepad'],
      [/texture|art|visual|theme|design|color|image|animation|render/, 'palette'],
      [/catalog|research|wiki|reference|docs|documentation|manual|book/, 'book'],
      [/study|school|course|learn|training|education/, 'graduation'],
      [/write|writing|resume|draft|story|notes/, 'pencil'],
      [/travel|flight|trip|vacation|airline/, 'plane'],
      [/music|audio|song|spotify|podcast/, 'music'],
      [/health|medical|doctor|clinic|fitness/, 'stethoscope'],
      [/security|privacy|compliance|dfars|sprs|defen|shield/, 'shield'],
      [/finance|account|invoice|money|budget|business|client|company/, 'briefcase'],
      [/analytics|metric|benchmark|performance|chart|data/, 'chart'],
      [/science|experiment|test|lab|chem/, 'flask'],
      [/brain|ai|memory|intelligence|agent|llm/, 'brain'],
      [/flower|botany|garden|nature|farm|plant|mushroom/, 'flower'],
      [/pet|animal|mob|creature|cat|dog|familiar/, 'paw'],
      [/craft|loom|thread|sew|fabrication|textile/, 'thread'],
      [/package|bundle|archive|release|artifact|build/, 'package'],
      [/gem|charm|jewel|relic|treasure/, 'gem'],
      [/night|moon|dark/, 'moon'],
      [/legal|law|policy|balance/, 'scale'],
      [/web|internet|site|online|network/, 'globe']
    ];
    return `pc:${rules.find(([pattern]) => pattern.test(text))?.[1] || 'folder'}`;
  }
  function isGenericIcon(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return true;
    if (raw.startsWith('pc:')) return false;
    return GENERIC_TEXT_ICONS.has(raw.toLocaleLowerCase());
  }
  function preferredIcon(project = {}) {
    const explicit = normalizeIcon(project.icon || '', '');
    if (explicit && !isGenericIcon(explicit)) return explicit;
    return semanticIcon(`${project.name || ''} ${project.description || ''} ${project.notes || ''}`);
  }
  function projectFamilyKey(value) {
    const tokens = String(value || '').normalize('NFKC').toLocaleLowerCase()
      .replace(/v?\d+(?:\.\d+){0,3}/g,' ')
      .match(/[\p{L}\p{N}][\p{L}\p{N}+#_-]{1,32}/gu) || [];
    const useful = tokens.map((token)=>token.replace(/^[-_]+|[-_]+$/g,'')).filter((token)=>token.length > 2 && !FAMILY_STOP.has(token));
    return useful.slice(0,3).join(':');
  }
  function sameFamily(left, right) {
    const a=projectFamilyKey(left), b=projectFamilyKey(right);
    return Boolean(a && b && (a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`)));
  }
  function identity(project = {}) {
    const icon = preferredIcon(project);
    const key = vectorKey(icon);
    const color = normalizeColor(project.color);
    return { icon, iconKey:key, iconKind:key ? 'vector' : 'glyph', color, foreground:foreground(color), familyKey:projectFamilyKey(project.name || '') };
  }

  globalThis.ProjectConstellationProjectIdentity = Object.freeze({
    VERSION, DEFAULT_ICON, DEFAULT_COLOR, EMOJIS, COLORS, VECTOR_ICONS, VECTOR_KEYS,
    normalizeIcon, normalizeColor, foreground, vectorKey, iconDefinition, iconMarkup,
    semanticIcon, preferredIcon, projectFamilyKey, sameFamily, identity
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.ProjectConstellationProjectIdentity;
})();
