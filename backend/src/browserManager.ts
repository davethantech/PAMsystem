/**
 * Keyrail PAM — headed Playwright browser sessions.
 * Authentication is only reported as successful when a configured success
 * condition is observed; navigation away from a login URL alone is not enough.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export type SessionStatus='STARTING'|'AUTHENTICATING'|'AUTHENTICATED'|'CHALLENGE_REQUIRED'|'FAILED'|'CLOSED'|'EXPIRED';
export interface ManagedSession { sessionId:string; userId:string; tenantId:string; applicationId:string; appName:string; credentialId:string; credentialName:string; targetUrl:string; domain:string; status:SessionStatus; startedAt:number; expiresAt:number; browser?:Browser; context?:BrowserContext; page?:Page; error?:string; challengeMessage?:string; monitor?:NodeJS.Timeout; }
const activeSessions=new Map<string,ManagedSession>();

export async function launchApplicationSession(params:{sessionId:string;userId:string;tenantId:string;applicationId:string;appName:string;credentialId:string;credentialName:string;targetUrl:string;domain:string;username:string;password:string;usernameSelector?:string;passwordSelector?:string;submitSelector?:string;successUrlPattern?:string;successSelector?:string;autoSubmit?:boolean}):Promise<ManagedSession>{
  const existing=activeSessions.get(params.sessionId); if(existing&&existing.status!=='CLOSED'&&existing.status!=='FAILED') return existing;
  const session:ManagedSession={sessionId:params.sessionId,userId:params.userId,tenantId:params.tenantId,applicationId:params.applicationId,appName:params.appName,credentialId:params.credentialId,credentialName:params.credentialName,targetUrl:params.targetUrl,domain:params.domain,status:'STARTING',startedAt:Date.now(),expiresAt:Date.now()+2*60*60*1000};
  activeSessions.set(params.sessionId,session);
  void runPlaywrightLaunch(session,params).catch((err)=>{session.status='FAILED';session.error=err instanceof Error?err.message:'Browser launch failed';});
  return session;
}

function safeTarget(url:string, domain:string){
  const u=new URL(url); const d=domain.toLowerCase().replace(/^\*\./,'').replace(/\.$/,''); const host=u.hostname.toLowerCase();
  if(!['https:','http:'].includes(u.protocol)) throw new Error('Unsupported target URL protocol');
  if(host!==d&&!host.endsWith(`.${d}`)) throw new Error('Target URL is outside the configured application domain');
  return u.toString();
}

async function findVisible(page:Page, selectors:string[]){for(const sel of selectors){const el=page.locator(sel).first();if(await el.isVisible().catch(()=>false))return el;}return null;}
function isLoginLike(url:string){try{const p=new URL(url).pathname.toLowerCase();return /login|signin|sign-in|auth|sso/.test(p);}catch{return true;}}
async function detectChallenge(page:Page){
  const indicators=['iframe[src*="captcha"]','iframe[src*="recaptcha"]','iframe[src*="hcaptcha"]','input[name*="otp" i]','input[name*="code" i]','input[autocomplete="one-time-code"]','text=/verify it.?s you/i','text=/security check/i','text=/enter verification code/i','form[action*="challenge"]'];
  for(const ind of indicators){if(await page.locator(ind).first().isVisible().catch(()=>false))return true;} return false;
}
async function hasExplicitSuccess(page:Page,pattern?:string,selector?:string){
  if(selector&&await page.locator(selector).first().isVisible().catch(()=>false))return true;
  if(pattern){try{return new URL(page.url()).toString().includes(pattern);}catch{return false;}}
  return false;
}

async function runPlaywrightLaunch(session:ManagedSession,params:{targetUrl:string;domain:string;username:string;password:string;usernameSelector?:string;passwordSelector?:string;submitSelector?:string;successUrlPattern?:string;successSelector?:string;autoSubmit?:boolean}){
  try{
    safeTarget(session.targetUrl,session.domain);
    let browser:Browser;
    try{browser=await chromium.launch({headless:false,args:['--start-maximized']});}
    catch{browser=await chromium.launch({headless:false,channel:'chrome',args:['--start-maximized']});}
    session.browser=browser;
    const context=await browser.newContext({viewport:null}); session.context=context;
    const page=await context.newPage(); session.page=page;
    browser.on('disconnected',()=>{if(session.status!=='FAILED'&&session.status!=='EXPIRED')session.status='CLOSED';if(session.monitor)clearInterval(session.monitor);});
    session.status='AUTHENTICATING';
    await page.goto(session.targetUrl,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1000);
    const userSelectors=params.usernameSelector?[params.usernameSelector]:['input[autocomplete="username"]','input[type="email"]','input[name*="email" i]','input[name*="user" i]','input[name*="login" i]','input[id*="user" i]','input[id*="login" i]','input[placeholder*="email" i]','input[placeholder*="username" i]','input[type="text"]'];
    const passSelectors=params.passwordSelector?[params.passwordSelector]:['input[autocomplete="current-password"]','input[type="password"]','input[name*="pass" i]','input[id*="pass" i]'];
    const submitSelectors=params.submitSelector?[params.submitSelector]:['button[type="submit"]','input[type="submit"]','button:has-text("Sign in")','button:has-text("Log in")','button:has-text("Continue")','button:has-text("Next")','button:has-text("Submit")'];
    let userEl=await findVisible(page,userSelectors); let passEl=await findVisible(page,passSelectors);
    if(userEl){await userEl.fill(params.username);await page.waitForTimeout(250);}
    if(userEl&&!passEl){const btn=await findVisible(page,submitSelectors);if(btn)await btn.click();else await userEl.press('Enter');await page.waitForTimeout(1500);passEl=await findVisible(page,passSelectors);}
    if(passEl)await passEl.fill(params.password);
    if(passEl&&params.autoSubmit!==false){const btn=await findVisible(page,submitSelectors);if(btn)await btn.click();else await passEl.press('Enter');}
    params.password='';
    await page.waitForTimeout(2500);
    if(await detectChallenge(page)){session.status='CHALLENGE_REQUIRED';session.challengeMessage='Additional verification is required in the open browser window.';}
    else if(await hasExplicitSuccess(page,params.successUrlPattern,params.successSelector)){session.status='AUTHENTICATED';}
    else if(!userEl&&!passEl&&!isLoginLike(page.url())){
      // A target that did not expose a login form can only be considered ready,
      // not authenticated, unless explicitly configured as passwordless.
      session.status='CHALLENGE_REQUIRED'; session.challengeMessage='No login form was detected and no explicit authenticated-state rule is configured.';
    } else {
      session.status='AUTHENTICATING';
    }
    session.monitor=setInterval(async()=>{
      if(!session.page||session.page.isClosed()||session.status==='CLOSED'||session.status==='FAILED'||session.status==='EXPIRED'){if(session.monitor)clearInterval(session.monitor);return;}
      if(Date.now()>=session.expiresAt){if(session.monitor)clearInterval(session.monitor);session.status='EXPIRED';await session.browser?.close().catch(()=>{});return;}
      try{
        if(await detectChallenge(session.page)){session.status='CHALLENGE_REQUIRED';session.challengeMessage='Additional verification is required in the open browser window.';return;}
        if(session.status==='CHALLENGE_REQUIRED'||session.status==='AUTHENTICATING'){
          if(await hasExplicitSuccess(session.page,params.successUrlPattern,params.successSelector)){session.status='AUTHENTICATED';session.challengeMessage=undefined;}
        }
      }catch{}
    },1500);
  }catch(err){session.status='FAILED';session.error=err instanceof Error?err.message:'Login automation failed';if(session.monitor)clearInterval(session.monitor);await session.browser?.close().catch(()=>{});}
}

export function getSession(sessionId:string){return activeSessions.get(sessionId);}
export function listSessions(userId?:string){const all=[...activeSessions.values()].filter(s=>s.status!=='CLOSED');return userId?all.filter(s=>s.userId===userId):all;}
export async function closeSession(sessionId:string){const s=activeSessions.get(sessionId);if(!s)return false;if(s.monitor)clearInterval(s.monitor);await s.browser?.close().catch(()=>{});s.status='CLOSED';activeSessions.delete(sessionId);return true;}
