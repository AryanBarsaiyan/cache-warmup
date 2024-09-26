const express = require('express');
const { processUrlsSequentially } = require('../utils');
const { fetchAllSitemaps } = require('../sitemapFetcher');
const { sendLogToSlack, deleteOldFiles } = require('../helpers');
const fs = require('fs');
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
        res.status(200).json({ message: 'URLs are being processed' });
        await processUrlsSequentially(urls, logData);
    } catch (error) {
        console.error(`Error processing the URLs: ${error.message}`);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.post('/global', async (req, res) => {
    try {
        const logData = [];
        const mainSitemapUrl = process.env.MAIN_SITEMAP_URL;
        await fetchAllSitemaps(mainSitemapUrl);
        let sitemap_urls = require('../sitemap_urls.json');
        const urls = sitemap_urls.url;
        console.log("Got total urls from the sitemap: ", urls.length);
        res.status(200).json({ message: `We've successfully retrieved ${urls.length} URLs from the sitemap. Processing is underway and is expected to take approximately 4 hours.` });
        await processUrlsSequentially(urls, logData);
        // Send the log data to Slack
        await sendLogToSlack(logData, true);
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

module.exports = router;
