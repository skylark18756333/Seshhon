import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const account = id => ({ access_token: 'test-access-'+id, refresh_token: 'test-refresh-'+id, expires_at: 9999999999, user_id: id });
const reply = (id, status = 200) => new Response(JSON.stringify({ ...account(id), user: { id } }), { status });
async function native(fetch) {
 const result = await build({ entryPoints: [path.join(root,'mobile/src/session.ts')], bundle: true, tsconfigRaw: {}, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'test-dependencies', setup(b) {
  b.onResolve({filter:/^(expo-secure-store|react-native)$|\.\/config$/}, a => ({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'}, a => ({contents:a.path==='react-native' ? 'export const Platform={OS:"web"};' : a.path==='./config' ? 'export const API_KEY="test",API_URL="https://example.invalid";' : 'export const getItemAsync=async()=>null; export const setItemAsync=async()=>{}; export const deleteItemAsync=async()=>{};'}));
 }}] });
 const context={exports:{},module:{exports:{}}, fetch, Response, AbortController, setTimeout,clearTimeout, localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}, console};
 context.exports=context.module.exports;vm.runInNewContext(result.outputFiles[0].text,context);return context.module.exports;
}
function web(fetch) {
 const s=fs.readFileSync(path.join(root,'docs/app.js'),'utf8');
 const prefix=s.slice(0,s.indexOf('  // The human check on sign-up')) + s.slice(s.indexOf('  function refreshSession()'),s.indexOf('  // The age check runs in a Supabase Edge Function')); 
 const tail='window.test={refreshSession,rpc,setSession:function(s){session=s;store(SESSION_KEY,s);},currentSession:function(){return session;}};})();';
 const context={window:{},fetch,Response,AbortController,TypeError,setTimeout,clearTimeout,console,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}};
 context.window={};context.window.SESHHON_CONFIG={url:'https://example.invalid',key:'test'};
 vm.runInNewContext(prefix+tail,context);return context.window.test;
}
for (const [name,make] of [['native',native],['web',web]]) {
 test(name+': pending renewal cannot restore a signed-out account',async()=>{
  const d=deferred(),api=await make(()=>d.promise);api.setSession(account('alice'));const pending=api.refreshSession();api.setSession(null);d.resolve(reply('alice'));await assert.rejects(pending);assert.equal(api.currentSession(),null);
 });
 test(name+': pending renewal cannot replace another account',async()=>{
  const d=deferred(),api=await make(()=>d.promise);api.setSession(account('alice'));const pending=api.refreshSession();api.setSession(account('bob'));d.resolve(reply('alice'));await assert.rejects(pending);assert.equal(api.currentSession().user_id,'bob');
 });
 test(name+': old refused renewal cannot sign out a newer account',async()=>{
  const d=deferred(),api=await make(()=>d.promise);api.setSession(account('alice'));const pending=api.refreshSession();api.setSession(account('bob'));d.resolve(reply('alice',400));await assert.rejects(pending);assert.equal(api.currentSession().user_id,'bob');
 });
 test(name+': a token renewal during a request keeps its answer',async()=>{
  const d=deferred(),api=await make(()=>d.promise);api.setSession(account('alice'));const pending=api.rpc('api_state');await new Promise(r=>setTimeout(r,0));api.setSession({...account('alice'),access_token:'test-access-renewed'});d.resolve(new Response('{"ok":true}',{status:200}));assert.deepEqual({...(await pending)},{ok:true});
 });
 test(name+': a request finishing after another account signs in is discarded',async()=>{
  const d=deferred(),api=await make(()=>d.promise);api.setSession(account('alice'));const pending=api.rpc('api_state');await new Promise(r=>setTimeout(r,0));api.setSession(account('bob'));d.resolve(new Response('{"ok":true}',{status:200}));await assert.rejects(pending,e=>e.signedOut===true);
 });
 test(name+': simultaneous renewal shares one request',async()=>{
  const d=deferred();let calls=0;const api=await make(()=>{calls++;return d.promise;});api.setSession(account('alice'));const a=api.refreshSession(),b=api.refreshSession();assert.equal(calls,1);d.resolve(reply('alice'));await Promise.all([a,b]);assert.equal(api.currentSession().user_id,'alice');
 });
}
const helpers = await transform(fs.readFileSync(path.join(root,'mobile/src/reliability.ts'),'utf8'),{loader:'ts',format:'cjs'});
function reliability(fetch) { const c={module:{exports:{}},fetch,Response,TypeError,AbortController,setTimeout,clearTimeout};c.exports=c.module.exports;vm.runInNewContext(helpers.code,c);return c.module.exports; }
test('latest read rejects stale responses and invalidated reads',()=>{const h=reliability(()=>{}).latestRead();const old=h.begin(),fresh=h.begin();assert.equal(h.current(old),false);assert.equal(h.current(fresh),true);h.invalidate();assert.equal(h.current(fresh),false);});
test('request rejects when headers never arrive',async()=>{const h=reliability(()=>new Promise(()=>{}));await assert.rejects(h.request('test',{},5),e=>e.code==='timeout'&&e.network===true);});
test('deadline covers a stalled response body',async()=>{const h=reliability(async()=>({text:()=>new Promise(()=>{}),status:200}));await assert.rejects(h.request('test',{},5),e=>e.code==='timeout');});
test('successful requests retain status and parsed data',async()=>{const h=reliability(async()=>new Response('{"ok":true}',{status:201}));const res=await h.request('test');assert.equal(res.status,201);assert.deepEqual(await res.json(),{ok:true});});
test('requests support empty successful responses',async()=>{const h=reliability(async()=>new Response(null,{status:204}));const res=await h.request('test');assert.equal(res.status,204);assert.equal(await res.text(),'');});
async function gates(rpc) {
 const source = fs.readFileSync(path.join(root,'mobile/src/api.ts'),'utf8');
 const code = await transform(source.replace(/import \{ rpc \} from '.\/session';/, 'const rpc = globalThis.testRpc;'),{loader:'ts',format:'cjs'});
 const c={module:{exports:{}},testRpc:rpc};c.exports=c.module.exports;vm.runInNewContext(code.code,c);return c.module.exports;
}
test('native gates stop before protected reads when a login code is required',async()=>{const calls=[];const api=await gates(async name=>{calls.push(name);return {needed:true};});const result=await api.loadGates();assert.equal(result.twoStep,true);assert.deepEqual(calls,['two_step_state']);});
test('native gates propagate an unavailable verification check',async()=>{const api=await gates(async()=>{throw new Error('verification unavailable');});await assert.rejects(api.loadGates(),/verification unavailable/);});
test('native gates reject malformed age checks instead of granting access',async()=>{const api=await gates(async name=>name==='two_step_state'?{needed:false}:name==='my_role'?{role:'user'}:{});await assert.rejects(api.loadGates(),/age verification/);});
