const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, "data");
const databasePath = process.env.SQLITE_PATH || path.join(dataDirectory, "shop.sqlite");
const publicDirectory = path.join(__dirname, "public");

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("En production, définissez SESSION_SECRET avec au moins 32 caractères.");
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    image_url TEXT NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0)
  );
`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

if (!hasColumn("products", "stock")) {
  db.exec("ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 20 CHECK (stock >= 0)");
}
if (!hasColumn("orders", "idempotency_key")) {
  db.exec("ALTER TABLE orders ADD COLUMN idempotency_key TEXT");
}
if (!hasColumn("orders", "status")) {
  db.exec("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency
    ON orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_orders_user_created
    ON orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_order_items_order
    ON order_items(order_id);
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);
db.prepare("UPDATE products SET image_url = REPLACE(image_url, ?, ?) WHERE image_url LIKE ?")
  .run("6b1558fCCA3d", "6b1558fcca3d", "%6b1558fCCA3d%");
db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
const sessionCleanup = setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}, 60 * 60 * 1000);
sessionCleanup.unref();

function transaction(callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const seedProducts = [
  {
    name: "Sac cabas Alba",
    description: "Un cabas spacieux en toile naturelle, cousu avec soin pour vous accompagner partout.",
    price_cents: 3900,
    image_url: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1000&q=85",
    category: "Accessoires"
  },
  {
    name: "Tasse Terre",
    description: "Tasse en céramique artisanale, façonnée à la main. Chaque pièce est unique.",
    price_cents: 2400,
    image_url: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=1000&q=85",
    category: "Maison"
  },
  {
    name: "Carnet Atelier",
    description: "Carnet à couverture texturée et papier ivoire, idéal pour vos idées du quotidien.",
    price_cents: 1800,
    image_url: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=1000&q=85",
    category: "Papeterie"
  },
  {
    name: "Bougie Soir d'été",
    description: "Bougie végétale parfumée aux notes douces de fleur d'oranger et de bois clair.",
    price_cents: 3200,
    image_url: "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=1000&q=85",
    category: "Maison"
  },
  {
    name: "Pochette Noma",
    description: "Petite pochette doublée en coton, pratique et élégante, fabriquée en série limitée.",
    price_cents: 2600,
    image_url: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1000&q=85",
    category: "Accessoires"
  },
  {
    name: "Plateau Sable",
    description: "Plateau décoratif aux lignes épurées, parfait pour une table accueillante.",
    price_cents: 4500,
    image_url: "https://images.unsplash.com/photo-1603199506016-b9a594b593c0?auto=format&fit=crop&w=1000&q=85",
    category: "Maison"
  }
];

if (db.prepare("SELECT COUNT(*) AS count FROM products").get().count === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products (name, description, price_cents, image_url, category)
    VALUES (@name, @description, @price_cents, @image_url, @category)
  `);
  transaction(() => seedProducts.forEach((product) => insertProduct.run(product)));
}

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare("SELECT data, expires_at FROM sessions WHERE sid = ?").get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, data, callback = () => {}) {
    try {
      const maxAge = data.cookie && data.cookie.maxAge;
      const expiresAt = data.cookie && data.cookie.expires
        ? new Date(data.cookie.expires).getTime()
        : Date.now() + (Number(maxAge) || 86400000);
      db.prepare(`
        INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
      `).run(sid, JSON.stringify(data), expiresAt);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, data, callback = () => {}) {
    try {
      const expiresAt = data.cookie && data.cookie.expires
        ? new Date(data.cookie.expires).getTime()
        : Date.now() + (Number(data.cookie && data.cookie.maxAge) || 86400000);
      db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  });
  next();
});
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) req.body = {};
  next();
});
app.use(
  session({
    name: "atelier.sid",
    secret: process.env.SESSION_SECRET || "development-only-change-me-before-deploying-please",
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  })
);

function setSessionCookieSecurity(req) {
  if (process.env.COOKIE_SECURE === "true") req.session.cookie.secure = true;
  else if (process.env.COOKIE_SECURE === "false") req.session.cookie.secure = false;
  else req.session.cookie.secure = req.secure;
}

app.use((req, res, next) => {
  setSessionCookieSecurity(req);
  next();
});

function requireUser(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Connectez-vous pour continuer.", code: "AUTH_REQUIRED" });
  }
  next();
}

app.use((req, res, next) => {
  if (["/orders.html", "/account.html"].includes(req.path) && !req.session.user) {
    return res.redirect(`/auth.html?next=${encodeURIComponent(req.path)}`);
  }
  next();
});
app.use(express.static(publicDirectory));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const publicProduct = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: row.price_cents / 100,
  imageUrl: row.image_url,
  category: row.category,
  stock: row.stock,
  available: row.stock > 0
});

function parsePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    const error = new Error(`${label} est invalide.`);
    error.status = 400;
    error.code = "INVALID_INPUT";
    throw error;
  }
  return parsed;
}

function getOrder(orderId, userId) {
  const order = db.prepare(`
    SELECT id, total_cents, created_at, status
    FROM orders WHERE id = ? AND user_id = ?
  `).get(orderId, userId);
  if (!order) return null;
  const items = db.prepare(`
    SELECT product_id AS productId, product_name AS name,
      unit_price_cents AS unitPriceCents, quantity
    FROM order_items WHERE order_id = ? ORDER BY id
  `).all(order.id);
  return {
    id: order.id,
    total: order.total_cents / 100,
    status: order.status,
    createdAt: order.created_at,
    items: items.map((item) => ({
      productId: item.productId,
      name: item.name,
      unitPrice: item.unitPriceCents / 100,
      quantity: item.quantity
    }))
  };
}

app.get("/api/products", (req, res, next) => {
  try {
    const allowed = ["q", "category", "sort", "page", "limit"];
    const hasQuery = allowed.some((key) => Object.hasOwn(req.query, key));
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 80) : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "relevance";
    if (!["relevance", "price-asc", "price-desc", "newest"].includes(sort)) {
      return res.status(400).json({ error: "Tri invalide.", code: "INVALID_INPUT" });
    }
    const page = req.query.page === undefined ? 1 : parsePositiveInteger(req.query.page, "La page", 100000);
    const limit = req.query.limit === undefined ? 24 : parsePositiveInteger(req.query.limit, "La limite", 50);
    const conditions = [];
    const parameters = {};
    if (search) {
      conditions.push("(name LIKE @search ESCAPE '!' OR description LIKE @search ESCAPE '!' OR category LIKE @search ESCAPE '!')");
      parameters.search = `%${search.replace(/[!%_]/g, "!$&")}%`;
    }
    if (category) {
      conditions.push("category = @category");
      parameters.category = category;
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = db.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).get(parameters).count;
    const orderBy = sort === "price-asc" ? "price_cents ASC, id ASC"
      : sort === "price-desc" ? "price_cents DESC, id ASC"
        : sort === "newest" ? "id DESC"
          : "id ASC";
    const products = db.prepare(`
      SELECT * FROM products ${where}
      ORDER BY ${orderBy}
      LIMIT @limit OFFSET @offset
    `).all({ ...parameters, limit, offset: (page - 1) * limit }).map(publicProduct);
    if (!hasQuery) return res.json(products);
    res.json({ products, total: count, page, limit, pages: Math.ceil(count / limit) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/products/:id", (req, res, next) => {
  try {
    const id = parsePositiveInteger(req.params.id, "L'identifiant du produit");
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!product) return res.status(404).json({ error: "Produit introuvable.", code: "NOT_FOUND" });
    res.json(publicProduct(product));
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/register", async (req, res, next) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: "Le nom doit contenir entre 2 et 80 caractères.", code: "INVALID_INPUT" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Saisissez une adresse e-mail valide.", code: "INVALID_INPUT" });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Le mot de passe doit contenir entre 8 et 128 caractères.", code: "INVALID_INPUT" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, email, passwordHash);
    const user = { id: Number(result.lastInsertRowid), name, email };
    req.session.regenerate((error) => {
      if (error) return next(error);
      setSessionCookieSecurity(req);
      req.session.user = user;
      res.status(201).json({ user });
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.errcode === 2067) {
      return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail.", code: "EMAIL_IN_USE" });
    }
    next(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  try {
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Adresse e-mail ou mot de passe incorrect.", code: "INVALID_CREDENTIALS" });
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      setSessionCookieSecurity(req);
      req.session.user = { id: user.id, name: user.name, email: user.email };
      res.json({ user: req.session.user });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("atelier.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.status(204).end();
  });
});

app.get("/api/favorites", requireUser, (req, res) => {
  const products = db.prepare(`
    SELECT p.* FROM favorites f
    JOIN products p ON p.id = f.product_id
    WHERE f.user_id = ? ORDER BY f.created_at DESC
  `).all(req.session.user.id);
  res.json(products.map(publicProduct));
});

app.post("/api/favorites/:productId", requireUser, (req, res, next) => {
  try {
    const productId = parsePositiveInteger(req.params.productId, "L'identifiant du produit");
    if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(productId)) {
      return res.status(404).json({ error: "Produit introuvable.", code: "NOT_FOUND" });
    }
    db.prepare("INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)")
      .run(req.session.user.id, productId);
    res.status(201).json({ favorite: true, productId });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/favorites/:productId", requireUser, (req, res, next) => {
  try {
    const productId = parsePositiveInteger(req.params.productId, "L'identifiant du produit");
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?")
      .run(req.session.user.id, productId);
    res.json({ favorite: false, productId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", requireUser, (req, res) => {
  const userId = req.session.user.id;
  const orderCount = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE user_id = ?").get(userId).count;
  const favoriteCount = db.prepare("SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?").get(userId).count;
  const recentOrders = db.prepare(`
    SELECT id, total_cents, created_at, status FROM orders
    WHERE user_id = ? ORDER BY id DESC LIMIT 3
  `).all(userId).map((order) => ({
    id: order.id,
    total: order.total_cents / 100,
    status: order.status,
    createdAt: order.created_at
  }));
  res.json({ user: req.session.user, orderCount, favoriteCount, recentOrders });
});

app.post("/api/orders", requireUser, (req, res, next) => {
  const items = req.body.items;
  const idempotencyKey = typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey : null;
  if (idempotencyKey !== null && !/^[\w-]{8,100}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: "Clé de commande invalide.", code: "INVALID_INPUT" });
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return res.status(400).json({ error: "Votre panier est vide ou invalide.", code: "INVALID_CART" });
  }

  const quantities = new Map();
  for (const item of items) {
    const productId = Number(item && item.productId);
    const quantity = Number(item && item.quantity);
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ error: "Un article de votre panier est invalide.", code: "INVALID_CART" });
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 20)) {
    return res.status(400).json({ error: "La quantité maximale par produit est de 20.", code: "INVALID_CART" });
  }

  try {
    const order = transaction(() => {
      if (idempotencyKey) {
        const priorOrder = db.prepare("SELECT id FROM orders WHERE user_id = ? AND idempotency_key = ?")
          .get(req.session.user.id, idempotencyKey);
        if (priorOrder) return { ...getOrder(priorOrder.id, req.session.user.id), replayed: true };
      }
      const products = [...quantities.entries()].map(([productId, quantity]) => {
        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
        if (!product) throw Object.assign(new Error("Un produit de votre panier n'est plus disponible."), { code: "PRODUCT_NOT_FOUND" });
        if (product.stock < quantity) {
          throw Object.assign(new Error(`Stock insuffisant pour « ${product.name} » (disponible : ${product.stock}).`), { code: "INSUFFICIENT_STOCK" });
        }
        return { product, quantity };
      });
      const totalCents = products.reduce((total, item) => total + item.product.price_cents * item.quantity, 0);
      const orderResult = db.prepare(`
        INSERT INTO orders (user_id, total_cents, idempotency_key, status)
        VALUES (?, ?, ?, 'confirmed')
      `).run(req.session.user.id, totalCents, idempotencyKey);
      const orderId = Number(orderResult.lastInsertRowid);
      const decrementStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?");
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
      products.forEach(({ product, quantity }) => {
        if (decrementStock.run(quantity, product.id, quantity).changes !== 1) {
          throw Object.assign(new Error(`Stock insuffisant pour « ${product.name} ».`), { code: "INSUFFICIENT_STOCK" });
        }
        insertItem.run(orderId, product.id, product.name, product.price_cents, quantity);
      });
      return getOrder(orderId, req.session.user.id);
    });
    res.status(order.replayed ? 200 : 201).json({ order });
  } catch (error) {
    if (["PRODUCT_NOT_FOUND", "INSUFFICIENT_STOCK"].includes(error.code)) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    next(error);
  }
});

app.get("/api/orders", requireUser, (req, res, next) => {
  try {
    const orders = db.prepare(`
      SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100
    `).all(req.session.user.id);
    res.json(orders.map(({ id }) => getOrder(id, req.session.user.id)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/:id", requireUser, (req, res, next) => {
  try {
    const id = parsePositiveInteger(req.params.id, "L'identifiant de la commande");
    const order = getOrder(id, req.session.user.id);
    if (!order) return res.status(404).json({ error: "Commande introuvable.", code: "NOT_FOUND" });
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Route API introuvable.", code: "NOT_FOUND" });
});

app.use((req, res, next) => {
  if (req.accepts("html")) return res.status(404).sendFile(path.join(publicDirectory, "404.html"), next);
  res.status(404).json({ error: "Page introuvable.", code: "NOT_FOUND" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status === 500 ? "Une erreur est survenue. Réessayez plus tard." : error.message,
    code: status === 500 ? "INTERNAL_ERROR" : error.code || "REQUEST_ERROR"
  });
});

const server = app.listen(port, () => {
  console.log(`Boutique disponible sur http://localhost:${port}`);
});

function shutdown() {
  clearInterval(sessionCleanup);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
