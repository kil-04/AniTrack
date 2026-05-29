const fs = require('fs');
const file = 'C:\\Users\\sanja\\Downloads\\anitrack\\electron\\services\\providers\\animepahe.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /async function _resolveKwikStatic\([\s\S]+?\n\}/;

const replacement = `async function _resolveKwikStatic(kwikUrl: string): Promise<string> {
  const req = await net.fetch(kwikUrl, {
    headers: {
      "Referer": "https://animepahe.ru/",
      "User-Agent": KWIK_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5"
    }
  });
  
  if (!req.ok) {
    throw new Error(\`Kwik returned \${req.status}\`);
  }
  
  const html = await req.text();
  const cookies = (req.headers.get("set-cookie") || "").split(",").map(c => c.split(";")[0]).join("; ");
  
  const packedBlocks = extractAllPackedEvals(html);
  if (packedBlocks.length === 0) throw new Error("No packed script found on Kwik page");
  
  let m3u8Url = "";
  let lastUnpacked = "";
  
  for (const block of packedBlocks) {
    const unpacked = unpackJs(block);
    lastUnpacked = unpacked;
    const sourceMatch = unpacked.match(/source\\s*=\\s*['"](https:\\/\\/[^'"]+\\.m3u8.*?)['"]/);
    if (sourceMatch) {
      m3u8Url = sourceMatch[1];
      break;
    }
  }
  
  if (!m3u8Url) {
    console.log("KWIK UNPACKED JS:", lastUnpacked);
    throw new Error("Could not locate m3u8 source in unpacked Kwik JS");
  }
  
  return m3u8Url;
}`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
  console.log("Patched successfully!");
} else {
  console.log("Could not find the function to patch!");
}
