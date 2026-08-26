const { app, net } = require("electron");
const fs = require("fs");

app.whenReady().then(async () => {
    try {
        const streamUrl = "https://vault-16.owocdn.top/stream/16/16/1df919061f09d4a334702b3dd403cd19b1965cff3925f5ae766237dbbe0efe03/uwu.m3u8";
        
        const req = await net.fetch(streamUrl, {
            headers: {
                "Referer": "https://kwik.cx/",
                "Origin": "https://kwik.cx",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9"
            }
        });
        
        console.log("Status:", req.status);
        const text = await req.text();
        console.log("Response text length:", text.length);
        
        fs.writeFileSync("pahe-test-fetch.log", "Status: " + req.status + "\n" + text.slice(0, 500));
    } catch (e) {
        console.error(e);
    }
    app.quit();
});
