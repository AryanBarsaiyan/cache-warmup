// sitemapFetcher.js
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');

// Function to fetch URLs from a given sitemap URL
async function fetchUrlsFromSitemap(sitemapUrl) {
  try {
    const response = await axios.get(sitemapUrl);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    const urls = [];
    if (result.urlset && result.urlset.url) {
      // Extract URLs from the <url> tag in the sitemap
      result.urlset.url.forEach((urlEntry) => {
        if (urlEntry.loc && urlEntry.loc[0]) {
          urls.push(urlEntry.loc[0]);
        }
      });
    }
    return urls;
  } catch (error) {
    console.error(`Failed to fetch the sitemap: ${sitemapUrl}. Error: ${error.message}`);
    return [];
  }
}

// Function to fetch the main sitemap and save URLs to a JSON file
async function fetchAllSitemaps(mainSitemapUrl) {
  try {
    const response = await axios.get(mainSitemapUrl);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    let allUrls = [];

    // Check if the sitemap contains other sitemaps
    if (result.sitemapindex && result.sitemapindex.sitemap) {
      for (const sitemap of result.sitemapindex.sitemap) {
        const loc = sitemap.loc[0];
        const urls = await fetchUrlsFromSitemap(loc);
        allUrls = allUrls.concat(urls);
      }

      // Save URLs to a JSON file
      const output = { url: allUrls };
      fs.writeFileSync('sitemap_urls.json', JSON.stringify(output, null, 4));
      console.log('All URLs extracted and saved to sitemap_urls.json');
    } else {
      console.log('No <sitemap> entries found.');
    }
  } catch (error) {
    console.error(`Failed to fetch the main sitemap. Error: ${error.message}`);
  }
}

module.exports = { fetchAllSitemaps };
