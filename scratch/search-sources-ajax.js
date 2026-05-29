const fs = require('fs');
const js = fs.readFileSync('scratch/main.js', 'utf8');

console.log('Searching for source endpoint / iframe loading in main.js:');

// Let's find occurrences of "ajax/" in main.js
const ajaxMatches = js.match(/\/ajax\/[a-zA-Z0-9_/.-]+/g) || [];
console.log('All AJAX matches in main.js:', [...new Set(ajaxMatches)]);

// Let's search for "link-id" or "data-link-id"
let idx = 0;
while (true) {
  idx = js.indexOf('link-id', idx);
  if (idx === -1) break;
  console.log(`\nlink-id at ${idx}:`, js.substring(idx - 150, idx + 150));
  idx += 7;
}
