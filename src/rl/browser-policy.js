import { CHALLENGE_SCHEMA, LEGACY_CHALLENGE_SCHEMA, CHALLENGE_OBSERVATIONS, CHALLENGE_ACTIONS } from './challenge-environment.js';
export function loadPolicy(data) {
  const legacy = data.schema === LEGACY_CHALLENGE_SCHEMA;
  const observations = legacy ? 96 : CHALLENGE_OBSERVATIONS, actions = legacy ? 2 : CHALLENGE_ACTIONS;
  if((!legacy && data.schema!==CHALLENGE_SCHEMA) || data.activation!=='tanh' || data.output!=='clip(-1,1)' || data.layers?.length!==3)
    throw Error('模型格式或观测规范不兼容');
  let size=observations;
  for(const layer of data.layers) {
    if(!Array.isArray(layer.bias)||layer.bias.length<1||layer.bias.length>512||layer.weight?.length!==layer.bias.length||
      !layer.bias.every(Number.isFinite)||!layer.weight.every(row=>Array.isArray(row)&&row.length===size&&row.every(Number.isFinite)))throw Error('模型权重无效');
    size=layer.bias.length;
  }
  if(size!==actions)throw Error('模型动作维度错误');
  const predict=observation=>{
    if(observation.length!==observations||!observation.every(Number.isFinite))throw Error('观测无效');
    let x=observation;
    data.layers.forEach((layer,i)=>{x=layer.weight.map((row,j)=>{const y=row.reduce((s,w,k)=>s+w*x[k],layer.bias[j]);return i<2?Math.tanh(y):Math.max(-1,Math.min(1,y))})});
    return x;
  };
  if(!Array.isArray(data.examples)||!data.examples.length)throw Error('模型缺少推理校验样例');
  for(const example of data.examples) {
    const output=predict(example.observation);
    if(!Array.isArray(example.action)||example.action.length!==actions||!example.action.every(Number.isFinite)||
      output.some((v,i)=>Math.abs(v-example.action[i])>1e-5))throw Error('Python/浏览器推理校验未通过');
  }
  return {predict,steps:data.steps,config:data.config,schema:data.schema,legacy};
}
