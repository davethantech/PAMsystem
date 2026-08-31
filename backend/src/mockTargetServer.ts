/**
 * Local Controlled Test Web Application (Port 9000)
 * Used to execute acceptance test before eBay / live production sites.
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

export async function startMockTargetServer(port = 9000) {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  // 1. Single Page Login Form
  app.get('/', async (req, reply) => {
    const session = req.cookies['test_session'];
    if (session === 'valid') {
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
          <head><title>Test App Dashboard</title></head>
          <body style="font-family:sans-serif; background:#0f172a; color:#fff; padding:40px;">
            <h1 id="welcome-header">Welcome to Authenticated Enterprise Portal</h1>
            <p id="auth-status">Status: AUTHENTICATED</p>
            <div id="dashboard-content" style="padding:20px; background:#1e293b; border-radius:8px;">
              <p>Secure Enterprise Session Active</p>
            </div>
          </body>
        </html>
      `);
    }

    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head><title>Test App Login</title></head>
        <body style="font-family:sans-serif; background:#0f172a; color:#fff; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
          <form action="/login" method="POST" id="login-form" style="background:#1e293b; padding:30px; border-radius:12px; width:320px;">
            <h2>Test Application Login</h2>
            <div style="margin-bottom:15px;">
              <label style="display:block; margin-bottom:5px;">Username or Email</label>
              <input type="text" id="username" name="username" autocomplete="username" placeholder="user@company.com" style="width:100%; padding:8px; box-sizing:border-box; border-radius:4px; border:1px solid #475569; background:#0f172a; color:#fff;" required />
            </div>
            <div style="margin-bottom:20px;">
              <label style="display:block; margin-bottom:5px;">Password</label>
              <input type="password" id="password" name="password" autocomplete="current-password" placeholder="••••••••" style="width:100%; padding:8px; box-sizing:border-box; border-radius:4px; border:1px solid #475569; background:#0f172a; color:#fff;" required />
            </div>
            <button type="submit" id="submit-btn" style="width:100%; padding:10px; background:#0d9488; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Sign In</button>
          </form>
        </body>
      </html>
    `);
  });

  // Handle Form Post
  app.post('/login', async (req, reply) => {
    reply.setCookie('test_session', 'valid', { path: '/' });
    return reply.redirect('/');
  });

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`[MockTarget] Local test web application listening at http://localhost:${port}`);
  } catch (err) {
    // Already running or port in use
  }
}
