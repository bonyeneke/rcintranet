const form=document.querySelector('#login-form');
const message=document.querySelector('#login-message');
const button=document.querySelector('#login-submit');

const fragment=location.hash.slice(1);
const setup=fragment.startsWith('setup=')?fragment.slice(6):null;
const reset=fragment==='reset';
const next=/^(checks|clients|reports)\/[a-zA-Z0-9-]+$/.test(fragment)?'#'+fragment:'';
if(setup||reset){
  const title=setup?'Set your password':'Request a password setup link';
  document.querySelector('#login-title').textContent=title;
  button.textContent=setup?'Save password':'Request link';
  document.querySelector('#mode-link').textContent='Back to sign in';
  document.querySelector('#mode-link').href='/login';
  form.elements.email.disabled=Boolean(setup);
  form.elements.password.disabled=reset;
  document.querySelector('#email-field').hidden=Boolean(setup);
  document.querySelector('#password-field').hidden=reset;
  if(setup) form.elements.password.autocomplete='new-password';
}
window.addEventListener('hashchange',()=>location.reload());
form.addEventListener('submit',async event=>{
  event.preventDefault();
  button.disabled=true;
  message.textContent='';
  const values=Object.fromEntries(new FormData(form));
  const action=setup?'setup':reset?'request':'login';
  if(setup) values.token=setup;
  try{
    const response=await fetch('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const result=await response.json();
    if(!response.ok) throw Error(result.error);
    if(action==='login') location.assign('/'+next);
    else if(setup) location.assign('/login');
    else message.textContent=result.message;
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
});
