const fs = require('fs');

const json = JSON.parse(fs.readFileSync('scratch/episodes_ajax.json', 'utf8'));
const html = json.result;

const itemRe = /<a[^>]*data-id="([^"]+)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
let match;
const eps = [];
while ((match = itemRe.exec(html)) !== null) {
  // extract data-num and title/text
  const tag = match[0];
  const dataId = match[1];
  const href = match[2];
  const text = match[3].trim();
  
  const numM = /data-num="([^"]*)"/.exec(tag);
  const titleM = /title="([^"]*)"/.exec(tag);
  
  eps.push({
    dataId,
    href,
    text,
    num: numM ? numM[1] : text,
    title: titleM ? titleM[1] : ''
  });
}

console.log('Total episodes found:', eps.length);
console.log('First 5 episodes:', eps.slice(0, 5));
