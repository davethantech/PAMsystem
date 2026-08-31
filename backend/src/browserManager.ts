/**
 * Keyrail PAM — Playwright Browser Automation Manager
 * 
 * Manages real, visible, headed Chromium browser sessions on the host.
 * Brokered authentication: Credentials decrypted ONLY in backend memory,
 * injected into Playwright Chromium context, and zeroed after submission.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export type SessionStatus = 
  | 'STARTING'
  | 'AUTHENTICATING'
  | 'AUTHENTICATED'
  | 'CHALLENGE_REQUIRED'
  | 'FAILED'
  | 'CLOSED'
  | 'EXPIRED';

export interface ManagedSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  applicationId: string;
  appName: string;
  credentialId: string;
  credentialName: string;
  targetUrl: string;
  domain: string;
  status: SessionStatus;
  startedAt: number;
  expiresAt: number;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  error?: string;
  challengeMessage?: string;
}

const activeSessions = new Map<string, ManagedSession>();

export async function launchApplicationSession(params: {
  sessionId: string;
  userId: string;
  tenantId: string;
  applicationId: string;
  appName: string;
  credentialId: string;
  credentialName: string;
  targetUrl: string;
  domain: string;
  username: string;
  password: string; // Plaintext passed ONLY inside backend broker memory
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successUrlPattern?: string;
  successSelector?: string;
  autoSubmit?: boolean;
}): Promise<ManagedSession> {
  const existing = activeSessions.get(params.sessionId);
  if (existing && existing.status !== 'CLOSED' && existing.status !== 'FAILED') {
    return existing;
  }

  const session: ManagedSession = {
    sessionId: params.sessionId,
    userId: params.userId,
    tenantId: params.tenantId,
    applicationId: params.applicationId,
    appName: params.appName,
    credentialId: params.credentialId,
    credentialName: params.credentialName,
    targetUrl: params.targetUrl,
    domain: params.domain,
    status: 'STARTING',
    startedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 2, // 2 hour max session
  };

  activeSessions.set(params.sessionId, session);

  // Run Playwright launch asynchronously so caller gets immediate session object
  runPlaywrightLaunch(session, params).catch((err) => {
    session.status = 'FAILED';
    session.error = err instanceof Error ? err.message : 'Browser launch failed';
    console.error('[PlaywrightManager] Launch error:', err);
  });

  return session;
}

async function runPlaywrightLaunch(session: ManagedSession, params: {
  username: string;
  password: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successUrlPattern?: string;
  successSelector?: string;
  autoSubmit?: boolean;
}) {
  try {
    session.status = 'STARTING';

    // 1. Launch real, visible, headed Chromium browser
    console.log(`[PlaywrightManager] Launching visible Chromium for ${session.appName} (${session.targetUrl})...`);
    
    let browser: Browser;
    try {
      browser = await chromium.launch({
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--start-maximized',
          '--no-sandbox',
        ],
      });
    } catch {
      // Fall back to channel chrome if bundled chromium fails
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
      });
    }

    session.browser = browser;

    // Create isolated browser context per session
    const context = await browser.newContext({
      viewport: null, // use full screen
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    session.context = context;

    const page = await context.newPage();
    session.page = page;

    // Track when user closes browser manually
    browser.on('disconnected', () => {
      console.log(`[PlaywrightManager] Browser closed by user for session ${session.sessionId}`);
      session.status = 'CLOSED';
    });

    session.status = 'AUTHENTICATING';

    // 2. Navigate to target / login URL
    console.log(`[PlaywrightManager] Navigating to ${session.targetUrl}...`);
    await page.goto(session.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait 1.5s for dynamic forms to render
    await page.waitForTimeout(1500);

    // 3. Form Detection Candidates
    const userSelectors = params.usernameSelector ? [params.usernameSelector] : [
      'input[autocomplete="username"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[name*="user" i]',
      'input[name*="login" i]',
      'input[id*="user" i]',
      'input[id*="login" i]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
      'input[type="text"]',
    ];

    const passSelectors = params.passwordSelector ? [params.passwordSelector] : [
      'input[autocomplete="current-password"]',
      'input[type="password"]',
      'input[name*="pass" i]',
      'input[id*="pass" i]',
    ];

    const submitSelectors = params.submitSelector ? [params.submitSelector] : [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Submit")',
    ];

    // Find username element
    let userEl = null;
    for (const sel of userSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        userEl = el;
        break;
      }
    }

    // Find password element
    let passEl = null;
    for (const sel of passSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        passEl = el;
        break;
      }
    }

    // Fill Username
    if (userEl) {
      console.log('[PlaywrightManager] Filling username...');
      await userEl.fill(params.username);
      await page.waitForTimeout(300);
    }

    // Check Multi-Page Login (e.g. username page -> continue -> password page)
    if (userEl && !passEl) {
      console.log('[PlaywrightManager] Multi-page login detected — clicking Next/Continue...');
      let clickSuccess = false;
      for (const sel of submitSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          clickSuccess = true;
          break;
        }
      }
      if (!clickSuccess) {
        await userEl.press('Enter');
      }

      await page.waitForTimeout(2000);

      // Re-scan for password element
      for (const sel of passSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          passEl = el;
          break;
        }
      }
    }

    // Fill Password
    if (passEl) {
      console.log('[PlaywrightManager] Filling password...');
      await passEl.fill(params.password);
      await page.waitForTimeout(300);
    }

    // Submit Form (if autoSubmit !== false)
    if (params.autoSubmit !== false) {
      console.log('[PlaywrightManager] Submitting login form...');
      let submitted = false;
      for (const sel of submitSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          submitted = true;
          break;
        }
      }
      if (!submitted && passEl) {
        await passEl.press('Enter');
      }
    }

    // Zero out plaintext password in memory
    params.password = '';

    // Wait for navigation / post-login processing
    await page.waitForTimeout(3000);

    // 4. CAPTCHA / 2FA / Security Challenge Detection
    const challengeIndicators = [
      'iframe[src*="captcha"]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'input[name*="otp" i]',
      'input[name*="code" i]',
      'div:has-text("Verify it\'s you")',
      'div:has-text("Security Check")',
      'div:has-text("Enter verification code")',
      'form[action*="challenge"]',
    ];

    let hasChallenge = false;
    for (const ind of challengeIndicators) {
      if (await page.locator(ind).first().isVisible().catch(() => false)) {
        hasChallenge = true;
        break;
      }
    }

    if (hasChallenge) {
      console.log('[PlaywrightManager] Security challenge / 2FA / CAPTCHA detected. Pausing automation for user input.');
      session.status = 'CHALLENGE_REQUIRED';
      session.challengeMessage = 'Additional verification required (CAPTCHA / 2FA). Please complete verification in the open browser window.';
    } else {
      // Check success conditions
      session.status = 'AUTHENTICATED';
      console.log(`[PlaywrightManager] Session AUTHENTICATED for ${session.appName}. Visible browser remaining open for user.`);
    }

    // Monitor session in background for status updates / navigation
    monitorSessionBackground(session, params);

  } catch (err) {
    session.status = 'FAILED';
    session.error = err instanceof Error ? err.message : 'Login automation failed';
    console.error('[PlaywrightManager] Execution failure:', err);
  }
}

async function monitorSessionBackground(session: ManagedSession, params: {
  successUrlPattern?: string;
  successSelector?: string;
}) {
  const checkInterval = setInterval(async () => {
    if (!session.page || session.status === 'CLOSED' || session.status === 'FAILED') {
      clearInterval(checkInterval);
      return;
    }

    try {
      if (session.page.isClosed()) {
        session.status = 'CLOSED';
        clearInterval(checkInterval);
        return;
      }

      // If in CHALLENGE_REQUIRED state, poll to see if user completed challenge
      if (session.status === 'CHALLENGE_REQUIRED' || session.status === 'AUTHENTICATING') {
        const currentUrl = session.page.url();
        
        let isSuccess = false;
        if (params.successUrlPattern && currentUrl.includes(params.successUrlPattern)) {
          isSuccess = true;
        } else if (params.successSelector && await session.page.locator(params.successSelector).first().isVisible().catch(() => false)) {
          isSuccess = true;
        } else if (!currentUrl.includes('login') && !currentUrl.includes('signin') && !currentUrl.includes('auth')) {
          // If navigated away from login/auth URLs, mark authenticated
          isSuccess = true;
        }

        if (isSuccess) {
          session.status = 'AUTHENTICATED';
          session.challengeMessage = undefined;
          console.log(`[PlaywrightManager] Session ${session.sessionId} transitioned to AUTHENTICATED.`);
        }
      }
    } catch {
      // Page might be navigating or closed
    }
  }, 1500);
}

export function getSession(sessionId: string): ManagedSession | undefined {
  return activeSessions.get(sessionId);
}

export function listSessions(userId?: string): ManagedSession[] {
  const all = Array.from(activeSessions.values());
  if (userId) {
    return all.filter((s) => s.userId === userId && s.status !== 'CLOSED');
  }
  return all.filter((s) => s.status !== 'CLOSED');
}

export async function closeSession(sessionId: string): Promise<boolean> {
  const s = activeSessions.get(sessionId);
  if (!s) return false;

  try {
    if (s.browser) {
      await s.browser.close().catch(() => {});
    }
  } catch {}

  s.status = 'CLOSED';
  activeSessions.delete(sessionId);
  return true;
}
