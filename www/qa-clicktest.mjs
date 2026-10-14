import pkg from '/tmp/gamecheck/node_modules/@playwright/test/index.js';
const { chromium } = pkg;
import http from 'http'; import fs from 'fs'; import path from 'path';
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2'};
const server=http.createServer((q,r)=>{ let u=decodeURIComponent(q.url.split('?')[0]); if(u==='/')u='/app.html';
  fs.readFile(path.join('/tmp/appserve',u),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'Content-Type':types[path.extname(u)]||'application/octet-stream'});r.end(d); }); });
await new Promise(r=>server.listen(8099,r));
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--disable-setuid-sandbox']});
const shots='/mnt/user-data/outputs/login-fix-frames'; fs.mkdirSync(shots,{recursive:true});
let allok=true;
for(const [name,vp] of [['iPad',{width:1024,height:1366}],['iPhone',{width:414,height:896}]]){
  const pg=await (await b.newContext({viewport:vp})).newPage();
  await pg.goto('http://localhost:8099/app.html',{waitUntil:'domcontentloaded'});
  await pg.waitForTimeout(2200);
  await pg.screenshot({path:`${shots}/${name}-1-firstrun.png`});
  // The reviewer's exact action: tap "Log in to save your place"
  await pg.click('#btnSignin', {timeout:5000});
  await pg.waitForTimeout(700);
  const ok = await pg.evaluate(()=>{
    const w=document.getElementById('loginWall');
    if(!w) return false;
    const cs=getComputedStyle(w);
    const r=w.getBoundingClientRect();
    // correct visibility test for position:fixed
    if(cs.display==='none'||cs.visibility==='hidden'||r.height<50) return false;
    // and the form must be usable: the email field must be the top element at its center
    const e=document.getElementById('lwEmail'); if(!e) return false;
    const er=e.getBoundingClientRect();
    const top=document.elementFromPoint(er.left+er.width/2, er.top+er.height/2);
    return top===e || e.contains(top);
  });
  console.log(`${name}: tap "Log in to save your place" -> login form OPEN AND USABLE:`, ok);
  if(!ok) allok=false;
  await pg.screenshot({path:`${shots}/${name}-2-login-open.png`});
}
console.log(allok ? 'RESULT: PASS on both devices' : 'RESULT: FAIL');
await b.close(); server.close();
process.exit(allok?0:1);
