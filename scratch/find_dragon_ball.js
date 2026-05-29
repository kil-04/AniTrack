const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

async function searchPage(query, page = 1) {
  const url = `https://anikoto.cz/filter?keyword=${encodeURIComponent(query)}&page=${page}`;
  console.log("Fetching url:", url);
  const html = await get(url);
  const blocks = html.split(/<div class="item\s*/);
  const items = [];
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const hrefM = /href="[^"]*\/watch\/([^/"]+)/.exec(block);
    const href = hrefM ? hrefM[1] : null;
    if (!href) continue;
    
    const imgM = /<img src="([^"]+)" alt="([^"]+)"/.exec(block);
    const imgAlt = imgM ? imgM[2] : null;
    const jpM = /data-jp="([^"]+)"/.exec(block);
    const dataJp = jpM ? jpM[1].replace(/&#039;/g, "'") : null;
    
    const totalM = /class="ep-status total"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
    const totalEps = totalM ? parseInt(totalM[1], 10) : undefined;

    items.push({ title: dataJp || imgAlt, id: href, episodes: totalEps });
  }
  return items;
}

async function main() {
  const query = "Dragon Ball";
  for (let page = 1; page <= 4; page++) {
    const results = await searchPage(query, page);
    console.log(`PAGE ${page} RESULTS (${results.length}):`);
    results.forEach(r => {
      console.log(`  Title: "${r.title}" | ID: "${r.id}" | Eps: ${r.episodes}`);
    });
    if (results.length === 0) break;
  }
}

main();
