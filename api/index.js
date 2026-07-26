// Vercel serverless entry point.
//
// Vercel runs the site as static files from dist/ and routes every /api/*
// request here. server.js exports its request handler so the same code powers
// both `npm start` (one long-running process) and this function.
//
// Static file serving is disabled: Vercel's CDN already serves dist/.
process.env.SERVE_STATIC = 'false';

const { handler } = await import('../server.js');
export default handler;
