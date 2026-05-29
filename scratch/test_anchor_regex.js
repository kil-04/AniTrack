const fs = require('fs');
const path = require('path');

try {
  const html = fs.readFileSync(path.join(__dirname, 'anikoto_search_output.html'), 'utf8');
  
  const matches = [];
  const anchorRe = /<a class="name d-title" href="[^"]*\/watch\/([^/"]+)[^"]*"[^>]*data-jp="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    matches.push({
      slug: match[1],
      dataJp: match[2].replace(/&#039;/g, "'"),
      text: match[3].trim()
    });
  }
  
  console.log("Anchor matches found:", matches.length);
  console.log(JSON.stringify(matches, null, 2));
} catch (e) {
  console.error(e);
}
