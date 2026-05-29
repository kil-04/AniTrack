async function test() {
  const query = `
    query($page: Int, $perPage: Int, $year: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total hasNextPage }
        media(seasonYear: $year, type: ANIME, sort: TRENDING_DESC) {
          id
          title { romaji }
          seasonYear
        }
      }
    }
  `;
  const variables = { page: 5, perPage: 36, year: 1986 };

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json();
  console.log("pageInfo:", json.data.Page.pageInfo);
  console.log("media count:", json.data.Page.media.length);
}

test();
