import readline from 'node:readline';
import { DrivingEnv } from '../../src/rl/environment.js';

const env = new DrivingEnv();
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.protocol_version !== 1) throw new Error('unsupported protocol');
    let result;
    if (request.command === 'reset') result = env.reset(request.seed);
    else if (request.command === 'step') result = env.step(request.action);
    else if (request.command === 'close') { lines.close(); break; }
    else throw new Error('unknown command');
    process.stdout.write(JSON.stringify({ protocol_version: 1, request_id: request.request_id, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ protocol_version: 1, request_id: request?.request_id, error: error.message }) + '\n');
  }
}
