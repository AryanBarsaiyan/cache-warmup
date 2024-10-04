const express = require('express');
const { processUrlsSequentially } = require('../utils');
const { fetchAllSitemaps } = require('../sitemapFetcher');
const { sendLogToSlack, deleteOldFiles } = require('../helpers');
const fs = require('fs').promises; // Use the promises API
const path = require('path');
const router = express.Router();

router.post('/page', async (req, res) => {
    try {
        const { urls } = req.body;
        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ message: 'An array of URLs is required' });
        }

        // Log data storage
        const logData = [];
        //wants to process the urls after request is completed
        res.status(200).json({ message: `URLs are being processed. Total URLs: ${urls.length}` });
        await processUrlsSequentially(urls, logData);
    } catch (error) {
        console.error(`Error processing the URLs: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.post('/global', async (req, res) => {
    try {
        console.log('Processing the global URLs');
        const logData = [];
        let mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        //check if we are getting the sitemap urls from the request
        if(req.body.sitemapUrl) {
            mainSitemapUrl = req.body.sitemapUrl;
        }

        console.log(`Processing the global URLs from the sitemap: ${mainSitemapUrl}`);

        await fetchAllSitemaps(mainSitemapUrl);
        let sitemap_urls = require('../sitemap_urls.json');
        let urls = sitemap_urls.url;
        res.status(200).json({ message: `We've successfully retrieved ${urls.length} URLs from the sitemap ${mainSitemapUrl}. Processing is underway and is expected to take approximately 8 hours.` });
        await processUrlsSequentially(urls, logData, 1);
        await sendLogToSlack(logData);
    } catch (error) {
        console.error(`Error processing the global URLs: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.get('/sitemap', async (req, res) => {
    try {
        const mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        await fetchAllSitemaps(mainSitemapUrl);
        res.status(200).json({ message: 'Sitemap URLs are fetched successfully' });
    } catch (error) {
        console.error(`Error processing the sitemap: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.get('/files', (req, res) => {
    const directoryPath = path.join(__dirname, '../public/reports');

    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            return res.status(500).json({ message: 'Unable to read files' });
        }

        const fileData = files.map(file => {
            const filePath = path.join(directoryPath, file);
            const stats = fs.statSync(filePath);
            const creationDate = stats.mtime.toISOString(); // Get the file's modification time

            return {
                filename: file,
                url: `${process.env.WEB_URL}:${process.env.PORT}/public/reports/${file}`,
                creationDate
            };
        });

        res.json(fileData);
    });
});

router.delete('/delete-old-files', (req, res) => {
    const directoryPath = path.join(__dirname, '../public/reports');

    // Call the function to delete old files
    const deletedFiles = deleteOldFiles(directoryPath);

    // Respond to the client with the list of deleted files
    res.json({
        message: 'Deleted files older than one month',
        deletedFiles: deletedFiles
    });
});


router.get('/sync-sitemap', async (req, res) => {
    try {
        // Path to the sitemap JSON file
        const current_sitemap_path = path.join(__dirname, '../sitemap_urls.json');

        // Read the current sitemap file (before updating) using fs.promises.readFile
        const current_sitemap_data = await fs.readFile(current_sitemap_path, 'utf8');
        const current_sitemap = JSON.parse(current_sitemap_data);
        const current_urls = current_sitemap.url;

        // Fetch and update the sitemap from the web
        const mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        await fetchAllSitemaps(mainSitemapUrl);

        // After updating, read the new sitemap file again
        const new_sitemap_data = await fs.readFile(current_sitemap_path, 'utf8');
        const new_sitemap = JSON.parse(new_sitemap_data);
        const new_urls = new_sitemap.url;

        // Compare the URLs to find the differences
        const difference_array = new_urls.filter(x => !current_urls.includes(x));
        if(difference_array.length === 0) {
            return res.status(200).json({ message: 'No new URLs found in the sitemap' });
        }
        res.status(200).json({ message: `New URLs added to the sitemap: ${difference_array.length}, we are processing them now` });

        // Process the new URLs
        const logData = [];
        await processUrlsSequentially(difference_array, logData, 2);

        // Send the log data to Slack
        await sendLogToSlack(logData);

    } catch (error) {
        console.error(`Error processing the sitemap: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

module.exports = router;
