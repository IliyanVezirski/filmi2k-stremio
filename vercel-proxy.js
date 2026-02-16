const express = require('express');
const axios = require('axios');

const app = express();

app.use(express.json());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const response = await axios.get(decodeURIComponent(url), {
      headers: HEADERS,
      timeout: 30000,
    });
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    res.send(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.message,
      status: error.response?.status 
    });
  }
});

app.get('/', (req, res) => {
  res.send('Filmi2K Proxy - Usage: /proxy?url={encoded_url}');
});

module.exports = app;
