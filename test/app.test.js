import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {initialState} from '../database.js';
import {createApp} from '../server.js';
import {issueSetup} from '../security.js';
import {runReminders} from '../mail.js';

function memoryRepository(workspace) {
  return {
    read:async()=>structuredClone(workspace),
    async write(operation){
      const copy=structuredClone(workspace);
      const result=await operation(copy);
      workspace=copy;
      return result;
    }
  };
}

test('staff sign in, share checks, submit only their own response and lose access when disabled',async t=>{
  const initial=initialState();
  const admin={id:'admin',name:'Admin',email:'admin@example.invalid',active:'Yes',role:'Administrator',drcRole:'Respondent',ircRole:'Respondent'};
  initial.users.push(admin);
  const token=issueSetup(initial,admin);
  const repo=memoryRepository(initial);
  const sent=[];
  const origin='http://127.0.0.1:3000';
  const server=createApp({repo,origin,send:async message=>sent.push(message)}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(path,{method,body,cookie,requestOrigin=origin}={})=>{
    const response=await fetch(base+path,{method:method||(body?'POST':'GET'),
      headers:{...(cookie?{Cookie:cookie}:{}),...(body?{Origin:requestOrigin,'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  const password='test passphrase only';
  assert.equal((await call('/api/state')).status,401);
  assert.equal((await call('/api/auth/setup',{body:{token,password},requestOrigin:'https://elsewhere.invalid'})).status,403);
  assert.equal((await call('/api/auth/setup',{body:{token,password}})).status,200);
  assert.equal((await call('/api/auth/setup',{body:{token,password}})).status,422);
  const login=await call('/api/auth/login',{body:{email:admin.email,password}});
  assert.equal(login.status,200);
  assert.match(login.cookie,/HttpOnly/);
  const a=login.cookie.split(';')[0];
  const change=async(cookie,name,args,values,version)=>{
    const state=version===undefined?(await call('/api/state',{cookie})).body:null;
    return call('/api/action',{cookie,body:{name,args,values,version:version??state.version}});
  };
  const newStaff=await change(a,'staff',[],{name:'Staff',email:'staff@example.invalid',active:'Yes',role:'Staff',drcRole:'Respondent',ircRole:'No access'});
  assert.equal(newStaff.status,200);
  const staff=newStaff.body.state.users.find(u=>u.name==='Staff');
  assert.equal((await call('/api/invite',{cookie:a,body:{args:[staff.id]}})).status,200);
  const staffToken=sent[0].text.match(/#setup=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await call('/api/auth/setup',{body:{token:staffToken,password}})).status,200);
  const staffLogin=await call('/api/auth/login',{body:{email:staff.email,password}});
  const b=staffLogin.cookie.split(';')[0];
  const created=await change(a,'client',[],{name:'Example client'});
  assert.equal(created.status,200);
  const client=created.body.state.clients[0].id;
  assert.equal((await change(a,'client',[],{name:'Stale'},0)).status,409);
  assert.equal((await change(a,'start',[client,'DRC'],{client,service:'audit',reason:'Annual audit'})).status,200);
  assert.equal((await change(a,'start',[client,'IRC'],{client,lookback:'2020-01-01',reason:'International review'})).status,200);
  const view=(await call('/api/state',{cookie:b})).body;
  assert.equal(view.checks.length,1);
  assert.equal(view.credentials,undefined);
  assert.equal(view.checks[0].roster.length,1);
  const check=view.checks[0].id;
  assert.equal((await change(b,'end',[check],{})).status,403);
  assert.equal((await change(b,'respond',[check],{a1:'1',a2:'0'})).status,422);
  assert.equal((await change(b,'respond',[check],{a1:'0',a2:'0',actor:'admin'})).status,200);
  assert.deepEqual(Object.keys((await repo.read()).checks[0].responses),[staff.id]);
  assert.equal((await change(a,'end',[check],{})).status,200);
  assert.ok((await repo.read()).checks[0].report);
  assert.equal((await change(b,'respond',[check],{a1:'0',a2:'0'})).status,422);
  assert.equal((await runReminders(repo,async msg=>sent.push(msg),origin)).sent,1);
  assert.match(sent.at(-1).text,/IRC-002/);
  assert.doesNotMatch(sent.at(-1).text,/DRC-001/);
  assert.equal((await runReminders(repo,async msg=>sent.push(msg),origin)).sent,0);
  assert.equal((await change(a,'toggle',[staff.id],{})).status,200);
  assert.equal((await call('/api/state',{cookie:b})).status,401);
  assert.equal((await call('/api/auth/login',{body:{email:staff.email,password}})).status,401);
  assert.equal((await change(a,'toggle',[staff.id],{})).status,200);
  assert.equal((await call('/api/state',{cookie:b})).status,401);
});
