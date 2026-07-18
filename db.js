const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// Turso (cloud-hosted libsql) is used in production so data survives
// redeploys and container restarts — a local file (node:sqlite/better-sqlite3)
// lives on the container's ephemeral disk and gets wiped on every fresh deploy.
// For local/dev use without a Turso account, falling back to a local file is
// still supported — just don't rely on it in production.
const dataDir = process.env.DATA_DIR || '/home/container/.spiderhub_data';
if (!process.env.TURSO_DATABASE_URL && !fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(dataDir, 'spiderhub.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN, // not needed for local file: URLs
});

async function initDB() {
  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      role TEXT DEFAULT 'user',
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      wallet_balance REAL DEFAULT 0,
      points_balance INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      streak_count INTEGER DEFAULT 0,
      streak_freezes INTEGER DEFAULT 0,
      last_checkin TEXT,
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      cover_photo TEXT DEFAULT '',
      is_verified_badge INTEGER DEFAULT 0,
      otp_code TEXT,
      otp_expires TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'daily',
      xp_reward INTEGER DEFAULT 0,
      points_reward INTEGER DEFAULT 0,
      target_action TEXT NOT NULL,
      target_count INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_missions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      claimed INTEGER DEFAULT 0,
      period_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE(user_id, mission_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS spin_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prize_type TEXT NOT NULL,
      prize_value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'award',
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#00e5ff'
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      earned_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, badge_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_links (
      user_id TEXT PRIMARY KEY,
      website TEXT DEFAULT '',
      twitter TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      tiktok TEXT DEFAULT '',
      telegram TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      account_details TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      type TEXT DEFAULT 'cops',
      value INTEGER NOT NULL,
      max_uses INTEGER DEFAULT 1,
      used_count INTEGER DEFAULT 0,
      expires_at TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      coupon_code TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redeemed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (coupon_code, user_id),
      FOREIGN KEY (coupon_code) REFERENCES coupons(code) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bot_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'whatsapp',
      cover_image TEXT DEFAULT '',
      download_url TEXT NOT NULL,
      demo_url TEXT DEFAULT '',
      price_cops INTEGER NOT NULL,
      rental_price_cops_per_day INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      sales_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bot_purchases (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      price_paid INTEGER NOT NULL,
      rented_until TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (listing_id) REFERENCES bot_listings(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bot_reviews (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(listing_id, user_id),
      FOREIGN KEY (listing_id) REFERENCES bot_listings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS download_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      query TEXT NOT NULL,
      source TEXT DEFAULT 'music',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_preview TEXT NOT NULL,
      name TEXT DEFAULT 'API Key',
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      revoked INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_generations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      prompt TEXT NOT NULL,
      result TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      platform TEXT DEFAULT 'general',
      link TEXT DEFAULT '',
      points_reward INTEGER DEFAULT 0,
      xp_reward INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_tasks (
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      completed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, task_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      group_id TEXT,
      poll_options TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      creator_id TEXT NOT NULL,
      is_private INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      icon TEXT DEFAULT 'newspaper',
      color TEXT DEFAULT '#00ffcc',
      category TEXT DEFAULT 'general',
      author_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      message TEXT NOT NULL,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      last_message TEXT DEFAULT '',
      last_at TEXT DEFAULT (datetime('now')),
      unread_a INTEGER DEFAULT 0,
      unread_b INTEGER DEFAULT 0,
      UNIQUE(user_a, user_b),
      FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      is_read INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS boost_services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      price_per_1000 REAL NOT NULL,
      min_qty INTEGER DEFAULT 100,
      max_qty INTEGER DEFAULT 10000,
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS boost_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service_id TEXT,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_cost REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES boost_services(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS blog_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#00D9FF',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      category_id TEXT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      excerpt TEXT DEFAULT '',
      content TEXT NOT NULL,
      cover_image TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      featured INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 1,
      seo_description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES blog_categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS blog_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blog_post_tags (
      post_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES blog_tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blog_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      parent_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES blog_comments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blog_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blog_bookmarks (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);


  // Migrate: add pinned column to existing posts table if missing
  try {
    await db.execute('ALTER TABLE posts ADD COLUMN pinned INTEGER DEFAULT 0');
  } catch(e) { /* already exists */ }
  try {
    await db.execute("ALTER TABLE users ADD COLUMN last_seen TEXT DEFAULT (datetime('now'))");
  } catch(e) { /* already exists */ }

  try {
    await db.execute("ALTER TABLE posts ADD COLUMN group_id TEXT");
  } catch(e) { /* already exists */ }
  try {
    await db.execute("ALTER TABLE posts ADD COLUMN poll_options TEXT");
  } catch(e) { /* already exists */ }

  const newUserCols = [
    "points_balance INTEGER DEFAULT 0",
    "xp INTEGER DEFAULT 0",
    "level INTEGER DEFAULT 1",
    "streak_count INTEGER DEFAULT 0",
    "last_checkin TEXT",
    "referral_code TEXT",
    "referred_by TEXT",
    "cover_photo TEXT DEFAULT ''",
    "is_verified_badge INTEGER DEFAULT 0",
    "ai_daily_used INTEGER DEFAULT 0",
    "ai_daily_date TEXT",
    "plan TEXT DEFAULT 'free'",
    "plan_expires_at TEXT",
    "totp_secret TEXT",
    "totp_enabled INTEGER DEFAULT 0",
    "notification_prefs TEXT DEFAULT '{\"rewards\":true,\"referrals\":true,\"social\":true,\"marketing\":true}'",
    "profile_visibility TEXT DEFAULT 'public'",
    "show_online_status INTEGER DEFAULT 1",
    "google_linked INTEGER DEFAULT 0",
    "account_status TEXT DEFAULT ''",
    "warning_count INTEGER DEFAULT 0",
    "suspended_until TEXT",
    "streak_freezes INTEGER DEFAULT 0",
    "verify_token TEXT",
    "verify_token_expires TEXT"
  ];
  for (const col of newUserCols) {
    try { await db.execute(`ALTER TABLE users ADD COLUMN ${col}`); } catch(e) { /* already exists */ }
  }

  // Backfill referral codes for existing users that don't have one
  try {
    const { rows } = await db.execute("SELECT id, username FROM users WHERE referral_code IS NULL");
    for (const u of rows) {
      const code = 'SP-' + u.username.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + Math.floor(Math.random() * 900 + 100);
      try { await db.execute({ sql: "UPDATE users SET referral_code = ? WHERE id = ?", args: [code, u.id] }); } catch(e) {}
    }
  } catch(e) { /* users table may not exist yet on first run */ }

  // Seed default missions if none exist
  try {
    const { rows: [{ count }] } = await db.execute("SELECT COUNT(*) as count FROM missions");
    if (count === 0) {
      const seed = [
        ['Daily Login', 'Log in to SpiderHub today', 'daily', 10, 5, 'login', 1],
        ['Make a Post', 'Share something with the community', 'daily', 15, 10, 'post_create', 1],
        ['Refer a Friend', 'Invite someone using your referral link', 'weekly', 50, 100, 'referral', 1],
        ['Spin the Wheel', 'Try your luck on the daily spin', 'daily', 5, 0, 'spin', 1]
      ];
      const sql = "INSERT INTO missions (id, title, description, type, xp_reward, points_reward, target_action, target_count) VALUES (?,?,?,?,?,?,?,?)";
      for (const m of seed) {
        await db.execute({ sql, args: ['mis_' + Math.random().toString(36).slice(2, 10), ...m] });
      }
    }
  } catch(e) { /* missions table may not exist yet on first run */ }

  // Seed default badges if none exist
  try {
    const { rows: [{ count }] } = await db.execute("SELECT COUNT(*) as count FROM badges");
    if (count === 0) {
      const badgeSeed = [
        ['badge_welcome', 'Welcome Aboard', 'star', 'Joined SpiderHub', '#00D9FF'],
        ['badge_verified', 'Verified', 'check', 'Verified account', '#0066FF'],
        ['badge_streak7', 'Streak Master', 'fire', '7-day check-in streak', '#ff6b35'],
        ['badge_streak30', 'Unstoppable', 'fire', '30-day check-in streak', '#FFD700'],
        ['badge_referrer', 'Super Referrer', 'handshake', 'Referred 5+ users', '#F0B90B'],
        ['badge_level10', 'Rising Star', 'trophy', 'Reached Level 10', '#9944ff']
      ];
      const sql = "INSERT INTO badges (id, name, icon, description, color) VALUES (?,?,?,?,?)";
      for (const b of badgeSeed) await db.execute({ sql, args: b });
    }
  } catch(e) { /* badges table may not exist yet on first run */ }

  // Seed default earn-center tasks if none exist
  try {
    const { rows: [{ count }] } = await db.execute("SELECT COUNT(*) as count FROM tasks");
    if (count === 0) {
      const taskSeed = [
        ['task_telegram', 'Join our Telegram Channel', 'Join for updates, drops and announcements', 'telegram', 'https://t.me/Scottycrg', 30, 10],
        ['task_youtube', 'Subscribe on YouTube', 'Subscribe to @scottyx-tech for tutorials', 'youtube', 'https://youtube.com/@scottyx-tech?si=w_ywEbFzNOfDb6Yv', 30, 10],
        ['task_whatsapp', 'Follow our WhatsApp Channel', 'Stay updated on bot releases & offers', 'whatsapp', 'https://wa.me/263719080917', 20, 5],
      ];
      const sql = "INSERT INTO tasks (id, title, description, platform, link, points_reward, xp_reward) VALUES (?,?,?,?,?,?,?)";
      for (const t of taskSeed) await db.execute({ sql, args: t });
    }
  } catch(e) { /* tasks table may not exist yet on first run */ }

  // Seed default blog categories if none exist
  try {
    const { rows: [{ count }] } = await db.execute("SELECT COUNT(*) as count FROM blog_categories");
    if (count === 0) {
      const catSeed = [
        ['News & Updates', 'news-updates', 'Platform announcements and updates', '#00D9FF'],
        ['Guides & Tutorials', 'guides-tutorials', 'How-tos and walkthroughs', '#00cc88'],
        ['Movies & Entertainment', 'movies-entertainment', 'Reviews, lists, and entertainment news', '#0066FF'],
        ['Crypto & Finance', 'crypto-finance', 'Market insights and money tips', '#F0B90B'],
        ['Community', 'community', 'Stories and spotlights from the community', '#9944ff']
      ];
      const sql = "INSERT INTO blog_categories (id, name, slug, description, color) VALUES (?,?,?,?,?)";
      for (const c of catSeed) {
        await db.execute({ sql, args: ['cat_' + Math.random().toString(36).slice(2, 10), ...c] });
      }
    }
  } catch(e) { /* blog_categories table may not exist yet on first run */ }

  console.log('✅ Turso/libSQL DB ready');
}

module.exports = { db, initDB };
