// Cloudflare Worker - Deploy at https://workers.cloudflare.com
// This proxy bypasses Cloudflare by making requests from Cloudflare's network

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      
      // Only handle /proxy/* routes
      if (url.pathname.startsWith('/proxy/')) {
        const targetUrl = url.pathname.slice(7); // Remove /proxy/
        const decodedUrl = decodeURIComponent(targetUrl);
        
        // Make request with browser-like headers
        const response = await fetch(decodedUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
          }
        });
        
        // Copy response headers
        const newHeaders = new Headers();
        response.headers.forEach((value, key) => {
          // Skip encoding headers that might cause issues
          if (key.toLowerCase() !== 'content-encoding') {
            newHeaders.set(key, value);
          }
        });
        
        // Add CORS headers
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }
      
      // Health check endpoint
      if (url.pathname === '/' || url.pathname === '/health') {
        return new Response('Filmi2K Proxy Worker - OK\nUsage: /proxy/{encoded_url}', {
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      
      return new Response('Usage: /proxy/{encoded_url}', {
        headers: { 'Content-Type': 'text/plain' }
      });
    } catch (err) {
      return new Response('Proxy Error: ' + err.message, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};
