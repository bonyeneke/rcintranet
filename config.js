export function originFor(env=process.env) {
  if(!env.APP_URL) throw Error('Set APP_URL to the public origin, including scheme.');
  const url=new URL(env.APP_URL);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.origin!==env.APP_URL||!(url.protocol==='https:'||(loopback&&url.protocol==='http:'))) {
    throw Error('Use an HTTPS origin, without a path or trailing slash. HTTP is supported for local testing only.');
  }
  return url.origin;
}
