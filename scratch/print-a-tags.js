const fs = require('fs');
const json = JSON.parse(fs.readFileSync('scratch/episodes_ajax.json', 'utf8'));
const html = json.result;

// print some snippet containing <a
const idx = html.indexOf('<a ');
if (idx !== -1) {
  console.log('Snippet of a tag:', html.substring(idx, idx + 400));
}

// Find all a tags
const tags = html.match(/<a[^>]+>/g) || [];
console.log('Total a tags:', tags.length);
console.log('First 10 a tags:', tags.slice(0, 10));
