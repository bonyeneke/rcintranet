import {createHash,randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(derive);
const limits={N:131072,r:8,p:1,maxmem:160*1024*1024};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('base64url');
export const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
export const validPassword=value=>typeof value==='string'&&value.length>=12&&value.length<=128;
export async function passwordHash(password) {
  const salt=randomBytes(16).toString('hex');
  return salt+':'+(await scrypt(password,salt,64,limits)).toString('hex');
}
export async function passwordMatches(password,stored) {
  const [salt,expected]=(stored||'00000000000000000000000000000000:'+ '0'.repeat(128)).split(':');
  const actual=await scrypt(password,salt,64,limits);
  return Boolean(stored)&&timingSafeEqual(actual,Buffer.from(expected,'hex'));
}
export function pruneCredentials(state) {
  for(const records of [state.sessions,state.tokens]){
    for(const [key,value] of Object.entries(records)) if(value.expires<=Date.now()) delete records[key];
  }
}
export function revoke(state,id) {
  for(const records of [state.sessions,state.tokens]){
    for(const [key,value] of Object.entries(records)) if(value.user===id) delete records[key];
  }
}
export function issueSetup(state,user) {
  pruneCredentials(state);
  for(const [key,value] of Object.entries(state.tokens)) if(value.user===user.id) delete state.tokens[key];
  const token=randomToken();
  state.tokens[digest(token)]={user:user.id,email:user.email,expires:Date.now()+60*60*1000};
  return token;
}
