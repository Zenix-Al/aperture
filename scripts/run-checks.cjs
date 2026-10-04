const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = process.env.APERTURE_AUDIT_OUTPUT_DIR ? path.resolve(process.env.APERTURE_AUDIT_OUTPUT_DIR) : path.join(ROOT, '.artifacts', 'audits');
fs.mkdirSync(OUTPUT, { recursive: true });
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const groups = {
  tests: [['units', [npm, 'test']], ['browsers', [npm, 'run', 'test:browser']]],
  static: ['lint','lint:addons','check:manifest','check:addons:manifest','check:addons:catalog','check:addons:structure','check:addons:api','check:addons:baseline','check:addons:size','check:docs','check:inventory','check:core','check:css','build:core:smoke','build:addons:smoke'].map(name => [name.replaceAll(':','-'), [npm,'run',name]]),
};
async function run(group) {
  if (!groups[group]) throw new Error('Expected tests or static');
  const results = [];
  for (const [name,args] of groups[group]) {
    const log = fs.openSync(path.join(OUTPUT, name + '.log'), 'w');
    const start = Date.now();
    const exitCode = await new Promise((resolve,reject) => {
      const child = cp.spawn(process.execPath,args,{cwd:ROOT,windowsHide:true,stdio:['ignore',log,log]});
      child.once('error',reject); child.once('close',resolve);
    });
    fs.closeSync(log);
    results.push({ name, command: [process.execPath,...args], status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, elapsedMs: Date.now()-start, log: name+'.log', mutation: 'Temporary smoke artifacts, test evidence and reports only; no version bump or publication' });
    fs.writeFileSync(path.join(OUTPUT,group+'-results.json'),JSON.stringify(results,null,2)+'\n');
    console.log(name+': '+results.at(-1).status);
  }
  if (results.some(row => row.status === 'FAIL')) process.exitCode=1;
}
run(process.argv[2]).catch(error => { console.error(error); process.exitCode=1; });
