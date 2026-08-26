async function run() {
  const query = `
    query($q: String) {
      Page(perPage: 10) {
        media(search: $q, type: ANIME, sort: [POPULARITY_DESC]) {
          id
          title { romaji english }
          isAdult
          popularity
        }
      }
    }
  `;
  
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { q: "jujutsu" } })
  });
  
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
run();
