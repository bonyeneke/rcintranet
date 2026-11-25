import {workflows} from './public/workflows.js';
import {validEmail,revoke} from './security.js';

export class RequestError extends Error {
  constructor(status,message){super(message);this.status=status;}
}

export function publicState(state,user) {
  const {canSee,canManage}=workflows({...state,actor:user.id},{});
  const checks=state.checks.filter(check=>canSee(check.mode)).map(check=>{
    if(canManage(check.mode)) return check;
    const {report,responses,roster,...rest}=check;
    return {...rest,responseCount:Object.keys(responses).length,
      responses:Object.hasOwn(responses,user.id)?{[user.id]:responses[user.id]}:{},
      roster:roster.filter(entry=>entry.user===user.id)};
  });
  const isAdmin=user.role==='Administrator';
  const hasModule=canSee('DRC')||canSee('IRC');
  return {actor:user.id,version:state.version,checks,clients:hasModule?state.clients:[],clientAliases:hasModule?state.clientAliases:undefined,
    services:canSee('DRC')?state.services:[],types:isAdmin?state.types:[],parties:hasModule?state.parties:[],directors:canSee('DRC')?state.directors:[],
    users:state.users.map(({id,name,email,phone,location,active,role,drcRole,ircRole,irc,joined,exit})=>
      isAdmin||id===user.id?{id,name,email,phone,location,active,role,drcRole,ircRole,irc,joined,exit}:
        {id,name,email:active==='Yes'?email:undefined,phone:active==='Yes'?phone:undefined,location,active,drcRole,ircRole,irc})
  };
}

const actionNames=new Set(['start','editCheck','client','mergeClient','party','director','end','reopen','respond','addRoster','removeRoster','profile','staff','toggle','reference','remove']);

function formValues(fields,raw) {
  const values={};
  for(const field of fields){
    if(field.type==='info') continue;
    const value=Object.hasOwn(raw,field.name)?raw[field.name]:'';
    if(typeof value!=='string'||value.length>(field.max||5000)) throw new RequestError(422,field.label+' is invalid.');
    const clean=value.trim();
    if(!clean&&field.required) throw new RequestError(422,field.label+' is required.');
    if(clean){
      const numeric=Number(clean);
      const parsed=Date.parse(clean);
      const invalid=
        (field.type==='select'&&!field.options.some(([key])=>key===clean))||
        (field.type==='email'&&!validEmail(clean))||
        (field.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(clean)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==clean||(field.limit&&clean>field.limit)))||
        (field.type==='number'&&(!Number.isFinite(numeric)||(field.step!=='any'&&!Number.isSafeInteger(numeric))||(field.min!==undefined&&numeric<field.min)));
      if(invalid) throw new RequestError(422,field.label+' is invalid.');
    }
    values[field.name]=clean;
  }
  return values;
}

export function applyAction(state,user,payload) {
  const {name,args,values,version}=payload??{};
  if(!actionNames.has(name)||!Array.isArray(args)||args.length>2||args.some(arg=>arg!==null&&(typeof arg!=='string'||arg.length>100))||
     !values||typeof values!=='object'||Array.isArray(values)) throw new RequestError(400,'Invalid action.');
  if(version!==state.version) throw new RequestError(409,'The workspace changed. Close this form, review the latest records and try again.');
  let form,result;
  const beforeUsers=new Map(state.users.map(u=>[u.id,{email:u.email,active:u.active}]));
  const view={...state,actor:user.id};
  const {actions,allowedAction}=workflows(view,{
    mutating:true,
    openDialog(_title,fields,_defaults,save){form={fields,save};},
    change(message,edit){result={message,target:edit()};}
  });
  if(!allowedAction(name,args)) throw new RequestError(403,'Your role does not allow this action.');
  if(name==='start'&&!['DRC','IRC'].includes(args[1])) throw new RequestError(422,'Select a check mode.');
  try{
    actions[name](...args);
    if(!form) throw new RequestError(422,'No valid form.');
    form.save(formValues(form.fields,values));
  }catch(error){
    if(error instanceof RequestError) throw error;
    if(!(error instanceof TypeError)) throw new RequestError(422,error.message);
    throw error;
  }
  if(!result) throw new RequestError(422,'No changes were made.');
  for(const key of ['users','clients','checks','parties','directors','services','types','clientAliases','next']) if(Object.hasOwn(view,key)) state[key]=view[key];
  for(const u of state.users){
    const before=beforeUsers.get(u.id);
    if(before && u.email!==before.email) delete state.credentials[u.id];
    if(before && (u.email!==before.email||u.active!==before.active)) revoke(state,u.id);
  }
  state.version++;
  state.audit.push({at:new Date().toISOString(),user:user.id,action:name,args});
  return {...result,state:publicState(state,user)};
}
