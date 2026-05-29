const { app } = require('electron');
const path = require('path');

app.setPath("userData", path.join(app.getPath("appData"), "anitrack"));

app.whenReady().then(async () => {
  try {
    const dbPath = path.resolve(__dirname, '../dist-electron/electron/services/db');
    const anilistPath = path.resolve(__dirname, '../dist-electron/electron/services/anilist');
    
    const { getAnime, getDb, upsertAnime } = require(dbPath);
    const { getById } = require(anilistPath);

    // Mock handler logic
    const handleGet = async (id) => {
      if (id <= 0 || id > 1_000_000_000) {
        return getAnime(id);
      }
      const cached = getAnime(id);
      if (cached?.coverImage) return cached;
      try {
        const anime = await getById(id);
        if (anime) upsertAnime(anime);
        return anime ?? cached ?? null;
      } catch (err) {
        console.error(`Error fetching for ${id}:`, err);
        return cached ?? null;
      }
    };

    const idsToTest = [1535, 21, 16498, 99999999];
    for (const id of idsToTest) {
      console.log(`\nTesting ANILIST_GET for id: ${id}`);
      const res = await handleGet(id);
      console.log(`Result for ${id}:`, res ? { id: res.id, title: res.title, hasCover: !!res.coverImage } : "null");
    }

  } catch (e) {
    console.error("Test error:", e);
  }
  app.quit();
});
