import test from "node:test";
import assert from "node:assert/strict";
import {
  TIME_MACHINE_ROW,
  animeEraForYear,
  clampTimeMachineYear,
  curateTimeMachineYear,
  gemPopularityFloor,
  joinTitles,
  mysteryPick,
  timeMachineCandidate,
  timeMachineQuery,
  timeMachineVariables,
  yearInDecade,
} from "../packages/shared/time-machine.ts";

test("maps landmark years to their anime era", () => {
  assert.equal(animeEraForYear(1979).label, "1970s");
  assert.equal(animeEraForYear(1988).headline, "The age of impossible ambition");
  assert.equal(animeEraForYear(1995).label, "1990s");
});

test("clamps time-machine years to the supported archive", () => {
  assert.equal(clampTimeMachineYear(1945, 2026), 1960);
  assert.equal(clampTimeMachineYear(2032, 2026), 2026);
  assert.equal(clampTimeMachineYear(1986, 2026), 1986);
});

test("describes a year's position within its decade", () => {
  assert.equal(yearInDecade(1981), "Early 1980s");
  assert.equal(yearInDecade(1985), "Mid-1980s");
  assert.equal(yearInDecade(1989), "Late 1980s");
});

const anime = (id, title, extra = {}) => ({
  id, title, format: "TV", episodes: 12, popularity: 100_000, averageScore: 75, genres: [], studios: [], synopsis: "", ...extra,
});
const edge = (relationType, id, year) => ({ relationType, node: { id, type: "ANIME", startDate: { year } } });
const pick = (year, item, { month = 4, relations = [], source = "sample" } = {}) =>
  timeMachineCandidate({ anime: item, year, startMonth: month, relations, source });
const titles = (list) => list.map((item) => item.title);

test("reads a title's relations to earlier shows", () => {
  const sequel = pick(2015, anime(1, "HAIKYU!! 2nd Season"), { relations: [edge("PREQUEL", 900, 2014), edge("SEQUEL", 901, 2016)] });
  assert.equal(sequel.prequelBefore, true);
  assert.deepEqual(sequel.franchise, [900, 901]);

  // A same-year prequel doesn't make a sequel, and an undated alternative is an announced remake.
  const onePunch = pick(2015, anime(2, "One-Punch Man"), { relations: [edge("PREQUEL", 902, 2015)] });
  const akira = pick(1988, anime(3, "Akira", { format: "MOVIE" }), { relations: [edge("ALTERNATIVE", 903, null), { relationType: "SOURCE", node: { id: 904, type: "MANGA" } }] });
  assert.equal(onePunch.prequelBefore, false);
  assert.equal(akira.alternativeBefore, false);
  assert.deepEqual(akira.franchise, [903]);

  const recap = pick(2015, anime(4, "Haikyu!! the Movie: The End and the Beginning", { format: "MOVIE", synopsis: "A retelling of the first season of the TV anime Haikyuu!!." }));
  assert.equal(recap.recap, true);
  assert.equal(pick(2017, anime(7, "Code Geass: Lelouch of the Rebellion I", { synopsis: "First of the three part theatrical film remake of Code Geass: Lelouch of the Rebellion." })).recap, true);
  assert.equal(pick(2016, anime(8, "Kuroko no Basket: Winter Cup Soushuuhen")).recap, true);
  assert.equal(pick(2015, anime(5, "Pokémon: The First Movie", { synopsis: "Scientists use the DNA of Mew to create Mewtwo." })).recap, false);
  // Retelling a manga story or a fairy tale, or a note about a "summary" episode, is not a recap.
  assert.equal(pick(1988, anime(9, "Urusei Yatsura Movie 5", { synopsis: "The story comes to a climax in this animated retelling of the final Manga story." })).recap, false);
  assert.equal(pick(1988, anime(10, "Maison Ikkoku: Final Chapter", { synopsis: "Don't take the last episode in account, since that is a summary of what will come." })).recap, false);
  assert.equal(pick(1962, anime(6, "Short"), { month: 0 }).startMonth, null);
});

test("splits a year into new shows, films and sequels, one per franchise", () => {
  const year = curateTimeMachineYear([
    pick(2015, anime(1, "One-Punch Man", { popularity: 774_000, averageScore: 82 }), { month: 10, relations: [edge("PREQUEL", 2, 2015)] }),
    pick(2015, anime(2, "One-Punch Man: Road to Hero", { format: "OVA", episodes: 1, popularity: 93_000 }), { month: 12, relations: [edge("SEQUEL", 1, 2015)] }),
    pick(2015, anime(3, "HAIKYU!! 2nd Season", { popularity: 402_000, averageScore: 86 }), { month: 10, relations: [edge("PREQUEL", 90, 2014)] }),
    pick(2015, anime(4, "Haikyu!! the Movie: The End and the Beginning", { format: "MOVIE", episodes: 1, popularity: 27_000, synopsis: "A retelling of the first season." }), { month: 7, relations: [edge("PARENT", 90, 2014)] }),
    pick(2015, anime(5, "The Boy and the Beast", { format: "MOVIE", episodes: 1, popularity: 112_000, averageScore: 79 }), { month: 7 }),
    pick(2015, anime(6, "Detective Conan: Sunflowers of Inferno", { format: "MOVIE", episodes: 1, popularity: 10_800 }), { month: 4, relations: [edge("PARENT", 91, 1996)] }),
    pick(2015, anime(7, "Kuroko's Basketball 3", { popularity: 164_000 }), { month: 1, relations: [edge("PREQUEL", 92, 2013)] }),
    pick(2015, anime(8, "Kuroko no Basket: Saikou no Present Desu", { format: "SPECIAL", episodes: 1, popularity: 20_000 }), { month: 12, relations: [edge("PARENT", 7, 2015)] }),
    pick(2015, anime(9, "Lyric clip", { format: "MUSIC", popularity: 30_000 })),
    pick(2015, anime(10, "Tiny short", { popularity: 600 })),
  ]);
  assert.deepEqual(titles(year.newShows), ["One-Punch Man"]);
  assert.deepEqual(titles(year.films), ["The Boy and the Beast", "Detective Conan: Sunflowers of Inferno"]);
  assert.deepEqual(titles(year.sequels), ["HAIKYU!! 2nd Season", "Kuroko's Basketball 3"]);
  assert.deepEqual(titles(year.headliners), ["One-Punch Man", "The Boy and the Beast", "Detective Conan: Sunflowers of Inferno"]);
});

test("a same-year Part 2 follows its Part 1, even in a season view without it", () => {
  const candidates = [
    pick(2023, anime(1, "Dr. STONE New World", { popularity: 205_000 }), { month: 4, relations: [edge("PREQUEL", 50, 2022), edge("SEQUEL", 2, 2023)] }),
    pick(2023, anime(2, "Dr. STONE New World Part 2", { popularity: 142_000 }), { month: 10, relations: [edge("PREQUEL", 1, 2023)] }),
    pick(2023, anime(3, "Frieren: Beyond Journey's End", { popularity: 491_000, averageScore: 91 }), { month: 9 }),
  ];
  assert.deepEqual(titles(curateTimeMachineYear(candidates).sequels), ["Dr. STONE New World"]);
  const fall = curateTimeMachineYear(candidates, "FALL");
  assert.deepEqual(titles(fall.newShows), []);
  assert.deepEqual(titles(fall.sequels), ["Dr. STONE New World Part 2"]);
  assert.deepEqual(titles(curateTimeMachineYear(candidates, "SUMMER").newShows), ["Frieren: Beyond Journey's End"]);
});

test("a new show's later season that year is a sequel; an OVA AniList calls its prequel isn't", () => {
  const dated = (relationType, id, year, month) => ({ relationType, node: { id, type: "ANIME", startDate: { year, month } } });
  const candidates = [
    pick(2026, anime(1, "The Ramparts of Ice", { popularity: 85_000 }), { month: 1, relations: [dated("SEQUEL", 2, 2026, 10)] }),
    pick(2026, anime(2, "The Ramparts of Ice Season 2", { popularity: 40_000 }), { month: 10, relations: [dated("PREQUEL", 1, 2026, 1)] }),
    pick(2026, anime(3, "Firefly Wedding", { popularity: 40_000 }), { month: 10 }),
    // AniList lists One-Punch Man's later OVA as its prequel.
    pick(2026, anime(4, "One-Punch Man", { popularity: 774_000 }), { month: 10, relations: [dated("PREQUEL", 5, 2026, 12)] }),
  ];
  const fall = curateTimeMachineYear(candidates, "FALL");
  assert.deepEqual(titles(fall.newShows), ["One-Punch Man", "Firefly Wedding"]);
  assert.deepEqual(titles(fall.sequels), ["The Ramparts of Ice Season 2"]);
  const whole = curateTimeMachineYear(candidates);
  assert.deepEqual(titles(whole.newShows), ["One-Punch Man", "The Ramparts of Ice", "Firefly Wedding"]);
  assert.deepEqual(titles(whole.sequels), []);
});

test("a series-length remake is new, a short alternate take is not", () => {
  const year = curateTimeMachineYear([
    pick(2023, anime(1, "Hellsing Ultimate", { format: "OVA", episodes: 10, popularity: 188_000 }), { relations: [edge("ALTERNATIVE", 80, 2001)] }),
    pick(2023, anime(2, "Steins;Gate 0: 23β", { format: "OVA", episodes: 1, popularity: 84_000 }), { relations: [edge("ALTERNATIVE", 81, 2011)] }),
    pick(2023, anime(3, "Horimiya: The Missing Pieces", { popularity: 167_000 }), { relations: [edge("PARENT", 82, 2021)] }),
  ]);
  assert.deepEqual(titles(year.newShows), ["Hellsing Ultimate"]);
  assert.deepEqual(titles(year.sequels), ["Horimiya: The Missing Pieces", "Steins;Gate 0: 23β"]);
});

test("a franchise that premieres this year shows once, as a new show", () => {
  const year = curateTimeMachineYear([
    pick(1988, anime(1, "Legend of the Galactic Heroes", { format: "OVA", episodes: 110, popularity: 86_000, averageScore: 88 }), { month: 12, relations: [edge("PREQUEL", 2, 1988)] }),
    pick(1988, anime(2, "Legend of the Galactic Heroes: My Conquest Is the Sea of Stars", { format: "MOVIE", episodes: 1, popularity: 16_000 }), { month: 2, relations: [edge("SEQUEL", 1, 1988)] }),
    pick(1988, anime(3, "My Neighbor Totoro", { format: "MOVIE", episodes: 1, popularity: 283_000, averageScore: 81 })),
  ]);
  assert.deepEqual(titles(year.newShows), ["Legend of the Galactic Heroes"]);
  assert.deepEqual(titles(year.films), ["My Neighbor Totoro"]);
});

test("ranks by audience and score together", () => {
  const year = curateTimeMachineYear([
    pick(1988, anime(1, "Hit", { popularity: 200_000, averageScore: 60 })),
    pick(1988, anime(2, "Classic", { popularity: 150_000, averageScore: 85 })),
    pick(1988, anime(3, "Obscure perfect score", { popularity: 900, averageScore: 95 })),
  ]);
  assert.deepEqual(titles(year.newShows), ["Classic", "Hit", "Obscure perfect score"]);
});

test("hidden gems are well-rated new titles beyond the rows, never sequels", () => {
  // The last show rates well but too few follow it to make the row, so it becomes a gem.
  const shows = Array.from({ length: TIME_MACHINE_ROW + 2 }, (_, i) => i === TIME_MACHINE_ROW + 1
    ? pick(2006, anime(i + 1, `Show ${i + 1}`, { popularity: 5_000, averageScore: 84 }))
    : pick(2006, anime(i + 1, `Show ${i + 1}`, { popularity: 500_000 - i * 10_000, averageScore: 65 })));
  const year = curateTimeMachineYear([
    ...shows,
    pick(2006, anime(100, "Quiet masterpiece", { popularity: 9_000, averageScore: 86 }), { source: "gems" }),
    pick(2006, anime(101, "Well-rated OVA of an old show", { format: "OVA", episodes: 2, popularity: 9_000, averageScore: 90 }), { source: "gems", relations: [edge("PARENT", 300, 2001)] }),
    pick(2006, anime(102, "Too obscure", { popularity: 1_000, averageScore: 95 }), { source: "gems" }),
  ]);
  assert.equal(year.newShows.length, TIME_MACHINE_ROW + 2);
  assert.deepEqual(titles(year.gems), ["Quiet masterpiece", `Show ${TIME_MACHINE_ROW + 2}`]);
  assert.equal(year.titleCount, TIME_MACHINE_ROW + 2);
  assert.equal(gemPopularityFloor(500_000), 5_000);
  assert.equal(gemPopularityFloor(10_000), 250);
});

test("sums up the year honestly", () => {
  const year = curateTimeMachineYear([
    pick(1998, anime(1, "Cowboy Bebop", { popularity: 472_000, averageScore: 86, studios: ["Sunrise"], genres: ["Action", "Sci-Fi"] })),
    pick(1998, anime(2, "Serial Experiments Lain", { popularity: 256_000, averageScore: 80, studios: ["Triangle Staff"], genres: ["Sci-Fi", "Psychological"] })),
    pick(1998, anime(3, "Outlaw Star", { popularity: 36_000, averageScore: 75, studios: ["Sunrise"], genres: ["Action", "Sci-Fi"] })),
    pick(1998, anime(4, "Perfect Blue", { format: "MOVIE", episodes: 1, popularity: 248_000, averageScore: 85, studios: ["Madhouse"], genres: ["Psychological"] })),
    pick(1998, anime(5, "Obscure OVA", { format: "OVA", episodes: 3, popularity: 2_000, averageScore: 90, studios: ["Madhouse"] })),
  ]);
  assert.equal(year.stats.biggestDebut?.title, "Cowboy Bebop");
  assert.equal(year.stats.bestRated?.title, "Cowboy Bebop");
  assert.deepEqual(year.stats.busiestStudio, { name: "Sunrise", count: 2 });
  assert.deepEqual(year.stats.topGenres, ["Sci-Fi", "Action", "Psychological"]);
  assert.equal(joinTitles(titles(year.headliners)), "Cowboy Bebop, Serial Experiments Lain and Perfect Blue");
  assert.equal(joinTitles(["Akira"]), "Akira");
  assert.equal(joinTitles(["Akira", "Totoro"]), "Akira and Totoro");
});

test("mystery screening skips titles already in your list", () => {
  const year = curateTimeMachineYear([
    pick(1998, anime(1, "Cowboy Bebop", { popularity: 472_000 })),
    pick(1998, anime(2, "Trigun", { popularity: 172_000 })),
  ]);
  assert.equal(mysteryPick(year, new Set([1]), () => 0)?.title, "Trigun");
  assert.equal(mysteryPick(year, new Set([1, 2]), () => 0.99)?.title, "Trigun");
  assert.equal(mysteryPick(curateTimeMachineYear([]), new Set()), null);
});

test("asks AniList for aired titles of the year, adult ones included", () => {
  const query = timeMachineQuery("id");
  assert.match(query, /status_not: NOT_YET_RELEASED/);
  assert.match(query, /relationType\(version: 2\)/);
  assert.doesNotMatch(query, /isAdult/);
  assert.deepEqual(timeMachineVariables(1998, "popular-2"), { started: "1998%", page: 2, sort: ["POPULARITY_DESC"], formats: ["TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL"], minPopularity: 0 });
  assert.equal(timeMachineVariables(1998, "gems", 4_700).minPopularity, 4_700);
  assert.deepEqual(timeMachineVariables(1998, "films").formats, ["MOVIE"]);
});
