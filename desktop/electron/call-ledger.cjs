'use strict';
const crypto=require('node:crypto');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
class CallLedger {
  constructor(){this.sessions=new WeakMap();}
  execute(session,call,run){
    if(!session||session.expiresAt<=Date.now())throw new Error('Project Constellation session expired. Arm a new request.');
    if(!call||typeof call.id!=='string'||!call.id)throw new Error('A stable call id is required.');
    if(!call.nonce||call.nonce!==session.nonce)throw new Error('Missing or stale Project Constellation authorization. Arm a new request.');
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(canonical({tool:call.tool,args:call.args}))).digest('hex');
    let calls=this.sessions.get(session);if(!calls){calls=new Map();this.sessions.set(session,calls);}
    const previous=calls.get(call.id);
    if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Call id was reused with different arguments; action refused.');return previous.promise;}
    const promise=Promise.resolve().then(run);calls.set(call.id,{fingerprint,promise});return promise;
  }
}
module.exports={CallLedger};
