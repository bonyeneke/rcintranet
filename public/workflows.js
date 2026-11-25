export function workflows(db, {openDialog, change, mutating=false}) {
  const get = (group,id) => db[group].find(row => row.id === id);
  const actor = () => get('users',db.actor);
  const admin = () => actor()?.active === 'Yes' && actor().role === 'Administrator';
  const active = () => actor()?.active === 'Yes';
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date());
  const usersName = id => get('users',id)?.name || 'Unknown staff member';
  const client = check => get('clients',check.client);
  const typeName = mode => mode === 'DRC' ? 'Domestic' : 'International';
  const count = check => check.responseCount ?? Object.keys(check.responses).length;
  const rate = check => check.expected ? Math.round(count(check)/check.expected*100) : null;
  const state = check => check.closed ? 'Checked out' : count(check) ? 'Ongoing' : 'New';
  const ref = check => check.mode+'-'+(check.sample?'SAMPLE':String(check.number).padStart(3,'0'));
  const modes = ['DRC','IRC'];
  const moduleRole = (user,mode) => mode==='DRC'
    ? user.drcRole ?? (user.active==='Yes'?'Respondent':'No access')
    : user.ircRole ?? (user.active==='Yes'&&user.irc==='Yes'?'Respondent':'No access');
  const eligible = (user,mode) => user?.active === 'Yes' && moduleRole(user,mode)!=='No access';
  const canManage = mode => modes.includes(mode) && (admin() || (active() && moduleRole(actor(),mode)==='Check lead'));
  const canSee = mode => admin() || eligible(actor(),mode);
  const canStart = () => modes.some(canManage);
  const canRespond = check => !check.closed && eligible(actor(),check.mode) && check.roster.some(item => item.user === db.actor && !item.left);
  const field = (name,label,type='text',opts={}) => ({name,label,type,...opts});
  const required = {required:true};
  const choices = values => values.map(v=>[v,v]);
  const yn = choices(['Yes','No']);
  const select = (name,label,options,opts={}) => field(name,label,'select',{options,...opts});
  const ircFields = [field('firm','Referring member firm','text',{max:60}),field('responseType','Response type code','number'),field('vendorType','Vendor relationship type code','number')];
  const clientFields = [
   field('name','Client name','text',{required:true,max:255}),
   field('email','Client email','email'),field('contact','Contact name'),field('phone','Contact telephone','tel'),
   field('contactEmail','Contact email','email'),field('address','Address','textarea'),field('website','Website','url'),
   field('industry','Industry'),field('nature','Nature of business','textarea'),
   select('office','Responsible office',choices(['Abuja','Lagos (Victoria Island)','Lagos (Yaba)','Port-Harcourt'])),
   field('partner','Engagement partner'),field('partnerEmail','Partner email','email'),field('partnerPhone','Partner phone','tel'),
   field('assets','Assets','number',{step:'any'}),field('revenue','Revenue','number',{step:'any'}),field('equity','Equity','number',{step:'any'}),
   select('acceptance','Client acceptance',choices(['Pending','Accepted','Declined'])),field('sources','Sources of information','textarea')
  ];
  const personFields = [
   field('name','Name','text',{required:true,max:255}),field('email','Work email','email',{required:true,max:255}),
   field('location','Location'),field('phone','Work telephone','tel')
  ];
  const partyFields = [
   field('name','Names','text',required),field('relation','Relationship type'),field('location','Location'),field('transactions','Transactions','textarea')
  ];
  const directorFields = [
   field('name','Names','text',required),field('type','Director type'),field('shares','Shares','number'),field('country','Country code','text',{max:2})
  ];
  const lookup = id => get('services',id)?.name;
  const clientPath = c => 'clients/'+c.id;
  const checkPath = c => 'checks/'+c.id;
  const assert = (condition,message) => { if(!condition) throw Error(message); };
  const uid = () => crypto.randomUUID();
  function saveRow(groupName,row,values) {
    if(row) Object.assign(row,values);
    else db[groupName].push({id:uid(),...values});
  }
  function unique(groupName,row,fieldName,value,mode) {
    assert(!db[groupName].some(r=>r.id!==row?.id&&(!mode||r.mode===mode)&&String(r[fieldName]).toLowerCase()===value.toLowerCase()),'This '+fieldName+' is already in use.');
  }
  function confirmAction(title,description,action,label) {
    openDialog(title,[field('notice',description,'info')],{},action,label);
  }
  function snapshot(check) {
    return structuredClone({
      check:{...check,report:undefined}, company:client(check), service:lookup(check.service),
      directors:db.directors.filter(x=>x.client===check.client), parties:db.parties.filter(x=>x.client===check.client),
      people:Object.fromEntries(Object.keys(check.responses).map(id=>[id,usersName(id)]))
    });
  }
  const checkFields = (mode,editing=false) => [
   ...(!editing?[select('client','Client',db.clients.map(c=>[c.id,c.name]),required)]:[]),
   ...(mode==='DRC'?[select('service','Service',db.services.map(s=>[s.id,s.name]),required)]:[field('lookback','Calendar lookback from','date',{required:true,limit:today()}),...ircFields]),
   field('engagement','Engagement type','text',{max:120}),
   field('expected','Expected responses (blank uses eligible roster)','number',{min:1}),
   field('reason','Reason','textarea',{required:true,max:2000})
  ];
  function checkForm(mode,owner,c) {
    assert(canManage(mode),'Check lead access required.');
    const defaults=c?{...client(c),...c}:{...owner,client:owner?.id};
    openDialog(c?'Edit '+ref(c):'Start '+mode+' check',checkFields(mode,!!c),defaults,v=>{
      const roster=db.users.filter(u=>eligible(u,mode)).map(u=>({user:u.id,joined:today()}));
      if(c && count(c) && v.service!==c.service && mode==='DRC') throw Error('Service is locked once a response exists.');
      if(!c) assert(get('clients',v.client),'Select a client.');
      change(c?'Check updated.':'Check started.',()=>{
        const expected=v.expected?Number(v.expected):(c?c.roster.filter(r=>!r.left&&eligible(get('users',r.user),mode)).length:roster.length);
        if(c){Object.assign(c,v,{expected});return;}
        const check={id:uid(),number:db.next++,mode,...v,expected,started:today(),startedBy:db.actor,closed:false,roster,responses:{}};
        db.checks.push(check);
        return checkPath(check);
      });
    },c?'Save changes':'Start check');
  }
  function respondentForm(id) {
    const c=get('checks',id);
    assert(c,'Check not found.');
    assert(canSee(c.mode),'Module access required.');
    const previous=c.responses[db.actor];
    if(!canRespond(c)){
      assert(!mutating,'This check is closed or you are no longer eligible.');
      assert(previous,'You are not eligible for this check.');
      openDialog('Your response · '+ref(c),[
        field('result','Answer 1 · '+(previous.a1==='1'?'Yes':'No')+(previous.d1?' · '+previous.d1:''),'info'),
        ...(c.mode==='DRC'?[field('second','Answer 2 · '+(previous.a2==='1'?'Yes':'No')+(previous.d2?' · '+previous.d2:''),'info')]:[])
      ],{},()=>{},'Done');
      return;
    }
    const owner=client(c);
    const named=db.parties.filter(r=>r.client===c.client).map(r=>r.name+(r.location?' ('+r.location+')':'')).join(', ');
    const associated= c.mode==='DRC' ? db.directors.filter(r=>r.client===c.client).map(r=>r.name).join(', ') : '';
    const fields=[
      field('context',[owner.name,c.engagement,c.mode==='IRC'?'Lookback from '+c.lookback:lookup(c.service)].filter(Boolean).join(' · '),'info'),
      ...(named?[field('parties','Related parties: '+named,'info')]:[]),
      ...(associated?[field('directors','Directors: '+associated,'info')]:[]),
      select('a1',c.mode==='DRC'?'Answer 1':'Relationship or issue identified?',[['1','Yes'],['0','No']],required),
      field('d1','Details for Yes','textarea',{max:5000}),
      ...(c.mode==='DRC'?[select('a2','Answer 2',[['1','Yes'],['0','No']],required),field('d2','Details for Yes','textarea',{max:5000})]:[])
    ];
    openDialog((previous?'Edit response':'Respond')+' · '+ref(c),fields,previous||{},v=>{
      assert(canRespond(c),'This check is closed or you are no longer eligible.');
      assert(v.a1!=='1'||v.d1,'Add details for the first Yes answer.');
      assert(c.mode!=='DRC'||v.a2!=='1'||v.d2,'Add details for the second Yes answer.');
      if(v.a1==='0') v.d1='';
      if(v.a2==='0') v.d2='';
      change('Response saved.',()=>{c.responses[db.actor]=v;});
    },'Save response');
  }
  function updateStaff(u,v) {
    unique('users',u,'email',v.email);
    if(u?.id===db.actor) assert(v.active==='Yes'&&v.role==='Administrator','Your own administrator account must stay active.');
    if(v.active==='No'){
      v.drcRole='No access';
      v.ircRole='No access';
      v.exit ||= today();
    } else v.exit='';
    assert(!v.joined||!v.exit||v.exit>=v.joined,'Exit date must be on or after joined date.');
    if(u) for(const q of db.checks.filter(q=>!q.closed&&!eligible(v,q.mode))){
      const slot=q.roster.find(r=>r.user===u.id&&!r.left);
      if(slot) slot.left=today();
    }
    v.irc=eligible(v,'IRC')?'Yes':'No';
    saveRow('users',u,v);
  }
  const actions = {
    start:(id,mode)=>{
      assert(!id||get('clients',id),'Client not found.');
      checkForm(mode,get('clients',id));
    },
    editCheck:id=>{
      const c=get('checks',id);
      assert(c&&!c.closed,'Only open checks can be edited.');
      checkForm(c.mode,null,c);
    },
    client:id=>{
      const row=get('clients',id);
      openDialog(row?'Edit client':'Add client',clientFields,row||{},v=>{
        if(!row||row.name.toLowerCase()!==v.name.toLowerCase()) unique('clients',row,'name',v.name);
        if(v.website) assert(/^https?:\/\//i.test(v.website),'Enter a website beginning with https:// or http://.');
        change('Client saved.',()=>saveRow('clients',row,v));
      });
    },
    mergeClient:id=>{
      const target=get('clients',id);
      assert(target,'Client not found.');
      const alternatives=db.clients.filter(record=>record.id!==id).map(record=>[record.id,record.name+' · '+(record.mode||'Client')]);
      openDialog('Consolidate duplicate',[field('instructions','Keep this profile and move the duplicate’s checks, directors and related parties into it. Existing reports retain their saved details.','info'),
        select('duplicate','Duplicate client to consolidate',alternatives,required)],{},v=>{
        const duplicate=get('clients',v.duplicate);
        assert(duplicate&&duplicate.id!==id,'Select a different client.');
        const conflicts=clientFields.filter(f=>f.name!=='name'&&target[f.name]&&duplicate[f.name]&&target[f.name]!==duplicate[f.name]);
        assert(!conflicts.length,'Resolve conflicting client fields before consolidating: '+conflicts.map(f=>f.label).join(', ')+'.');
        change('Duplicate consolidated.',()=>{
          for(const check of db.checks.filter(check=>check.client===duplicate.id)){
            if(check.mode==='IRC') for(const {name} of ircFields) check[name] ??= duplicate[name] ?? '';
            check.client=id;
          }
          for(const record of [...db.directors,...db.parties].filter(record=>record.client===duplicate.id)) record.client=id;
          for(const {name} of clientFields) if(!target[name]&&duplicate[name]) target[name]=duplicate[name];
          db.clientAliases ??= {};
          db.clientAliases[duplicate.id]=id;
          db.clients=db.clients.filter(record=>record.id!==duplicate.id);
        });
      },'Consolidate');
    },
    party:(client,id)=>editAssociation('parties','related party',partyFields,client,id),
    director:(client,id)=>{
      editAssociation('directors','director',directorFields,client,id);
    },
    end:id=>{
      const c=get('checks',id);
      assert(c&&!c.closed,'This check is already closed.');
      confirmAction('Mark passed and end',count(c)+' of '+c.expected+' expected responses have been received. Ending locks responses and creates the report snapshot.',()=>change('Check ended and report created.',()=>{
        Object.assign(c,{closed:true,ended:today(),endedBy:db.actor});
        c.report=snapshot(c);
      }),'End check');
    },
    reopen:id=>{
      const c=get('checks',id);
      assert(c?.closed,'This check is already open.');
      confirmAction('Reopen check','Eligible respondents can submit or edit again. The next closure will create a fresh report snapshot.',()=>change('Check reopened.',()=>{
        Object.assign(c,{closed:false,ended:'',endedBy:'',report:null});
      }),'Reopen check');
    },
    respond:respondentForm,
    addRoster:id=>{
      const c=get('checks',id);
      assert(c&&!c.closed,'The roster is locked.');
      const options=db.users.filter(u=>eligible(u,c.mode)&&!c.roster.some(r=>r.user===u.id&&!r.left)).map(u=>[u.id,u.name]);
      assert(options.length,'There are no additional eligible respondents.');
      openDialog('Add respondent',[select('user','Staff member',options,required)],{},v=>change('Respondent added.',()=>{
        c.roster.push({user:v.user,joined:today()});
      }));
    },
    removeRoster:(id,user)=>{
      const c=get('checks',id);
      const r=c?.roster.find(r=>r.user===user&&!r.left);
      assert(c&&!c.closed&&r,'This roster entry cannot be changed.');
      confirmAction('Remove respondent','The respondent will lose access to submit or edit. Any existing response stays in the check.',()=>change('Respondent removed.',()=>{r.left=today();}),'Remove respondent');
    },
    profile:()=>{
      const u=actor();
      openDialog('Edit my profile',personFields.filter(field=>field.name!=='email'),u,v=>{
        change('Profile saved.',()=>Object.assign(u,v));
      });
    },
    staff:id=>{
      const u=get('users',id);
      openDialog(u?'Edit staff':'Add staff',[
        ...personFields,select('role','Account role',choices(['Administrator','Staff']),required),
        select('active','Active',yn,required),
        ...modes.map(mode=>select(mode.toLowerCase()+'Role',mode+' role',choices(['No access','Respondent','Check lead']),required)),
        field('joined','Joined date','date'),field('exit','Exit date','date')
      ],u?{...u,drcRole:moduleRole(u,'DRC'),ircRole:moduleRole(u,'IRC')}:{role:'Staff',active:'Yes',drcRole:'Respondent',ircRole:'No access'},v=>change('Staff saved.',()=>updateStaff(u,v)));
    },
    toggle:id=>{
      const u=get('users',id);
      assert(u&&u.id!==db.actor,'You cannot disable your own account.');
      const disable=u.active==='Yes';
      const verb=disable?'Disable':'Enable';
      confirmAction(verb+' staff',disable?'The account and both module roles will be disabled. Prior responses are retained.':'The account will be active. Assign DRC and IRC roles as needed.',()=>change('Staff account updated.',()=>updateStaff(u,{...u,active:disable?'No':'Yes',drcRole:'No access',ircRole:'No access'})),verb);
    },
    reference:(g,id)=>{
      assert(['services','types'].includes(g),'Unknown reference data type.');
      const row=get(g,id);
      openDialog(row?'Edit reference record':'Add reference record',[field('key','Key','text',required),field('name','Label','text',required)],row||{},v=>{
        unique(g,row,'key',v.key);
        change('Reference data saved.',()=>saveRow(g,row,v));
      });
    },
    remove:(g,id)=>{
      assert(['clients','checks','parties','directors','services','types'].includes(g),'This record cannot be deleted.');
      assert(get(g,id),'Record not found.');
      if(g==='checks') assert(!get(g,id).closed,'Only open checks can be deleted.');
      if(g==='clients') assert(!db.checks.some(q=>q.client===id),'This client has checks and cannot be deleted.');
      if(g==='services') assert(!db.checks.some(q=>q.service===id),'This service is in use.');
      confirmAction('Delete record',g==='checks'?'The open check, roster and responses will be removed.':g==='clients'?'The client and its related parties and directors will be removed.':'This record will be removed.',()=>change('Record deleted.',()=>{
        db[g]=db[g].filter(r=>r.id!==id);
        if(g==='checks') return 'checks';
        if(g==='clients'){
          db.parties=db.parties.filter(r=>r.client!==id);
          db.directors=db.directors.filter(r=>r.client!==id);
          return 'clients';
        }
      }),'Delete');
    }
  };
  function editAssociation(g,name,fields,clientId,id) {
    assert(get('clients',clientId),'Client not found.');
    const row=get(g,id);
    assert(!id||row?.client===clientId,'This record belongs to a different client.');
    openDialog((row?'Edit ':'Add ')+name,fields,row||{},v=>change('Record saved.',()=>saveRow(g,row,{...v,client:clientId})));
  }
  const regular=new Set(['respond','profile']);
  const checkActions=new Set(['editCheck','end','reopen','addRoster','removeRoster']);
  function allowedAction(name,args) {
    if(!active()) return false;
    if(regular.has(name)||admin()) return true;
    if(name==='start') return args[1] ? canManage(args[1]) : canStart();
    if(checkActions.has(name)) return canManage(get('checks',args[0])?.mode);
    if(name==='remove'&&args[0]==='checks') return canManage(get('checks',args[1])?.mode);
    return false;
  }
  return {actions, allowedAction, get, actor, admin, active, usersName, client, typeName,
    count, rate, state, ref, modes, moduleRole, eligible, canManage, canSee, canStart, canRespond,
    field, required, choices, select, ircFields, clientFields, personFields, partyFields,
    directorFields, lookup, clientPath, checkPath, assert, today};
}
