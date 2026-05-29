const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');

function extractAllPackedEvals(html) {
    const results = [];
    let searchFrom = 0;
    while (true) {
        const rel = html.slice(searchFrom).search(/eval\(function\(p,a,c,k,e/);
        if (rel === -1) break;
        const absStart = searchFrom + rel;
        let depth = 0, inStr = null, escape = false, found = false;
        for (let i = absStart + 4; i < html.length; i++) {
            const ch = html[i];
            if (escape) { escape = false; continue; }
            if (inStr) { if (ch === "\\") escape = true; else if (ch === inStr) inStr = null; continue; }
            if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
            if (ch === "(") { depth++; continue; }
            if (ch === ")") {
                depth--;
                if (depth === 0) { results.push(html.slice(absStart, i + 1)); searchFrom = i + 1; found = true; break; }
            }
        }
        if (!found) break;
    }
    return results;
}

function unpackJs(packed) {
    try {
        const match = packed.match(/}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
        if (!match) return packed;
        let p = match[1];
        const a = parseInt(match[2], 10);
        const c = parseInt(match[3], 10);
        const kStr = match[4];
        const k = kStr.split("|");
        const e = (c) => (c < a ? "" : e(Math.floor(c / a))) + ((c % a) > 35 ? String.fromCharCode((c % a) + 29) : (c % a).toString(36));
        const replacer = (match2) => {
            const index = e(match2);
            return k[index] || match2;
        };
        return p.replace(/\b\w+\b/g, replacer);
    } catch (err) {
        return packed;
    }
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    try {
        // Step 1: get anime session
        await win.loadURL('https://animepahe.ru/api?m=search&q=City+Hunter');
        let dataStr = await win.webContents.executeJavaScript('document.body.innerText');
        let data = JSON.parse(dataStr);
        let animeSession = data.data[0].session;

        // Step 2: get episode session
        await win.loadURL(`https://animepahe.ru/api?m=release&id=${animeSession}`);
        dataStr = await win.webContents.executeJavaScript('document.body.innerText');
        data = JSON.parse(dataStr);
        let epSession = data.data[0].session;

        // Step 3: play page
        await win.loadURL(`https://animepahe.ru/play/${animeSession}/${epSession}`);
        let html = await win.webContents.executeJavaScript('document.documentElement.innerHTML');
        const kwikM = /data-src="([^"]+kwik[^"]+)"/.exec(html);
        if (!kwikM) {
            console.log("No Kwik URL found.");
            app.exit(1);
        }
        let kwikUrl = kwikM[1];

        // Step 4: fetch kwik
        await win.loadURL(kwikUrl, { httpReferrer: 'https://animepahe.ru/' });
        html = await win.webContents.executeJavaScript('document.documentElement.innerHTML');
        
        const packed = extractAllPackedEvals(html);
        let found = 0;
        for(let block of packed) {
            let unpacked = unpackJs(block);
            console.log("UNPACKED PREVIEW: ", unpacked.substring(0, 150));
            require('fs').writeFileSync('C:\\Users\\sanja\\Downloads\\anitrack\\scratch\\kwik-electron.log', unpacked);
            found++;
        }
        console.log("DONE. Found packed blocks:", found);
    } catch(err) {
        console.error(err);
    }
    app.exit(0);
});
