const { app } = require("electron");
const { getPaheBaseUrl } = require("./dist-electron/electron/services/providers/animepahe.js");

app.whenReady().then(() => {
  console.log("AnimePahe Base URL from store:", getPaheBaseUrl());
  app.quit();
});
