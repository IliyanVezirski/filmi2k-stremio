export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/proxy/')) {
      const targetUrl = url.pathname.slice(6);
      const decodedUrl = decodeURIComponent(targetUrl);
      
      const response = await fetch(decodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });
      
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      
      return new Response(response.body, {
        status: response.status,
        headers
      });
    }
    
    return new Response('Filmi2K Proxy Worker\nUsage: /proxy/{encoded_url}', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
