import nodemailer from 'nodemailer';
import {workflows} from './public/workflows.js';

export function mailer(env=process.env) {
  const {SMTP_HOST,SMTP_PORT='587',SMTP_USER,SMTP_PASSWORD,MAIL_FROM}=env;
  if(!SMTP_HOST||!MAIL_FROM) return null;
  const transport=nodemailer.createTransport({host:SMTP_HOST,port:Number(SMTP_PORT),secure:SMTP_PORT==='465',
    disableFileAccess:true,disableUrlAccess:true,requireTLS:SMTP_PORT!=='465',auth:SMTP_USER?{user:SMTP_USER,pass:SMTP_PASSWORD}:undefined});
  return message=>transport.sendMail({from:MAIL_FROM,...message});
}

export async function runReminders(repo,send,origin,{dryRun=false}={}) {
  const state=await repo.read();
  const {today}=workflows(state,{});
  const day=today();
  const results={sent:0,failed:0,eligible:0};
  for(const {id} of state.users){
    const draft=workspace=>{
      const user=workspace.users.find(user=>user.id===id);
      const {canRespond,ref,client}=workflows({...workspace,actor:id},{});
      const checks=workspace.checks.filter(check=>canRespond(check)&&!Object.hasOwn(check.responses,id));
      if(!user||!checks.length) return null;
      return {to:user.email,subject:'Daily reminder — outstanding relationship check responses',
        text:'Hello '+user.name+',\n\nPlease complete your outstanding relationship checks:\n\n'+
          checks.map(check=>ref(check)+' · '+client(check).name+'\n'+origin+'/#checks/'+check.id).join('\n\n')+
          '\n\nRelationship Checks Team'};
    };
    if(!draft(state)) continue;
    results.eligible++;
    if(dryRun) continue;
    const key=day+':'+id;
    const message=await repo.write(workspace=>{
      if(workspace.deliveries[key]) return null;
      const message=draft(workspace);
      if(message) workspace.deliveries[key]={status:'sending',at:new Date().toISOString()};
      return message;
    });
    if(!message) continue;
    let status='sent';
    try{await send(message);}
    catch{status='failed';}
    await repo.write(workspace=>{workspace.deliveries[key]={status,at:new Date().toISOString()};});
    results[status]++;
  }
  return results;
}
