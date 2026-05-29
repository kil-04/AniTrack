const fs = require('fs');
const js = fs.readFileSync('scratch/main.js', 'utf8');

console.log('Searching for calls to Wr in main.js:');

let idx = 0;
while (true) {
  idx = js.indexOf('.Wr(', idx);
  if (idx === -1) break;
  console.log(`\n.Wr( at ${idx}:`, js.substring(idx - 150, idx + 150));
  idx += 3;
}
