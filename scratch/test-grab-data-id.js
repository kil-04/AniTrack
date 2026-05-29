const fs = require('fs');
const html = fs.readFileSync('watch_page.html', 'utf8');

const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/);
console.log('watch-main data-id match:', idMatch ? idMatch[1] : 'Not found');
