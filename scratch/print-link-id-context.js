const fs = require('fs');
const js = fs.readFileSync('scratch/main.js', 'utf8');

const idx = js.indexOf('link-id');
console.log('Context of link-id:');
console.log(js.substring(idx - 100, idx + 800));
