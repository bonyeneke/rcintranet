import {workflows} from './workflows.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let db;
let bindings;
const hash = () => (location.hash.slice(1) || 'home').split('/');
const to = path => { location.hash = path; };
const tag = (label,cls='') => '<span class="tag '+cls+'">'+esc(label)+'</span>';
const link = (path,label,cls='') => '<a class="'+cls+'" href="#'+path+'">'+esc(label)+'</a>';
const btn = (action,label,args=[],cls='') => '<button type="button" class="'+cls+'" data-action="'+action+'" data-args="'+esc(JSON.stringify(args))+'">'+esc(label)+'</button>';
const group = (...items) => '<div class="buttons">'+items.join('')+'</div>';
const head = (title,description='',actions='') => '<div class="heading"><div><h1>'+esc(title)+'</h1>'+(description?'<p>'+esc(description)+'</p>':'')+'</div>'+actions+'</div>';
const panel = (name,body) => '<section class="panel">'+(name?'<h2>'+esc(name)+'</h2>':'')+body+'</section>';
const table = (cols,rows,empty='No records match.') => rows.length ? '<div class="scroll"><table><thead><tr>'+cols.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>' : '<p class="empty">'+esc(empty)+'</p>';
const facts = rows => '<dl class="facts">'+rows.map(([l,v])=>'<dt>'+esc(l)+'</dt><dd>'+esc(v === '' || v == null ? '—' : v)+'</dd>').join('')+'</dl>';
const metric = (label,n) => '<div class="metric"><span>'+esc(label)+'</span><b>'+esc(n)+'</b></div>';
const nav = [
 ['Workspace', [['home','Overview','◈'],['checks','Relationship checks','▣'],['tasks','My responses','✓'],['reports','Reports','▤'],['reminders','Daily reminders','◷']]],
 ['Records', [['clients','Clients','◫'],['directory','Staff directory','♙'],['profile','My profile','◉']]],
 ['Administration', [['admin','Staff administration','⚙'],['settings','Reference data','≡']]]
];
const checkTable = rows => table(['Reference / client','Mode','Engagement','Started','Status','Responses'],rows.map(c=>[
 link(checkPath(c),ref(c))+'<br>'+esc(client(c)?.name),tag(c.mode),esc(c.engagement||lookup(c.service)||'—'),esc(c.started),
 tag(checkState(c),c.closed?'good':count(c)?'warn':'neutral'),count(c)+' / '+c.expected+
 '<div class="progress" role="progressbar" aria-label="Response completion" aria-valuenow="'+Math.min(100,rate(c)||0)+'"><i style="width:'+Math.min(100,rate(c)||0)+'%"></i></div>'
]));
let filters = Object.create(null);
const filter = (name,value,options) => '<select aria-label="'+esc(name)+'" data-filter="'+name+'">'+options.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>';
const search = (placeholder,value) => '<input type="search" data-filter="search" aria-label="'+esc(placeholder)+'" placeholder="'+esc(placeholder)+'" value="'+esc(value||'')+'">';
const matches = (...values) => values.join(' ').toLowerCase().includes((filters.search||'').toLowerCase());
const openDialog = (title,fields,values,save,label='Save') => {
  $('modalTitle').textContent = title;
  $('error').textContent = '';
  $('submit').textContent = label;
  $('fields').innerHTML = fields.map(f=>{
    const attrs = ['name="'+f.name+'"',f.required?'required':'',f.max?'maxlength="'+f.max+'"':'',f.min!==undefined?'min="'+f.min+'"':'',f.limit?'max="'+f.limit+'"':'',f.step?'step="'+f.step+'"':''].join(' ');
    const value = values[f.name] ?? '';
    let control;
    if(f.type==='select') control = '<select '+attrs+'><option value="">Select…</option>'+f.options.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(value)===v?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>';
    else if(f.type==='textarea') control = '<textarea '+attrs+'>'+esc(value)+'</textarea>';
    else if(f.type==='info') return '<p class="wide muted">'+esc(f.label)+'</p>';
    else control = '<input type="'+f.type+'" '+attrs+' value="'+esc(value)+'">';
    return '<label class="'+(f.type==='textarea'?'wide':'')+'">'+esc(f.label)+(f.required?' *':'')+control+'</label>';
  }).join('');
  onSave = save;
  $('modal').showModal();
};
let onSave;
let timer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display='block';
  clearTimeout(timer);
  timer=setTimeout(()=>$('toast').style.display='none',4200);
}
function overview() {
  const visible=db.checks.filter(c=>canSee(c.mode));
  const open=visible.filter(c=>!c.closed);
  const pending=db.checks.filter(c=>canRespond(c)&&!c.responses[db.actor]);
  return '<section class="hero heading"><div><h1>Relationship Check Workspace</h1><p>Manage domestic and international independence checks.</p></div>'+
    (canStart()?btn('start','Start a check',[],'primary'):link('tasks','View response tasks','button primary'))+'</section>'+
    '<div class="metrics">'+metric('Open DRC checks',open.filter(c=>c.mode==='DRC').length)+metric('Open IRC checks',open.filter(c=>c.mode==='IRC').length)+metric('My pending responses',pending.length)+metric('Completed checks',visible.length-open.length)+'</div>'+
    panel('Recent relationship checks',checkTable([...visible].sort((a,b)=>b.number-a.number).slice(0,6)))+
    '<div class="grid2">'+panel('Domestic relationship checks','<p>Manage domestic clients, engagement services, directors and staff responses.</p><p>'+(canSee('DRC')?link('clients','Browse clients'):'')+'</p>')+
    panel('International relationship checks','<p>Manage member-firm referrals, calendar lookback and eligible IRC responders.</p><p>'+(canSee('IRC')?link('clients','Browse clients'):'')+'</p>')+'</div>';
}
function clientsPage(id) {
  if(!modes.some(canSee)) return missing('Module access required');
  const records=db.clients.filter(c=>matches(c.name,c.industry,c.office));
  if(!id) return head('Clients','Use one client profile for domestic and international relationship checks.',group(admin()?btn('client','Add client',[],'primary'):'',canSee('DRC')?btn('csv','Download CSV'):''))+
    '<div class="toolbar">'+search('Search clients',filters.search)+'</div>'+
    panel('',table(['Client','Industry','Office',...modes.filter(canSee)],records.map(c=>[
      link(clientPath(c),c.name),esc(c.industry||'—'),esc(c.office||'—'),
      ...modes.filter(canSee).map(mode=>db.checks.filter(q=>q.client===c.id&&q.mode===mode).length)
    ])));
  const movedTo=db.clientAliases?.[id];
  if(movedTo&&Object.hasOwn(db.clientAliases,id)) return clientsPage(movedTo);
  const record=get('clients',id);
  if(!record) return missing();
  function assoc(collection,title,action,fields) {
    const records=db[collection].filter(r=>r.client===id);
    const headers=fields.map(f=>f.label);
    if(admin()) headers.push('Actions');
    return panel(title,(admin()?'<div class="toolbar">'+btn(action,'Add '+(action==='party'?'related party':'director'),[id])+'</div>':'')+
      table(headers,records.map(r=>[...fields.map(f=>esc(r[f.name]||'—')),...(admin()?[group(btn(action,'Edit',[id,r.id]),btn('remove','Remove',[collection,r.id],'danger'))]:[])])));
  }
  return head(record.name,'Client profile',group(link('clients','All clients','button'),
    ...modes.filter(canManage).map(mode=>btn('start','Start '+mode+' check',[id,mode],'primary')),
    admin()?btn('client','Edit client',[id]):'',admin()&&db.clients.length>1?btn('mergeClient','Consolidate duplicate',[id]):'',
    admin()?btn('remove','Delete client',['clients',id],'danger'):''))+
    panel('Client information',facts(clientFields.map(f=>[f.label,record[f.name]])))+
    '<div class="grid2">'+(canSee('DRC')?assoc('directors','Director details','director',directorFields):'')+
    assoc('parties','Related parties','party',partyFields)+'</div>'+
    panel('Relationship checks',checkTable(db.checks.filter(c=>c.client===id&&canSee(c.mode))));
}
function checksPage() {
  const buckets = {
    New:c=>!c.closed && !count(c),
    Unattended:c=>!c.closed && !count(c),
    Attended:c=>!c.closed && count(c)>0,
    Ongoing:c=>!c.closed && count(c)>0 && count(c)<c.roster.filter(r=>!r.left).length,
    'Checked out':c=>c.closed
  };
  const rows=db.checks.filter(c=>canSee(c.mode)&&(!filters.mode||c.mode===filters.mode)&&(!filters.state||buckets[filters.state](c))&&(!filters.service||c.service===filters.service)&&matches(ref(c),client(c)?.name,c.engagement,c.reason));
  return head('Relationship checks','Review check status, response progress and engagement details.',canStart()?btn('start','Start a check',[],'primary'):'')+
    '<div class="toolbar">'+search('Search checks',filters.search)+filter('mode',filters.mode,[['','All modes'],...choices(['DRC','IRC'])])+
    filter('state',filters.state,[['','All statuses'],...choices(Object.keys(buckets))])+filter('service',filters.service,[['','All services'],...db.services.map(s=>[s.id,s.name])])+'</div>'+
    panel('',checkTable([...rows].sort((a,b)=>b.number-a.number)));
}
function checkPage(id) {
  const c=get('checks',id);
  if(!c || !canSee(c.mode)) return missing();
  const manage=canManage(c.mode);
  const owner=client(c);
  const buttons=[link('checks','All checks','button')];
  if(canRespond(c)) buttons.push(btn('respond',c.responses[db.actor]?'Edit my response':'Submit response',[id],'primary'));
  if(c.closed) {
    if(manage) buttons.push(link('reports/'+id,'View report','button primary'));
    if(manage) buttons.push(btn('reopen','Reopen',[id]));
  } else if(manage) {
    buttons.push(btn('editCheck','Edit check',[id]),btn('end','Mark passed and end',[id],'primary'),btn('remove','Delete check',['checks',id],'danger'));
  }
  const rows=c.roster.map(r=>[
    esc(usersName(r.user)),esc(r.joined||c.started),esc(r.left||'—'),
    r.left?tag('Removed','neutral'):c.responses[r.user]?tag('Responded','good'):eligible(get('users',r.user),c.mode)?tag('Pending','warn'):tag('Ineligible','neutral'),
    manage&&!c.closed&&!r.left?btn('removeRoster','Remove',[id,r.user]):'—'
  ]);
  return head(ref(c)+' · '+owner.name,typeName(c.mode)+' relationship check',group(...buttons))+
    '<div class="metrics">'+metric('Status',checkState(c))+metric('Expected responses',c.expected)+metric('Total received',count(c))+metric('Completion rate',rate(c)===null?'—':rate(c)+'%')+'</div>'+
    '<div class="grid2">'+panel('Check information',facts([['Client',owner.name],['Engagement',c.engagement],['Reason',c.reason],[c.mode==='DRC'?'Service':'Calendar lookback',c.mode==='DRC'?lookup(c.service):c.lookback],...(c.mode==='IRC'?ircFields.map(f=>[f.label,c[f.name]??owner[f.name]]):[]),['Started',c.started+' · '+usersName(c.startedBy)],['Ended',c.ended?c.ended+' · '+usersName(c.endedBy):'']])+'<p>'+link(clientPath(owner),'Open client record')+'</p>')+
    panel('Client associations',table(['Name','Relationship','Location'],db.parties.filter(p=>p.client===owner.id).map(p=>[esc(p.name),esc(p.relation),esc(p.location)]))+
      (c.mode==='DRC'?table(['Director','Type','Country'],db.directors.filter(p=>p.client===owner.id).map(p=>[esc(p.name),esc(p.type),esc(p.country)])):'') )+'</div>'+
    (manage?panel('Respondent roster',(manage&&!c.closed?'<div class="toolbar">'+btn('addRoster','Add respondent',[id])+link('reminders/'+id,'Preview reminder','button')+'</div>':'')+table(['Name','Joined','Left','Response','Action'],rows)):'')+
    (manage?panel('Responses',table(['Respondent','Answer 1','Details',...(c.mode==='DRC'?['Answer 2','Details']:[])],Object.entries(c.responses).map(([staff,r])=>[esc(usersName(staff)),r.a1==='1'?'Yes':'No',esc(r.d1||'—'),...(c.mode==='DRC'?[r.a2==='1'?'Yes':'No',esc(r.d2||'—')]:[])]))):'');
}
function dailyReminders(checks) {
  const recipients=new Map();
  for(const check of checks){
    if(check.closed||!canManage(check.mode)) continue;
    for(const id of new Set(check.roster.filter(entry=>!entry.left).map(entry=>entry.user))){
      const person=get('users',id);
      if(!eligible(person,check.mode)||Object.hasOwn(check.responses,id)) continue;
      if(!recipients.has(id)) recipients.set(id,{person,checks:[]});
      recipients.get(id).checks.push(check);
    }
  }
  return [...recipients.values()].sort((a,b)=>a.person.name.localeCompare(b.person.name));
}
function remindersPage(id) {
  if(!canStart()) return missing('Check lead access required');
  const check=id?get('checks',id):null;
  if(id&&(!check||!canManage(check.mode))) return missing('Check lead access required');
  const reminders=dailyReminders(check?[check]:db.checks);
  return head(check?'Daily reminders · '+ref(check):'Daily reminders',
    'Preview the daily email for each staff member with outstanding responses.',
    check?group(link(checkPath(check),'Back to check','button'),link('reminders','All daily reminders','button')):'')+
    '<p class="notice">The scheduled job sends daily reminders when mail and scheduling are configured.</p>'+
    (reminders.length?reminders.map(({person,checks})=>panel(person.name,
      '<p><strong>To</strong> '+esc(person.email)+'</p>'+
      '<p><strong>Subject</strong> Daily reminder — outstanding relationship check responses</p>'+
      '<p>Hello '+esc(person.name)+',</p>'+
      '<p>Please complete your outstanding relationship check responses:</p>'+
      '<ul>'+checks.map(check=>'<li>'+link(checkPath(check),ref(check))+' · '+esc(client(check)?.name)+'</li>').join('')+'</ul>'+
      '<p>Open each check and submit your response. If you have already submitted, no further action is needed.</p>'+
      '<p>Relationship Checks Team</p>')).join(''):panel('','<p class="empty">No outstanding responses to remind.</p>'));
}
function tasks() {
  const view=filters.view||'pending';
  const rows=db.checks.filter(c=>view==='pending' ? canRespond(c)&&!c.responses[db.actor] : c.mode===view&&c.responses[db.actor]);
  return head('My responses','Review your assignments and previously submitted responses.')+
    '<div class="toolbar">'+filter('view',view,[['pending','Pending tasks'],['DRC','DRC response history'],['IRC','IRC response history']])+'</div>'+
    panel('',table(['Check','Client','Engagement','Status','Action'],rows.map(c=>[
      link(checkPath(c),ref(c)),esc(client(c)?.name),esc(c.engagement||'—'),tag(c.closed?'Checked out':view==='pending'?'Pending':'Submitted',view==='pending'?'warn':'good'),
      view==='pending'?btn('respond','Respond',[c.id],'primary'):btn('respond',canRespond(c)?'Edit response':'View response',[c.id])
    ])));
}
function staffPage(isAdmin,id) {
  if(isAdmin&&!admin()) return missing('Administrator access required');
  const records=db.users.filter(u=>(isAdmin||u.active==='Yes')&&(!filters.active||u.active===filters.active)&&matches(u.name,u.email,u.location));
  const u=get('users',id);
  if(id && (!u || (!isAdmin&&u.active!=='Yes'))) return missing();
  if(id) return head(u.name,'Staff profile',group(link(isAdmin?'admin':'directory','Back to staff','button'),isAdmin?btn('staff','Edit staff',[id],'primary')+(u.active==='Yes'?btn('invite','Send setup link',[id]):''):'',isAdmin&&id!==db.actor?btn('toggle',u.active==='Yes'?'Disable':'Enable',[id]):''))+
    panel('Contact details',facts(personFields.map(f=>[f.label,u[f.name]])))+
    (isAdmin?panel('Account details',facts([['Role',u.role],['Active',u.active],['DRC role',moduleRole(u,'DRC')],['IRC role',moduleRole(u,'IRC')],['Joined',u.joined],['Exited',u.exit]])):'');
  return head(isAdmin?'Staff administration':'Staff directory',isAdmin?'Assign No access, Respondent or Check lead independently for DRC and IRC. Check leads manage checks and reports. Respondents submit their own answers when assigned.':'Find active colleagues and view their work contact details.',isAdmin?btn('staff','Add staff',[],'primary'):'')+
    '<div class="toolbar">'+search('Search staff',filters.search)+(isAdmin?filter('active',filters.active,[['','All staff'],['Yes','Active'],['No','Disabled']]):'')+'</div>'+
    panel('',table(['Name','Work email','Location',...(isAdmin?['Status','DRC role','IRC role','Account role']:[])],records.map(u=>[link((isAdmin?'admin':'directory')+'/'+u.id,u.name),esc(u.email),esc(u.location||'—'),...(isAdmin?[tag(u.active==='Yes'?'Active':'Disabled',u.active==='Yes'?'good':'neutral'),esc(moduleRole(u,'DRC')),esc(moduleRole(u,'IRC')),esc(u.role)]:[])])));
}
function profile() {
  const u=actor();
  return head('My profile','Your staff contact information.',btn('profile','Edit my profile',[],'primary'))+
    panel(u.name,facts(personFields.map(f=>[f.label,u[f.name]])))+
    panel('Account',facts([['Role',u.role],['DRC role',moduleRole(u,'DRC')],['IRC role',moduleRole(u,'IRC')],['Joined',u.joined]]));
}
function settings() {
  if(!admin()) return missing('Administrator access required');
  return head('Reference data','Maintain services and check types.')+'<div class="grid2">'+
    [['services','Services'],['types','Check types']].map(([g,label])=>panel(label,
      '<div class="toolbar">'+btn('reference','Add '+(g==='services'?'service':'check type'),[g],'primary')+'</div>'+
      table(['Key','Label','Actions'],db[g].map(r=>[esc(r.key),esc(r.name),group(btn('reference','Edit',[g,r.id]),btn('remove','Remove',[g,r.id],'danger'))])))).join('')+'</div>';
}
function reportPage(id) {
  if(!canStart()) return missing('Check lead access required');
  if(!id) return head('Reports','Open completed checks and print their frozen report snapshots.')+
    panel('',table(['Check','Client','Mode','Responses','Ended','Report'],db.checks.filter(c=>c.closed&&canManage(c.mode)).sort((a,b)=>Number(Boolean(b.sample))-Number(Boolean(a.sample)) || b.ended.localeCompare(a.ended)).map(c=>[
      link(checkPath(c),ref(c)),esc(c.report.company.name),tag(c.mode),count(c)+' / '+c.expected,esc(c.ended),link('reports/'+c.id,c.sample?'Open '+c.mode+' sample':'Open report')
    ])));
  const source=get('checks',id);
  if(source&&!canManage(source.mode)) return missing('Check lead access required');
  if(!source?.closed||!source.report) return missing('A report is available once the check is ended.');
  const {check:c,company,people,parties,directors}=source.report;
  const mode=typeName(c.mode);
  const narratives=Object.entries(c.responses).flatMap(([id,r])=>{
    const details=[r.a1==='1'?r.d1:'',c.mode==='DRC'&&r.a2==='1'?r.d2:''].filter(Boolean);
    return details.length?['<section class="disclosure"><h4>'+esc(people[id])+'</h4>'+details.map(text=>'<p>'+esc(text)+'</p>').join('')+'</section>']:[];
  });
  return head(ref(c)+' report','Frozen at check closure · Saved report snapshot',group(link('reports','All reports','button'),btn('print','Print / Save PDF',[],'primary')))+
    '<article class="report-page"><div class="report-brand">Grant Thornton Nigeria</div><h2>MEMO</h2><h3>Report of the '+mode.toLowerCase()+' relationship check for '+esc(company.name)+'</h3>'+
    facts([['From',mode+' Relationship Checks Contact'],['To',company.partner||'Engagement Partner'],['Date',c.ended]])+
    '<p>Please find below the outcome of the '+mode.toLowerCase()+' relationship check conducted for the above entity.</p><div class="notice">'+
    facts([['Expected No. of Responses',c.expected],['Total Responses Received',String(count(c))],['Completion Rate',rate(c)===null?'—':rate(c)+'%']])+'</div>'+
    '<h3>Details of respondents’ relationship</h3>'+(narratives.join('')||'<p>No relationships disclosed by respondents.</p>')+
    '<div class="signature"><strong>'+ (c.mode==='DRC'?'Domestic Relationship Checks':'International Relationship Checks')+'</strong><p>'+mode+' Relationship Checks Contact</p></div></article>'+
    '<article class="report-page"><h2>The Company/Organization</h2>'+facts([['Name',company.name],['Address',company.address],['Website',company.website],['Engagement partner',company.partner],['Engagement partner email',company.partnerEmail],['Engagement partner phone',company.partnerPhone],['Engagement type',c.engagement],[c.mode==='IRC'?'Calendar lookback':'Service',c.mode==='IRC'?c.lookback:source.report.service],['Sources of information',company.sources],...(c.mode==='IRC'?ircFields.map(f=>[f.label,c[f.name]??company[f.name]]):[])])+
    (c.mode==='DRC'?'<h3>Director Details</h3>'+table(['Name','Type','Country','Shares'],directors.map(r=>[esc(r.name),esc(r.type),esc(r.country),esc(r.shares)])):'')+
    '<h3>Related Parties</h3>'+table(['Name','Relationship','Location','Transactions'],parties.map(r=>[esc(r.name),esc(r.relation),esc(r.location),esc(r.transactions)]))+'</article>';
}
const missing = (label='Page not available') => head(label,'',link('home','Return to overview','button'));
function render() {
  const [page,id]=hash();
  const label=nav.flatMap(([,links])=>links).find(([path])=>path===page)?.[1]||'Overview';
  $('crumb').textContent=label;
  $('identity').textContent=actor().name;
  $('nav').innerHTML=nav.map(([heading,links])=>{
    const available=links.filter(([path])=>{
      if(['admin','settings'].includes(path)) return admin();
      if(path==='clients') return modes.some(canSee);
      if(path==='reports'||path==='reminders') return canStart();
      return true;
    });
    if(!available.length) return '';
    return '<h3>'+heading+'</h3>'+available.map(([path,name,icon])=>'<a href="#'+path+'"'+(page===path?' aria-current="page"':'')+'><span aria-hidden="true">'+icon+'</span>'+name+'</a>').join('');
  }).join('');
  const pages={home:overview,clients:()=>clientsPage(id),drc:()=>clientsPage(id),irc:()=>clientsPage(id),checks:()=>id?checkPage(id):checksPage(),tasks,reminders:()=>remindersPage(id),reports:()=>reportPage(id),directory:()=>staffPage(false,id),admin:()=>staffPage(true,id),profile,settings};
  $('screen').innerHTML=active()&&Object.hasOwn(pages,page)?pages[page]():missing();
}
function downloadCsv() {
  const cols=clientFields;
  const cell=v=>{
    const value=String(v??'');
    return '"'+(/^[\s]*[=+\-@]/.test(value)?"'":'')+value.replaceAll('"','""')+'"';
  };
  const records=db.clients.filter(c=>matches(c.name,c.industry,c.office));
  const lines=[cols.map(f=>cell(f.label)),...records.map(r=>cols.map(f=>cell(r[f.name])))];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(r=>r.join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url;
  a.download='clients.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const actions={
  dismiss:()=>$('modal').close(),
  csv:downloadCsv,
  print:()=>window.print(),
  invite:id=>openDialog('Send account setup link',[
    field('notice','Send a password setup link to '+get('users',id).email+'.','info')
  ],{},()=>{},'Send email')
};
function binding(state) {
  db=state;
  bindings=workflows(db,{openDialog,change(){}});
  ({get, actor, admin, active, usersName, client, typeName, count, rate, state:checkState,
    ref, modes, moduleRole, eligible, canManage, canSee, canStart, canRespond,
    field, required, choices, select, ircFields, clientFields, personFields, partyFields,
    directorFields, lookup, clientPath, checkPath, assert}=bindings);
}
let get, actor, admin, active, usersName, client, typeName, count, rate, checkState, ref, modes,
  moduleRole, eligible, canManage, canSee, canStart, canRespond, field, required, choices,
  select, ircFields, clientFields, personFields, partyFields, directorFields, lookup,
  clientPath, checkPath, assert;
let pendingAction;
function openAction(name,args) {
  pendingAction=null;
  if(name==='start'&&!args[1]){
    openDialog('Choose check mode',[select('mode','Relationship check mode',choices(modes.filter(canManage)),required)],{},values=>{
      $('modal').close();
      openAction('start',[args[0]??null,values.mode]);
    },'Continue');
    return;
  }
  if(Object.hasOwn(actions,name)){
    actions[name](...args);
    if(name==='invite') pendingAction={name,args};
    return;
  }
  assert(Object.hasOwn(bindings.actions,name)&&bindings.allowedAction(name,args),'Your role does not allow this action.');
  bindings.actions[name](...args);
  if(name!=='respond'||canRespond(get('checks',args[0]))) pendingAction={name,args};
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');
  if(!target) return;
  const name=target.dataset.action;
  try{
    const args=JSON.parse(target.dataset.args||'[]');
    openAction(name,args);
  }catch(error){toast(error.message);}
});
$('form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const values=Object.fromEntries([...new FormData(event.currentTarget)].map(([k,v])=>[k,v.trim()]));
    for(const input of event.currentTarget.querySelectorAll('[required]')) assert(values[input.name],'Complete all required fields.');
    const action=pendingAction;
    if(!action){
      onSave(values);
      if($('modal').open && !pendingAction) $('modal').close();
      return;
    }
    $('submit').disabled=true;
    const result=await api(action.name==='invite'?'/api/invite':'/api/action',{...action,values,version:db.version});
    if(result.state) binding(result.state);
    $('modal').close();
    pendingAction=null;
    if(result.target) to(result.target);
    render();
    toast(result.message);
  }catch(error){$('error').textContent=error.message;}finally{$('submit').disabled=false;}
});
$('screen').addEventListener('input',event=>{
  if(event.target.dataset.filter!=='search') return;
  filters.search=event.target.value;
  render();
  const replaced=$('screen').querySelector('[data-filter=search]');
  replaced.focus();
});
$('screen').addEventListener('change',event=>{
  const f=event.target.dataset.filter;
  if(!f||f==='search') return;
  filters[f]=event.target.value;
  render();
  $('screen').querySelector('[data-filter="'+f+'"]')?.focus();
});
window.addEventListener('hashchange',()=>{filters=Object.create(null);render();window.scrollTo(0,0);});

async function api(path,data) {
  const response=await fetch(path,data===undefined?{}:{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
  });
  if(response.status===401 && !path.includes('/auth/')) location.assign('/login');
  const result=await response.json();
  if(!response.ok) {
    if(response.status===409){
      binding(await api('/api/state'));
      render();
    }
    throw Error(result.error||'The request could not be completed.');
  }
  return result;
}
$('logout').addEventListener('click',async()=>{
  try { await api('/api/auth/logout',{});location.assign('/login'); }
  catch(error){toast(error.message);}
});
try { binding(await api('/api/state')); render(); }
catch(error){ $('screen').textContent=error.message; }
