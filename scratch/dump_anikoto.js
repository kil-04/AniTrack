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

async function main() {
  try {
    const html = await get("https://anikoto.cz/filter?keyword=Dragon+Ball");
    const blocks = html.split(/<div class="item\s*/);
    console.log("Found", blocks.length - 1, "results for 'Dragon Ball'");
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

      console.log(`Title: "${dataJp || imgAlt}" | ID: "${href}" | Eps: ${totalEps}`);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
