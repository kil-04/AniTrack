const { app, net } = require("electron");
const fs = require("fs");

app.whenReady().then(async () => {
    try {
        const r = await fetch("https://kwik.cx/e/Cu0P6AkMMdVA", { headers: { Referer: "https://animepahe.ru/" } });
        const text = await r.text();
        const cookies = r.headers.get("set-cookie") || "";
        const match = text.match(/eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\)\)\)/);
        
        let streamUrl = "";
        
        if (match) {
             const evalFunc = match[0];
             const unpacked = eval(evalFunc.replace("eval(", "String("));
             const m = unpacked.match(/source=['"](https:\/\/[^'"]+\.m3u8)['"]/);
             if (m) streamUrl = m[1];
        }
        
        if (!streamUrl) {
            console.log("Failed to extract URL dynamically. Exiting.");
            app.quit();
            return;
        }
        
        console.log("Dynamically extracted Fast URL:", streamUrl);
        
        // Wait 1 second just in case to let backend register
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const req = await net.fetch(streamUrl, {
            headers: {
                "Referer": "https://kwik.cx/",
                "Origin": "https://kwik.cx",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Cookie": cookies
            }
        });
        
        console.log("Status:", req.status);
        const resText = await req.text();
        console.log("Response length:", resText.length);
        
        fs.writeFileSync("pahe-test-dynamic.log", "Status: " + req.status + "\n" + resText.slice(0, 500));
        app.quit();
    } catch (e) {
        console.error(e);
        app.quit();
    }
});
