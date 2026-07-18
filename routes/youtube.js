const express = require('express');
const router = express.Router();

// ── YouTube search (official Data API v3 — search + metadata only) ──────
// This deliberately does NOT extract or proxy audio/video streams. Results
// are meant to be played back through YouTube's own embedded IFrame player
// (see the frontend's youtube page), which keeps this fully within YouTube's
// Terms of Service. There is no download endpoint here on purpose.
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

function youtubeApiKey() {
  return process.env.YOUTUBE_API_KEY || '';
}

// Converts an ISO 8601 duration (e.g. "PT3M42S") into "3:42"
function formatISODuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return '';
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  const totalMin = h * 60 + min;
  return `${totalMin}:${s.toString().padStart(2, '0')}`;
}

// GET /api/youtube/search?query=...&limit=20
router.get('/search', async (req, res) => {
  const { query, limit } = req.query;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const apiKey = youtubeApiKey();
  if (!apiKey) {
    return res.status(503).json({ error: 'YouTube search is not configured (missing YOUTUBE_API_KEY).' });
  }

  const maxResults = Math.min(parseInt(limit, 10) || 20, 25);

  try {
    const searchUrl = `${YOUTUBE_API_BASE}/search?` + new URLSearchParams({
      key: apiKey,
      q: query,
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10', // Music
      maxResults: String(maxResults)
    });
    const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
    const searchData = await searchResp.json();
    if (searchData.error) {
      return res.status(502).json({ error: searchData.error.message || 'YouTube search failed' });
    }

    const items = searchData.items || [];
    const videoIds = items.map(it => it.id.videoId).filter(Boolean);
    if (videoIds.length === 0) return res.json({ status: true, results: [] });

    // Second call to get durations — search.list doesn't include them
    const detailsUrl = `${YOUTUBE_API_BASE}/videos?` + new URLSearchParams({
      key: apiKey,
      id: videoIds.join(','),
      part: 'contentDetails'
    });
    const detailsResp = await fetch(detailsUrl, { signal: AbortSignal.timeout(15000) });
    const detailsData = await detailsResp.json();
    const durationById = {};
    (detailsData.items || []).forEach(d => {
      durationById[d.id] = formatISODuration(d.contentDetails?.duration);
    });

    const results = items.map(it => ({
      videoId: it.id.videoId,
      title: it.snippet.title,
      channel: it.snippet.channelTitle,
      thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
      publishedAt: it.snippet.publishedAt,
      duration: durationById[it.id.videoId] || ''
    }));

    res.json({ status: true, results });
  } catch (e) {
    res.status(502).json({ error: 'YouTube search unavailable. Try again shortly.' });
  }
});

module.exports = router;
