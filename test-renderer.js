const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
    try {
        const streamUrl = "https://vault-16.owocdn.top/stream/16/16/1df919061f09d4a334702b3dd403cd19b1965cff3925f5ae766237dbbe0efe03/uwu.m3u8";
        
        const win = new BrowserWindow({ show: true, webPreferences: { nodeIntegration: true, contextIsolation: false } });
        
        // Inject Referer and Origin like main.ts does
        win.webContents.session.webRequest.onBeforeSendHeaders(
            { urls: ["*://*.owocdn.top/*"] },
            (details, callback) => {
                const headers = { ...details.requestHeaders };
                headers["Referer"] = "https://kwik.cx/";
                headers["Origin"] = "https://kwik.cx";
                // Add the kwik_session cookie!
                headers["Cookie"] = "kwik_session=eyJpdiI6IjlhSlUzbVBkeW4xTVovc2JJTTJMSEE9PSIsInZhbHVlIjoiVnhndDl6Q2lJdzdtcXlSdTNBcXExbm1PNStjbFBnTGpoZXAxWWk4NVBCbXptaGR0UWxwYmQwbHJWWmNhbjExNHhGRHhQcnRmRno1NVFLQStNSGl5QVlmZThyZVdralZGTFN1ZmIxOWVaZWR6d1R1cWx4NXE2a09PVW1LbHB3SzMiLCJtYWMiOiI4NTUzNDQzMDIwZjViNzFkZTllMGE4NTk2ZDNhZGJlNTQxMTc4YTViYWZiN2ZjYWYxYWNjYjI1MjJhNDJmMjcyIiwidGFnIjoiIn0%3D; srv=s0";
                callback({ requestHeaders: headers });
            }
        );
        win.webContents.session.webRequest.onHeadersReceived(
            { urls: ["*://*.owocdn.top/*"] },
            (details, callback) => {
                const headers = { ...details.responseHeaders };
                headers["Access-Control-Allow-Origin"] = ["*"];
                callback({ responseHeaders: headers });
            }
        );
        
        const code = `
            fetch("${streamUrl}")
                .then(r => r.text().then(t => ({ status: r.status, text: t })))
                .then(res => {
                    const fs = require('fs');
                    fs.writeFileSync("pahe-test-renderer.log", "Status: " + res.status + "\\n" + res.text.slice(0, 500));
                    window.close();
                })
                .catch(e => {
                    const fs = require('fs');
                    fs.writeFileSync("pahe-test-renderer.log", "Error: " + e.message);
                    window.close();
                });
        `;
        
        win.loadURL("data:text/html,<html><body><script>" + code + "</script></body></html>");
        
        win.on("closed", () => app.quit());
    } catch (e) {
        console.error(e);
        app.quit();
    }
});
