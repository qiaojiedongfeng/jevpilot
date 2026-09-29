import readline from 'node:readline';
import { ChallengeDrivingEnv } from '../../src/rl/challenge-environment.js';
let env;
for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})) {
  let q;
  try {
    q=JSON.parse(line);if(q.protocol_version!==1)throw Error('unsupported protocol');
    if(q.command==='close')break;
    let result;
    if(q.command==='reset'){env=new ChallengeDrivingEnv(q.config??{});result=env.reset(q.seed);}
    else if(q.command==='step'&&env)result=env.step(q.action);
    else throw Error('reset required');
    process.stdout.write(JSON.stringify({protocol_version:1,request_id:q.request_id,result})+'\n');
  }catch(e){process.stdout.write(JSON.stringify({protocol_version:1,request_id:q?.request_id,error:e.message})+'\n');}
}
