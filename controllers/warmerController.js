const { processUrls } = require('../utils');
const { fetchAllSitemaps } = require('../sitemapFetcher');
const { sendLogToSlack, deleteOldFiles } = require('../helpers');
const fs = require('fs').promises; // Use the promises API
const path = require('path');

// Process URLs from the request
exports.instantProcess = async (req, res) => {
    try {
        const { urls } = req.body;
        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ message: 'An array of URLs is required' });
        }

        // Send the response before processing the URLs
        res.status(200).json({ message: `URLs are being processed. Total URLs: ${urls.length}` });
        await processUrls(urls);
    } catch (error) {
        console.error(`Error processing the URLs: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Get unique URLs and process them
exports.processUniqueUrls = async (req, res) => {
    try {
        const uniqueUrlsData = require('../unique_urls.json');
        const urls = uniqueUrlsData.unique_urls;

        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ message: 'No unique URLs found' });
        }

        res.status(200).json({ message: `Unique URLs are being processed. Total URLs: ${urls.length}` });
        await processUrls(urls);
    } catch (error) {
        console.error(`Error processing the unique URLs: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Fetch sitemap URLs
exports.fetchSitemapUrls = async (req, res) => {
    try {
        const mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        await fetchAllSitemaps(mainSitemapUrl);
        res.status(200).json({ message: 'Sitemap URLs are fetched successfully' });
    } catch (error) {
        console.error(`Error fetching the sitemap: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Retrieve and send files from the reports directory
exports.getFiles = async (req, res) => {
    const directoryPath = path.join(__dirname, '../public/reports');

    try {
        const files = await fs.readdir(directoryPath);

        const fileData = await Promise.all(files.map(async (file) => {
            const filePath = path.join(directoryPath, file);
            const stats = await fs.stat(filePath);
            const creationDate = stats.mtime.toISOString();

            return {
                filename: file,
                url: `${process.env.WEB_URL}:${process.env.PORT}/public/reports/${file}`,
                creationDate
            };
        }));

        res.json(fileData);
    } catch (error) {
        console.error('Error reading files:', error);
        res.status(500).json({ message: 'Unable to read files' });
    }
};

// Delete old files in the reports directory
exports.deleteOldFiles = (req, res) => {
    const directoryPath = path.join(__dirname, '../public/reports');

    try {
        const deletedFiles = deleteOldFiles(directoryPath);
        res.json({
            message: 'Deleted files older than one month',
            deletedFiles: deletedFiles
        });
    } catch (error) {
        console.error('Error deleting old files:', error);
        res.status(500).json({ message: 'Unable to delete old files' });
    }
};

// Sync and compare sitemap URLs
exports.syncSitemap = async (req, res) => {
    try {
        const currentSitemapPath = path.join(__dirname, '../sitemap_urls.json');
        const currentSitemapData = await fs.readFile(currentSitemapPath, 'utf8');
        const currentSitemap = JSON.parse(currentSitemapData);
        const currentUrls = currentSitemap.url;

        const mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        await fetchAllSitemaps(mainSitemapUrl);

        const newSitemapData = await fs.readFile(currentSitemapPath, 'utf8');
        const newSitemap = JSON.parse(newSitemapData);
        const newUrls = newSitemap.url;

        const differenceArray = newUrls.filter(url => !currentUrls.includes(url));

        if (differenceArray.length === 0) {
            return res.status(200).json({ message: 'No new URLs found in the sitemap' });
        }

        res.status(200).json({ message: `New URLs added to the sitemap: ${differenceArray.length}, we are processing them now` });
        const logData = [];
        await processUrls(differenceArray, 2);
        await sendLogToSlack(logData);

    } catch (error) {
        console.error(`Error syncing the sitemap: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Process global URLs (added logic)
exports.processGlobalUrls = async (req, res) => {
    try {
        console.log('Processing the global URLs');
        
        // Use the main sitemap URL or one provided in the request
        let mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        if (req.body.sitemapUrl) {
            mainSitemapUrl = req.body.sitemapUrl;
        }

        const uniqueUrlsData = require('../unique_urls.json');
        let uniqueUrls = uniqueUrlsData.unique_urls;

        console.log(`Processing the global URLs from the sitemap: ${mainSitemapUrl}`);

        // Fetch all the sitemaps from the given URL
        await fetchAllSitemaps(mainSitemapUrl);
        const sitemapUrls = require('../sitemap_urls.json');
        let urls = sitemapUrls.url;

        // Combine URLs and remove duplicates
        urls = urls.concat(uniqueUrls);
        urls = [...new Set(urls)];

        res.status(200).json({ message: `We've successfully retrieved ${urls.length} URLs from the sitemap ${mainSitemapUrl}. Processing is underway and is expected to take approximately 8 hours.` });

        // Process the URLs sequentially
        await processUrls(urls, 1);

    } catch (error) {
        console.error(`Error processing the global URLs: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
