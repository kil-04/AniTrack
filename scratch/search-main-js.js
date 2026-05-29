const fs = require('fs');
const js = fs.readFileSync('scratch/main.js', 'utf8');

console.log('Searching for calls to qr and Wr in main.js:');

let idx = 0;
while (true) {
  idx = js.indexOf('Wr:', idx);
  if (idx === -1) break;
  console.log(`\nWr: at ${idx}:`, js.substring(idx - 150, idx + 150));
  idx += 3;
}

idx = 0;
while (true) {
  idx = js.indexOf('qr:', idx);
  if (idx === -1) break;
  console.log(`\nqr: at ${idx}:`, js.substring(idx - 150, idx + 150));
  idx += 3;
}
