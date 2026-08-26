const { app } = require("electron");
const fs = require("fs");
const { search, getEpisodes, getStreamLinks, resolveKwik, prewarm } = require("./dist-electron/electron/services/animepahe.js");

const log = (msg) => {
    fs.appendFileSync("pahe-test.log", msg + "\n");
};

app.whenReady().then(async () => {
    try {
      if (fs.existsSync("pahe-test.log")) fs.unlinkSync("pahe-test.log");
      log("==> Testing paheSearch...");
      prewarm();
      const searchRes = await search("Campfire Cooking in Another World with my Absurd Skill Season 2");
      log("==> Search result: " + JSON.stringify(searchRes.slice(0, 1)));
      if (searchRes.length > 0) {
        log("==> Testing getEpisodes for: " + searchRes[0].title + " " + searchRes[0].session);
        const eps = await getEpisodes(searchRes[0].session, 1);
        log("==> Episodes result length: " + (eps.data?.length || 0));
        const ep5 = eps.data.find(e => e.episode === 5) || eps.data[0];
        if (ep5) {
           log("==> Testing getStreamLinks for episode " + ep5.episode + "...");
           const links = await getStreamLinks(ep5.session, searchRes[0].session);
           log("==> Links result: " + JSON.stringify(links));
           if (links.length > 0) {
               log("==> Testing resolveKwik...");
               const urlObj = await resolveKwik(links[0].kwik);
               log("==> Stream URL: " + JSON.stringify(urlObj));
               
               const net = require("electron").net;
               const m3u8Req = await net.fetch(urlObj.url, {
                 headers: {
                   "Cookie": urlObj.cookies,
                   "Referer": "https://kwik.cx/"
                 }
               });
               const m3u8Text = await m3u8Req.text();
               log("==> M3U8 Contents:\n" + m3u8Text.split("\n").slice(0, 15).join("\n"));
           }
        }
      }
    } catch (e) {
      log("==> Test failed: " + e.message);
    }
    app.quit();
});
