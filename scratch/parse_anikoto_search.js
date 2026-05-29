const fs = require('fs');
const path = require('path');

try {
  const html = fs.readFileSync(path.join(__dirname, 'anikoto_search_output.html'), 'utf8');
  
  const itemBlockRe = /<div class="item[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let match;
  while ((match = itemBlockRe.exec(html)) !== null) {
    const block = match[1];
    if (block.includes('city-hunter-u0627')) {
      console.log("RAW BLOCK FOR city-hunter-u0627:");
      console.log(block);
    }
  }
} catch (e) {
  console.error(e);
}
