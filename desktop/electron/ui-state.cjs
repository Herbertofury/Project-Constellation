'use strict';
const VIEWS = Object.freeze(['chat','workspace','terminal','desktop','activity','connections','settings','tools','access']);
function preferences(input = {}) {
  return {
    theme: ['system','light','dark'].includes(input.theme) ? input.theme : 'system',
    chatZoom: Number.isFinite(input.chatZoom) ? Math.max(0.8, Math.min(1.5, input.chatZoom)) : 1,
    alwaysOnTop: input.alwaysOnTop === true
  };
}
function patchPreferences(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid appearance settings.');
  for (const [key,value] of Object.entries(patch)) {
    if (!['theme','chatZoom','alwaysOnTop'].includes(key)) throw new Error(`Unsupported preference: ${key}`);
    if (key === 'theme' && !['system','light','dark'].includes(value)) throw new Error('Invalid theme.');
    if (key === 'chatZoom' && (!Number.isFinite(value) || value < 0.8 || value > 1.5)) throw new Error('Zoom must be between 80% and 150%.');
    if (key === 'alwaysOnTop' && typeof value !== 'boolean') throw new Error('Invalid pin state.');
  }
  return preferences({...current,...patch});
}
function layout(width,height,collapsed = false) {
  const rail = 72, top = 56, bottom = 30;
  const panel = collapsed || width <= 1050 ? 0 : 344;
  return {x:rail,y:top,width:Math.max(1,width-rail-panel),height:Math.max(1,height-top-bottom)};
}
function viewName(value) { if (!VIEWS.includes(value)) throw new Error('Unknown workspace view.'); return value; }
module.exports = {VIEWS,preferences,patchPreferences,layout,viewName};
