const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');
const { validateImageUrl } = require('../utils/validateImage');

// ── Helpers ─────────────────────────────────────────────────────────────
function slugify(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'post';
}

async function uniqueSlug(table, base) {
  let slug = slugify(base);
  let attempt = slug;
  let n = 1;
  while (true) {
    const existing = await db.execute({ sql: `SELECT id FROM ${table} WHERE slug = ?`, args: [attempt] });
    if (existing.rows.length === 0) return attempt;
    n += 1;
    attempt = `${slug}-${n}`;
  }
}

function readingTimeFromContent(content) {
  const words = (content || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

const POST_SUMMARY_FIELDS = `
  p.id, p.title, p.slug, p.excerpt, p.cover_image, p.status, p.featured,
  p.view_count, p.reading_time, p.created_at, p.updated_at, p.published_at,
  u.id as author_id, u.username as author_username, u.avatar as author_avatar,
  c.id as category_id, c.name as category_name, c.slug as category_slug, c.color as category_color,
  (SELECT COUNT(*) FROM blog_likes WHERE post_id = p.id) as like_count,
  (SELECT COUNT(*) FROM blog_comments WHERE post_id = p.id) as comment_count
`;

async function attachTags(posts) {
  if (!posts.length) return posts;
  const ids = posts.map(p => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = await db.execute({
    sql: `SELECT pt.post_id, t.name, t.slug FROM blog_post_tags pt
          JOIN blog_tags t ON pt.tag_id = t.id
          WHERE pt.post_id IN (${placeholders})`,
    args: ids
  });
  const byPost = {};
  tagRows.rows.forEach(r => {
    (byPost[r.post_id] = byPost[r.post_id] || []).push({ name: r.name, slug: r.slug });
  });
  return posts.map(p => ({ ...p, tags: byPost[p.id] || [] }));
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/posts — paginated list. Public (optionalAuth for like/bookmark state).
// Query: page, limit, category (slug), tag (slug), q (search), sort (latest|popular)
// ─────────────────────────────────────────────────────────────────────────
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(30, parseInt(req.query.limit) || 12);
    const offset = (page - 1) * limit;
    const { category, tag, q, sort } = req.query;

    const conditions = [`p.status = 'published'`];
    const args = [];

    if (category) {
      conditions.push('c.slug = ?');
      args.push(category);
    }
    if (q) {
      conditions.push('(p.title LIKE ? OR p.excerpt LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    let tagJoin = '';
    if (tag) {
      tagJoin = `JOIN blog_post_tags pt2 ON pt2.post_id = p.id JOIN blog_tags t2 ON t2.id = pt2.tag_id`;
      conditions.push('t2.slug = ?');
      args.push(tag);
    }

    const orderBy = sort === 'popular' ? 'p.view_count DESC' : 'p.published_at DESC';

    const sql = `
      SELECT ${POST_SUMMARY_FIELDS}
      FROM blog_posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN blog_categories c ON p.category_id = c.id
      ${tagJoin}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`;

    const result = await db.execute({ sql, args: [...args, limit, offset] });
    let posts = await attachTags(result.rows);

    if (req.user) {
      const ids = posts.map(p => p.id);
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const liked = await db.execute({ sql: `SELECT post_id FROM blog_likes WHERE user_id = ? AND post_id IN (${placeholders})`, args: [req.user.id, ...ids] });
        const likedSet = new Set(liked.rows.map(r => r.post_id));
        posts = posts.map(p => ({ ...p, isLiked: likedSet.has(p.id) }));
      }
    }

    res.json({ posts, page, limit });
  } catch (err) {
    console.error('[Blog] list error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/posts/featured — one featured post for the hero
// ─────────────────────────────────────────────────────────────────────────
router.get('/posts/featured', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT ${POST_SUMMARY_FIELDS}
            FROM blog_posts p
            JOIN users u ON p.author_id = u.id
            LEFT JOIN blog_categories c ON p.category_id = c.id
            WHERE p.status = 'published' AND p.featured = 1
            ORDER BY p.published_at DESC LIMIT 1`
    });
    const posts = await attachTags(result.rows);
    res.json({ post: posts[0] || null });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/categories — list with post counts
// ─────────────────────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT c.id, c.name, c.slug, c.description, c.color,
             (SELECT COUNT(*) FROM blog_posts WHERE category_id = c.id AND status = 'published') as post_count
      FROM blog_categories c ORDER BY c.name ASC`);
    res.json({ categories: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/tags — popular tags
// ─────────────────────────────────────────────────────────────────────────
router.get('/tags', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT t.id, t.name, t.slug, COUNT(pt.post_id) as post_count
      FROM blog_tags t
      LEFT JOIN blog_post_tags pt ON pt.tag_id = t.id
      GROUP BY t.id ORDER BY post_count DESC LIMIT 30`);
    res.json({ tags: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/authors/:id — author page: profile + their published posts
// ─────────────────────────────────────────────────────────────────────────
router.get('/authors/:id', async (req, res) => {
  try {
    const userRes = await db.execute({ sql: 'SELECT id, username, avatar, bio, is_verified_badge, created_at FROM users WHERE id = ?', args: [req.params.id] });
    if (!userRes.rows.length) return res.status(404).json({ message: 'Author not found' });

    const postsRes = await db.execute({
      sql: `SELECT ${POST_SUMMARY_FIELDS}
            FROM blog_posts p
            JOIN users u ON p.author_id = u.id
            LEFT JOIN blog_categories c ON p.category_id = c.id
            WHERE p.author_id = ? AND p.status = 'published'
            ORDER BY p.published_at DESC LIMIT 30`,
      args: [req.params.id]
    });
    const posts = await attachTags(postsRes.rows);
    res.json({ author: userRes.rows[0], posts });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/posts/:slug — single article. Increments view_count.
// Includes related posts (same category) and like/bookmark state if authed.
// ─────────────────────────────────────────────────────────────────────────
router.get('/posts/:slug', optionalAuth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT p.*, u.username as author_username, u.avatar as author_avatar, u.bio as author_bio,
                   c.name as category_name, c.slug as category_slug, c.color as category_color,
                   (SELECT COUNT(*) FROM blog_likes WHERE post_id = p.id) as like_count,
                   (SELECT COUNT(*) FROM blog_comments WHERE post_id = p.id) as comment_count
            FROM blog_posts p
            JOIN users u ON p.author_id = u.id
            LEFT JOIN blog_categories c ON p.category_id = c.id
            WHERE p.slug = ?`,
      args: [req.params.slug]
    });
    if (!result.rows.length) return res.status(404).json({ message: 'Post not found' });
    const post = result.rows[0];

    if (post.status !== 'published' && req.user?.id !== post.author_id) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Fire-and-forget view increment — doesn't block the response
    db.execute({ sql: 'UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?', args: [post.id] }).catch(() => {});

    const tagRows = await db.execute({ sql: `SELECT t.name, t.slug FROM blog_post_tags pt JOIN blog_tags t ON pt.tag_id = t.id WHERE pt.post_id = ?`, args: [post.id] });
    post.tags = tagRows.rows;

    let isLiked = false, isBookmarked = false;
    if (req.user) {
      const l = await db.execute({ sql: 'SELECT 1 FROM blog_likes WHERE post_id = ? AND user_id = ?', args: [post.id, req.user.id] });
      const b = await db.execute({ sql: 'SELECT 1 FROM blog_bookmarks WHERE post_id = ? AND user_id = ?', args: [post.id, req.user.id] });
      isLiked = l.rows.length > 0;
      isBookmarked = b.rows.length > 0;
    }

    // Related posts — same category, excluding this one
    let related = [];
    if (post.category_id) {
      const rel = await db.execute({
        sql: `SELECT ${POST_SUMMARY_FIELDS}
              FROM blog_posts p JOIN users u ON p.author_id = u.id LEFT JOIN blog_categories c ON p.category_id = c.id
              WHERE p.category_id = ? AND p.id != ? AND p.status = 'published'
              ORDER BY p.published_at DESC LIMIT 4`,
        args: [post.category_id, post.id]
      });
      related = await attachTags(rel.rows);
    }

    res.json({ post, isLiked, isBookmarked, related });
  } catch (err) {
    console.error('[Blog] detail error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/blog/posts — create (admin only)
// ─────────────────────────────────────────────────────────────────────────
router.post('/posts', protect, adminOnly, async (req, res) => {
  try {
    const { title, excerpt, content, categoryId, coverImage, tags, status, featured, seoDescription } = req.body;
    if (!title || !content) return res.status(400).json({ message: 'Title and content are required' });

    const imgCheck = validateImageUrl(coverImage, { fieldName: 'Cover image' });
    if (!imgCheck.ok) return res.status(400).json({ message: imgCheck.error });

    const id = uuidv4();
    const slug = await uniqueSlug('blog_posts', title);
    const finalStatus = status === 'published' ? 'published' : 'draft';
    const publishedAt = finalStatus === 'published' ? new Date().toISOString() : null;

    await db.execute({
      sql: `INSERT INTO blog_posts (id, author_id, category_id, title, slug, excerpt, content, cover_image, status, featured, reading_time, seo_description, published_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, req.user.id, categoryId || null, title.trim(), slug, (excerpt || '').trim(), content, imgCheck.value, finalStatus, featured ? 1 : 0, readingTimeFromContent(content), (seoDescription || '').trim(), publishedAt]
    });

    if (Array.isArray(tags)) {
      for (const tagName of tags.slice(0, 10)) {
        const tSlug = slugify(tagName);
        if (!tSlug) continue;
        let tagRow = await db.execute({ sql: 'SELECT id FROM blog_tags WHERE slug = ?', args: [tSlug] });
        let tagId;
        if (tagRow.rows.length) {
          tagId = tagRow.rows[0].id;
        } else {
          tagId = uuidv4();
          await db.execute({ sql: 'INSERT INTO blog_tags (id, name, slug) VALUES (?,?,?)', args: [tagId, tagName.trim(), tSlug] });
        }
        await db.execute({ sql: 'INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (?,?)', args: [id, tagId] });
      }
    }

    res.status(201).json({ id, slug });
  } catch (err) {
    console.error('[Blog] create error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PUT /api/blog/posts/:id — update (admin only)
// ─────────────────────────────────────────────────────────────────────────
router.put('/posts/:id', protect, adminOnly, async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT * FROM blog_posts WHERE id = ?', args: [req.params.id] });
    if (!existing.rows.length) return res.status(404).json({ message: 'Post not found' });
    const current = existing.rows[0];

    const { title, excerpt, content, categoryId, coverImage, status, featured, seoDescription, tags } = req.body;

    if (coverImage !== undefined) {
      const imgCheck = validateImageUrl(coverImage, { fieldName: 'Cover image' });
      if (!imgCheck.ok) return res.status(400).json({ message: imgCheck.error });
    }

    const newTitle = title !== undefined ? title.trim() : current.title;
    const newSlug = (title !== undefined && title.trim() !== current.title) ? await uniqueSlug('blog_posts', newTitle) : current.slug;
    const newContent = content !== undefined ? content : current.content;
    const newStatus = status !== undefined ? status : current.status;
    const publishedAt = (newStatus === 'published' && !current.published_at) ? new Date().toISOString() : current.published_at;

    await db.execute({
      sql: `UPDATE blog_posts SET title=?, slug=?, excerpt=?, content=?, category_id=?, cover_image=?, status=?, featured=?, reading_time=?, seo_description=?, published_at=?, updated_at=datetime('now') WHERE id=?`,
      args: [
        newTitle, newSlug,
        excerpt !== undefined ? excerpt.trim() : current.excerpt,
        newContent,
        categoryId !== undefined ? categoryId : current.category_id,
        coverImage !== undefined ? coverImage : current.cover_image,
        newStatus,
        featured !== undefined ? (featured ? 1 : 0) : current.featured,
        readingTimeFromContent(newContent),
        seoDescription !== undefined ? seoDescription.trim() : current.seo_description,
        publishedAt,
        req.params.id
      ]
    });

    if (Array.isArray(tags)) {
      await db.execute({ sql: 'DELETE FROM blog_post_tags WHERE post_id = ?', args: [req.params.id] });
      for (const tagName of tags.slice(0, 10)) {
        const tSlug = slugify(tagName);
        if (!tSlug) continue;
        let tagRow = await db.execute({ sql: 'SELECT id FROM blog_tags WHERE slug = ?', args: [tSlug] });
        let tagId;
        if (tagRow.rows.length) {
          tagId = tagRow.rows[0].id;
        } else {
          tagId = uuidv4();
          await db.execute({ sql: 'INSERT INTO blog_tags (id, name, slug) VALUES (?,?,?)', args: [tagId, tagName.trim(), tSlug] });
        }
        await db.execute({ sql: 'INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (?,?)', args: [req.params.id, tagId] });
      }
    }

    res.json({ message: 'Post updated', slug: newSlug });
  } catch (err) {
    console.error('[Blog] update error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/blog/posts/:id — admin only
// ─────────────────────────────────────────────────────────────────────────
router.delete('/posts/:id', protect, adminOnly, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM blog_posts WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/blog/categories — admin only
// ─────────────────────────────────────────────────────────────────────────
router.post('/categories', protect, adminOnly, async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });
    const id = uuidv4();
    const slug = await uniqueSlug('blog_categories', name);
    await db.execute({
      sql: 'INSERT INTO blog_categories (id, name, slug, description, color) VALUES (?,?,?,?,?)',
      args: [id, name.trim(), slug, (description || '').trim(), color || '#00D9FF']
    });
    res.status(201).json({ id, slug });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/categories/:id', protect, adminOnly, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM blog_categories WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/blog/posts/:id/like — toggle
// ─────────────────────────────────────────────────────────────────────────
router.post('/posts/:id/like', protect, async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT 1 FROM blog_likes WHERE post_id = ? AND user_id = ?', args: [req.params.id, req.user.id] });
    if (existing.rows.length) {
      await db.execute({ sql: 'DELETE FROM blog_likes WHERE post_id = ? AND user_id = ?', args: [req.params.id, req.user.id] });
      res.json({ liked: false });
    } else {
      await db.execute({ sql: 'INSERT INTO blog_likes (post_id, user_id) VALUES (?,?)', args: [req.params.id, req.user.id] });
      res.json({ liked: true });
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/blog/posts/:id/bookmark — toggle
// ─────────────────────────────────────────────────────────────────────────
router.post('/posts/:id/bookmark', protect, async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT 1 FROM blog_bookmarks WHERE post_id = ? AND user_id = ?', args: [req.params.id, req.user.id] });
    if (existing.rows.length) {
      await db.execute({ sql: 'DELETE FROM blog_bookmarks WHERE post_id = ? AND user_id = ?', args: [req.params.id, req.user.id] });
      res.json({ bookmarked: false });
    } else {
      await db.execute({ sql: 'INSERT INTO blog_bookmarks (post_id, user_id) VALUES (?,?)', args: [req.params.id, req.user.id] });
      res.json({ bookmarked: true });
    }
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/bookmarks — the current user's bookmarked posts
// ─────────────────────────────────────────────────────────────────────────
router.get('/bookmarks', protect, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT ${POST_SUMMARY_FIELDS}
            FROM blog_bookmarks b
            JOIN blog_posts p ON b.post_id = p.id
            JOIN users u ON p.author_id = u.id
            LEFT JOIN blog_categories c ON p.category_id = c.id
            WHERE b.user_id = ? ORDER BY b.created_at DESC`,
      args: [req.user.id]
    });
    const posts = await attachTags(result.rows);
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/posts/:id/comments — nested (flat list w/ parent_id; frontend nests)
// ─────────────────────────────────────────────────────────────────────────
router.get('/posts/:id/comments', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT c.id, c.content, c.parent_id, c.created_at, u.id as author_id, u.username as author_username, u.avatar as author_avatar
            FROM blog_comments c JOIN users u ON c.author_id = u.id
            WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      args: [req.params.id]
    });
    res.json({ comments: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/blog/posts/:id/comments — add comment or reply
// ─────────────────────────────────────────────────────────────────────────
router.post('/posts/:id/comments', protect, async (req, res) => {
  try {
    const { content, parentId } = req.body;
    const trimmed = (content || '').trim();
    if (!trimmed) return res.status(400).json({ message: 'Comment cannot be empty' });
    if (trimmed.length > 2000) return res.status(400).json({ message: 'Comment is too long (max 2000 characters)' });

    if (parentId) {
      const parent = await db.execute({ sql: 'SELECT id FROM blog_comments WHERE id = ? AND post_id = ?', args: [parentId, req.params.id] });
      if (!parent.rows.length) return res.status(400).json({ message: 'Invalid parent comment' });
    }

    const id = uuidv4();
    await db.execute({
      sql: 'INSERT INTO blog_comments (id, post_id, author_id, parent_id, content) VALUES (?,?,?,?,?)',
      args: [id, req.params.id, req.user.id, parentId || null, trimmed]
    });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/blog/comments/:id — own comment or admin
// ─────────────────────────────────────────────────────────────────────────
router.delete('/comments/:id', protect, async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT author_id FROM blog_comments WHERE id = ?', args: [req.params.id] });
    if (!existing.rows.length) return res.status(404).json({ message: 'Comment not found' });
    if (existing.rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await db.execute({ sql: 'DELETE FROM blog_comments WHERE id = ?', args: [req.params.id] });
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/blog/admin/posts — admin list (includes drafts)
// ─────────────────────────────────────────────────────────────────────────
router.get('/admin/posts', protect, adminOnly, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT ${POST_SUMMARY_FIELDS}
      FROM blog_posts p JOIN users u ON p.author_id = u.id LEFT JOIN blog_categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC LIMIT 100`);
    const posts = await attachTags(result.rows);
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
