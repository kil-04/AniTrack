const { app, BrowserWindow } = require("electron");
const { resolveKwikFast } = require("./dist-electron/electron/services/animepahe.js");
const fs = require("fs");

app.whenReady().then(async () => {
    try {
        const streamUrl = "https://vault-16.owocdn.top/stream/16/16/1df919061f09d4a334702b3dd403cd19b1965cff3925f5ae766237dbbe0efe03/uwu.m3u8";
        console.log("Fast URL:", streamUrl);
        
        const win = new BrowserWindow({ show: false });
        
        win.webContents.session.webRequest.onResponseStarted({ urls: ["*://*.owocdn.top/*", "*://*.uwucdn.top/*"] }, async (details) => {
            console.log("Got response:", details.statusCode, details.url);
            if ((details.statusCode === 200 || details.statusCode === 206) && details.url.includes(".m3u8")) {
                const cookies = await win.webContents.session.cookies.get({});
                const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
                console.log("SUCCESS! Cookies length:", cookieStr.length);
                if (cookieStr.includes("cf_clearance")) {
                    console.log("Found cf_clearance!");
                }
                fs.writeFileSync("pahe-test-cf.log", "SUCCESS\n" + cookieStr);
                app.quit();
            }
        });
        
        win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
            details.requestHeaders['User-Agent'] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
            details.requestHeaders["Referer"] = "https://kwik.cx/";
            callback({ requestHeaders: details.requestHeaders });
        });
        
        win.loadURL(streamUrl, { httpReferrer: "https://kwik.cx/" });
        
        setTimeout(() => {
            console.log("Timeout! Exiting.");
            fs.writeFileSync("pahe-test-cf.log", "TIMEOUT");
            app.quit();
        }, 15000);
    } catch (e) {
        console.error(e);
        app.quit();
    }
});
