const fs = require('fs');
const path = require('path');

try {
  const html = fs.readFileSync(path.join(__dirname, 'anikoto_search_output.html'), 'utf8');
  
  const blocks = html.split(/<div class="item\s*/);
  console.log("Total blocks split:", blocks.length);
  
  const items = [];
  // Skip the first block because it's the header HTML before the first item card
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    
    // Extract watch slug
    const hrefM = /href="[^"]*\/watch\/([^/"]+)/.exec(block);
    const href = hrefM ? hrefM[1] : null;
    if (!href) continue;
    
    // Extract image poster and alt title
    const imgM = /<img src="([^"]+)" alt="([^"]+)"/.exec(block);
    const imgSrc = imgM ? imgM[1] : null;
    const imgAlt = imgM ? imgM[2] : null;
    
    // Extract data-jp romaji title (optional)
    const jpM = /data-jp="([^"]+)"/.exec(block);
    const dataJp = jpM ? jpM[1].replace(/&#039;/g, "'") : null;
    
    items.push({
      id: href,
      poster: imgSrc,
      title: imgAlt,
      titleJp: dataJp
    });
  }
  
  console.log("Parsed items count:", items.length);
  console.log("Items matching City Hunter:", items.filter(x => x.id.includes('city-hunter')));
} catch (e) {
  console.error(e);
}
