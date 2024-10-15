const express = require('express');
const router = express.Router();
const urlController = require('../controllers/warmerController');

router.post('/page', urlController.instantProcess);
router.get('/unique_urls', urlController.processUniqueUrls);
router.get('/sitemap', urlController.fetchSitemapUrls);
router.get('/files', urlController.getFiles);
router.delete('/delete-old-files', urlController.deleteOldFiles);
router.get('/sync-sitemap', urlController.syncSitemap);

module.exports = router;
