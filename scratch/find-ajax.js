const fs = require('fs');
const html = fs.readFileSync('watch_page.html', 'utf8');

console.log('Searching for AJAX/endpoints in watch_page.html:');

// Regex for URLs/endpoints
const ajaxMatches = html.match(/\/ajax\/[a-zA-Z0-9_/.-]+/g);
console.log('Ajax matches:', ajaxMatches ? [...new Set(ajaxMatches)] : 'None');

const apiMatches = html.match(/\/api\/[a-zA-Z0-9_/.-]+/g);
console.log('Api matches:', apiMatches ? [...new Set(apiMatches)] : 'None');

const epListMatches = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/);
console.log('watch-main data-id:', epListMatches ? epListMatches[1] : 'None');

const scriptSrcs = html.match(/src="[^"]+\.js[^"]*"/g);
console.log('Scripts:', scriptSrcs ? [...new Set(scriptSrcs)] : 'None');
