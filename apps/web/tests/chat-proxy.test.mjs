import assert from 'node:assert/strict';
import { chatApiProxy } from '../../../functions/api/chat-proxy.js';
import { worker } from '../server/vercel-worker.mjs';
const original = globalThis.fetch;
const env = { SIGNAL_API_ORIGIN: 'https://api.signal.example' };
let calls = [];
const req = (path, method = 'GET', body) => new Request('https://preview.example' + path, { method, headers: { authorization: 'Bearer session', cookie: 'private', 'content-type': 'application/json', 'x-signal-edge-secret': 'untrusted' }, ...(body ? { body } : {}) });
try {
 globalThis.fetch = async (url, options) => { calls.push({url:String(url),options}); return Response.json({messages:[]}); };
 for (const [path,method,body] of [
  ['/api/v1/chat/main/messages?since=abc','GET'],
  ['/api/v1/chat/main/messages','POST','{"content":"hello"}'],
  ['/api/v1/chat/token/7K52aYQW9rWGjwZmQ7o2d1P6E7bji6hSMsqaLy5EcxLh/messages','GET'],
  ['/api/v1/chat/messages/abc/report','POST','{}'],
  ['/api/v1/chat/messages/abc','DELETE'],
  ['/api/v1/chat/is-moderator?walletAddress=abc','GET']
 ]) {
  const r = await worker.fetch(req(path,method,body),env);
  assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store, max-age=0');
  const call=calls.at(-1); assert.equal(call.url,env.SIGNAL_API_ORIGIN+path); assert.equal(call.options.method,method); assert.equal(call.options.redirect,'manual');
  assert.equal(call.options.headers.get('authorization'),'Bearer session');
  assert.equal(call.options.headers.get('cookie'),null); assert.equal(call.options.headers.get('x-signal-edge-secret'),null);
 }
 const before=calls.length;
 assert.equal((await chatApiProxy({request:req('/api/v1/chat/admin'),env})).status,404);
 assert.equal((await worker.fetch(req('/api/v1/chat/main/messages','DELETE'),env)).status,405);
 assert.equal((await worker.fetch(req('/api/v1/chat/main/messages','POST','x'.repeat(5001)),env)).status,413);
 assert.equal(calls.length,before);
 assert.equal((await worker.fetch(req('/api/v1/chat/main/messages'),{})).status,503);
 globalThis.fetch=async()=>Response.json({error:'Unauthorized'},{status:401});
 assert.equal((await worker.fetch(req('/api/v1/chat/main/messages','POST','{}'),env)).status,401);
 globalThis.fetch=async()=>new Response('private upstream error',{status:500});
 const failed=await worker.fetch(req('/api/v1/chat/main/messages'),env);
 assert.equal(failed.status,503); assert.ok(!(await failed.text()).includes('private upstream'));
 for (const status of [301,302,303,307,308]) {
  let redirects=0; globalThis.fetch=async (_url,options)=>{redirects++; assert.equal(options.redirect,'manual'); return new Response('{}',{status,headers:{'content-type':'application/json',location:'https://untrusted.example'}});};
  assert.equal((await worker.fetch(req('/api/v1/chat/main/messages'),env)).status,503); assert.equal(redirects,1);
 }
 console.log('Chat proxy routing, auth forwarding, privacy, limits and failure handling passed.');
} finally { globalThis.fetch=original; }
