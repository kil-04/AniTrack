const https = require('https');
https.get('https://api.malsync.moe/mal/anime/56726', res => {
  let d = '';
  res.on('data', c => d+=c);
  res.on('end', () => console.log(d));
});
