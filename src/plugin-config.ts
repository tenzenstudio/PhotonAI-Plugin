interface HostReply<T>{value?:T;error?:string;}
interface HostBridge{request(method:string,params:Record<string,unknown>):Promise<HostReply<unknown>>;}

function bridge():HostBridge|undefined{
  return (globalThis as typeof globalThis & {__photonPlugin?:HostBridge}).__photonPlugin;
}

function unsupported(error?:string):boolean{
  return !!error&&/Unsupported Photon SDK capability|plugin bridge is unavailable/i.test(error);
}

export async function readPluginConfig<T>(id:string):Promise<T|undefined>{
  const host=bridge();
  if(!host)return undefined;
  const reply=await host.request('sdk.config.get',{id});
  if(!reply.error)return reply.value as T;
  if(unsupported(reply.error))return undefined;
  throw new Error('Photon Studio needs per-plugin configuration file support: '+reply.error);
}

export async function writePluginConfig(id:string,value:Record<string,unknown>):Promise<boolean>{
  const host=bridge();
  if(!host)return false;
  const reply=await host.request('sdk.config.set',{id,value});
  if(!reply.error)return true;
  if(unsupported(reply.error))return false;
  throw new Error('Photon Studio needs per-plugin configuration file support: '+reply.error);
}
