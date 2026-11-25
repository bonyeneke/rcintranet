import {randomUUID} from 'node:crypto';
import {connect} from './database.js';
import {issueSetup,validEmail} from './security.js';
import {mailer,runReminders} from './mail.js';
import {originFor} from './config.js';

const repo=connect();
try{
  const [command,argument]=process.argv.slice(2);
  if(command==='migrate'){
    await repo.migrate();
    console.log('Database schema is ready.');
  }else if(command==='admin'||command==='admin-setup'){
    const origin=originFor();
    if(!validEmail(argument)) throw Error('Supply a valid work email address.');
    const token=await repo.write(state=>{
      if(command==='admin-setup'){
        const existing=state.users.find(u=>u.active==='Yes'&&u.role==='Administrator'&&u.email.toLowerCase()===argument.toLowerCase());
        if(!existing) throw Error('No matching active administrator.');
        return issueSetup(state,existing);
      }
      if(state.users.length) throw Error('Initial administrator already created. Use the staff administration screen or password reset.');
      const user={id:randomUUID(),name:'Administrator',email:argument.toLowerCase(),active:'Yes',
        role:'Administrator',drcRole:'Respondent',ircRole:'Respondent'};
      state.users.push(user);
      state.version++;
      return issueSetup(state,user);
    });
    console.log('Open this one-time link privately within one hour:\n'+origin+'/login#setup='+token);
  }else if(command==='reminders'){
    const origin=originFor();
    const dryRun=argument==='--dry-run';
    const send=mailer();
    if(!send&&!dryRun) throw Error('Configure SMTP_HOST and MAIL_FROM before sending reminders.');
    const counts=await runReminders(repo,send,origin,{dryRun});
    console.log(JSON.stringify(counts));
    if(counts.failed) process.exitCode=1;
  }else throw Error('Specify migrate, admin or reminders.');
}finally{await repo.close();}
