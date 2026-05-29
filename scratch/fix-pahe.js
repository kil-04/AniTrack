const fs = require('fs');
const file = 'C:\\Users\\sanja\\Downloads\\anitrack\\electron\\services\\providers\\animepahe.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /async function _resolveKwikStatic\([\s\S]+?\n\}/;

const replacement = `async function _resolveKwikStatic(kwikUrl: string): Promise<{ url: string; cookies: string }> {
  return new Promise((resolve, reject) => {
    let win: BrowserWindow | null = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    let resolved = false;

    const cleanup = () => {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
      win = null;
    };

    win.webContents.on("did-finish-load", async () => {
      if (!win || resolved) return;
      try {
        const html = await win.webContents.executeJavaScript("document.documentElement.outerHTML");
        
        // Wait for Cloudflare to clear
        if (html.includes("cf-browser-verification") || html.includes("cf_challenge") || html.includes("Just a moment...")) {
          return;
        }

        const packedBlocks = extractAllPackedEvals(html);
        if (packedBlocks.length === 0) {
          throw new Error("No packed script found on Kwik page");
        }
        
        let m3u8Url = "";
        for (const block of packedBlocks) {
          const unpacked = unpackJs(block);
          const sourceMatch = unpacked.match(/source\\s*=\\s*['"](https:\\/\\/[^'"]+\\.m3u8.*?)['"]/);
          if (sourceMatch) {
            m3u8Url = sourceMatch[1];
            break;
          }
        }
        
        if (m3u8Url) {
          const cookiesList = await win.webContents.session.cookies.get({ url: kwikUrl });
          const cookies = cookiesList.map(c => \`\${c.name}=\${c.value}\`).join("; ");
          resolved = true;
          cleanup();
          resolve({ url: m3u8Url, cookies });
        } else {
          resolved = true;
          cleanup();
          reject(new Error("Could not locate m3u8 source in unpacked Kwik JS"));
        }
      } catch (e) {
        // Ignore intermediate errors
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error("Timeout resolving Kwik via BrowserWindow (Cloudflare stuck?)"));
      }
    }, 25000);

    win.loadURL(kwikUrl, { httpReferrer: "https://animepahe.ru/" });
  });
}`;

if (content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
  console.log("Patched successfully!");
} else {
  console.log("Could not find the function to patch!");
}
