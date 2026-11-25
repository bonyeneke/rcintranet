import express from 'express';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {connect} from './database.js';
import {applyAction,publicState,RequestError} from './domain.js';
import {digest,issueSetup,passwordHash,passwordMatches,pruneCredentials,randomToken,revoke,validEmail,validPassword,validToken} from './security.js';
import {mailer} from './mail.js';
import {originFor} from './config.js';

const publicDirectory=fileURLToPath(new URL('./public/',import.meta.url));

export function createApp({repo,origin,send,trustProxy=false}) {
  const app=express();
  app.disable('x-powered-by');
  if(trustProxy) app.set('trust proxy','loopback');
  const cookieOptions={httpOnly:true,secure:origin.startsWith('https:'),sameSite:'lax',path:'/'};
  const cookieName=cookieOptions.secure?'__Host-gt-session':'gt-session';
  const guard=(condition,status,message)=>{if(!condition) throw new RequestError(status,message);};
  const sessionKey=req=>{
    const token=(req.headers.cookie||'').split(/;\s*/).find(pair=>pair.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    return validToken(token)?digest(token):null;
  };
  function currentUser(req,state) {
    const key=sessionKey(req);
    const session=key?state.sessions[key]:null;
    return session&&session.expires>Date.now()?state.users.find(u=>u.id===session.user&&u.active==='Yes'):null;
  }
  function requireUser(req,state) {
    const user=currentUser(req,state);
    guard(user,401,'Sign in required.');
    return user;
  }
  const windows=new Map();
  function throttle(req,limit=20) {
    const now=Date.now(), key=req.ip+':'+req.path;
    if(windows.size>2000) for(const [key,entry] of windows) if(entry.until<=now) windows.delete(key);
    if(!windows.has(key)&&windows.size>=4000) throw new RequestError(429,'Try again in a minute.');
    const entry=windows.get(key);
    const next=entry&&entry.until>now?entry:{count:0,until:now+60_000};
    next.count++;
    windows.set(key,next);
    guard(next.count<=limit,429,'Too many attempts. Try again in a minute.');
  }

  let activeDerivations=0;
  async function derive(operation) {
    guard(activeDerivations<2,429,'Sign-in service is busy. Try again shortly.');
    activeDerivations++;
    try{return await operation();}
    finally{activeDerivations--;}
  }
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
      'Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    next();
  });
  app.use('/api',(req,res,next)=>{
    if(req.method==='POST'){
      guard(req.get('origin')===origin,403,'Invalid request origin.');
      guard(req.is('application/json'),415,'JSON request required.');
    }
    next();
  },express.json({limit:'64kb'}));
  app.get('/health',async(_req,res)=>{await repo.read();res.json({ok:true});});
  app.get('/login',(_req,res)=>res.sendFile('login.html',{root:publicDirectory}));
  app.get('/',async(req,res)=>{
    if(!currentUser(req,await repo.read())) return res.redirect('/login');
    res.sendFile('index.html',{root:publicDirectory});
  });
  app.get('/api/state',async(req,res)=>{
    const state=await repo.read();
    res.json(publicState(state,requireUser(req,state)));
  });
  app.post('/api/auth/login',async(req,res)=>{
    throttle(req);
    const {email,password}=req.body??{};
    guard(validEmail(email)&&validPassword(password),401,'Email or password is incorrect.');
    const state=await repo.read();
    const user=state.users.find(u=>u.active==='Yes'&&u.email.toLowerCase()===email.toLowerCase());
    const stored=user&&state.credentials[user.id];
    guard(await derive(()=>passwordMatches(password,stored)),401,'Email or password is incorrect.');
    const token=randomToken(), lifetime=8*60*60*1000;
    await repo.write(workspace=>{
      guard(workspace.credentials[user.id]===stored&&workspace.users.some(u=>u.id===user.id&&u.active==='Yes'),401,'Email or password is incorrect.');
      pruneCredentials(workspace);
      const previous=sessionKey(req);
      if(previous) delete workspace.sessions[previous];
      workspace.sessions[digest(token)]={user:user.id,expires:Date.now()+lifetime};
    });
    res.cookie(cookieName,token,{...cookieOptions,maxAge:lifetime}).json({ok:true});
  });
  app.post('/api/auth/logout',async(req,res)=>{
    const key=sessionKey(req);
    if(key) await repo.write(state=>{delete state.sessions[key];});
    res.clearCookie(cookieName,cookieOptions).json({ok:true});
  });
  async function deliverSetup(email,token) {
    const link=origin+'/login#setup='+token;
    await send({to:email,subject:'Set your Relationship Checks password',
      text:'Use this link to set your password. It expires in one hour.\n\n'+link+'\n\nIf you did not request this, you can ignore this email.'});
  }
  app.post('/api/auth/request',async(req,res)=>{
    throttle(req,5);
    const {email}=req.body??{};
    guard(validEmail(email),422,'Enter a valid email address.');
    if(send){
      const state=await repo.read();
      const match=state.users.find(u=>u.active==='Yes'&&u.email.toLowerCase()===email.toLowerCase());
      if(match){
        const issued=await repo.write(workspace=>{
          const user=workspace.users.find(u=>u.id===match.id&&u.active==='Yes'&&u.email===match.email);
          return user?issueSetup(workspace,user):null;
        });
        if(issued) try{await deliverSetup(match.email,issued);}catch{console.error('Password setup mail delivery failed.');}
      }
    }
    res.json({message:'If the account is active and email delivery is configured, you will receive a setup link.'});
  });
  app.post('/api/auth/setup',async(req,res)=>{
    throttle(req,8);
    const {token,password}=req.body??{};
    guard(validToken(token)&&validPassword(password),422,'Enter a valid link and a password of 12–128 characters.');
    const key=digest(token);
    const checkToken=state=>{
      const item=state.tokens[key];
      const user=item&&state.users.find(u=>u.id===item.user&&u.active==='Yes'&&u.email===item.email);
      guard(user&&item.expires>Date.now(),422,'This setup link is invalid or expired.');
      return user;
    };
    checkToken(await repo.read());
    const hashed=await derive(()=>passwordHash(password));
    await repo.write(state=>{
      const user=checkToken(state);
      revoke(state,user.id);
      state.credentials[user.id]=hashed;
    });
    res.json({message:'Password saved. You can now sign in.'});
  });
  app.post('/api/invite',async(req,res)=>{
    throttle(req,10);
    guard(send,503,'Configure mail delivery to send account setup links.');
    const invitation=await repo.write(state=>{
      const user=requireUser(req,state);
      guard(user.role==='Administrator',403,'Administrator access required.');
      const target=state.users.find(u=>u.id===req.body?.args?.[0]&&u.active==='Yes');
      guard(target,422,'Select an active staff member.');
      return {email:target.email,token:issueSetup(state,target)};
    });
    try{await deliverSetup(invitation.email,invitation.token);}
    catch{throw new RequestError(502,'The mail server could not accept the setup email.');}
    res.json({message:'Setup link sent.'});
  });
  app.post('/api/action',async(req,res)=>{
    const result=await repo.write(state=>applyAction(state,requireUser(req,state),req.body));
    res.json(result);
  });
  for(const asset of ['style.css','app.js','workflows.js','login.js']) app.get('/'+asset,(_req,res)=>res.sendFile(asset,{root:publicDirectory}));
  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found.'}));
  app.use((error,_req,res,_next)=>{
    if(error instanceof RequestError) return res.status(error.status).json({error:error.message});
    if(error.status===400||error.status===413) return res.status(error.status).json({error:'Invalid request body.'});
    console.error('Request failed:',error.code||error.name);
    res.status(500).json({error:'The application could not complete the request.'});
  });
  return app;
}

export async function start(){
  const envPath=fileURLToPath(new URL('./.env',import.meta.url));
  if(existsSync(envPath)) process.loadEnvFile(envPath);
  const repo=connect();
  const origin=originFor();
  const app=createApp({repo,origin,send:mailer(),trustProxy:process.env.TRUST_PROXY_LOOPBACK==='true'});
  await repo.read();
  app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Relationship Checks is ready.'));
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) await start();
