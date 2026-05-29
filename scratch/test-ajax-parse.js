const fs = require('fs');

const json = JSON.parse(fs.readFileSync('scratch/episodes_ajax.json', 'utf8'));
const html = json.result;

const eps = [];
// Regex to match a tags
const regex = /<a[^>]+data-id="([^"]+)"[^>]+data-slug="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
let match;
while ((match = regex.exec(html)) !== null) {
  const dataId = match[1];
  const dataSlug = match[2];
  const text = match[3].trim();
  
  const tag = match[0];
  const numM = /data-num="([^"]*)"/.exec(tag);
  const titleM = /title="([^"]*)"/.exec(tag);
  
  const num = numM ? numM[1] : text;
  const title = titleM ? titleM[1] : `Episode ${num}`;
  
  // Construct identical id format
  const slug = `ep-${dataSlug}`;
  const id = `${slug}:${dataId}`;
  
  eps.push({
    id,
    episodeNumber: parseFloat(num) || 0,
    title
  });
}

console.log('Total parsed episodes:', eps.length);
console.log('First 5 episodes:', eps.slice(0, 5));
