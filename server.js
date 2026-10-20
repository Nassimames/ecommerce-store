const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const app = express();
const port = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("En production, définissez SESSION_SECRET avec au moins 32 caractères.");
}
const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(path.join(dataDirectory, "shop.sqlite"));

db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
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
    unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
  );
`);

const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
if (productCount === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products (name, description, price_cents, image_url, category)
    VALUES (@name, @description, @price_cents, @image_url, @category)
  `);
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
      image_url: "https://images.unsplash.com/photo-1514228742587-6b1558fCCA3d?auto=format&fit=crop&w=1000&q=85",
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

  transaction(() => {
    seedProducts.forEach((product) => insertProduct.run(product));
  });
}

function transaction(callback) {
  db.exec("BEGIN");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(
  session({
    name: "atelier.sid",
    secret: process.env.SESSION_SECRET || "change-this-secret-before-deploying",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);
app.use(express.static(path.join(__dirname, "public")));

const publicProduct = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: row.price_cents / 100,
  imageUrl: row.image_url,
  category: row.category
});

function requireUser(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Connectez-vous pour continuer." });
  }
  next();
}

app.get("/api/products", (req, res) => {
  const products = db.prepare("SELECT * FROM products ORDER BY id").all();
  res.json(products.map(publicProduct));
});

app.get("/api/products/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Identifiant de produit invalide." });
  }
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) {
    return res.status(404).json({ error: "Produit introuvable." });
  }
  res.json(publicProduct(product));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/register", async (req, res, next) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: "Le nom doit contenir entre 2 et 80 caractères." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Saisissez une adresse e-mail valide." });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Le mot de passe doit contenir entre 8 et 128 caractères." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, email, passwordHash);
    const user = { id: Number(result.lastInsertRowid), name, email };
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = user;
      res.status(201).json({ user });
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail." });
    }
    next(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Adresse e-mail ou mot de passe incorrect." });
  }
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.json({ user: req.session.user });
  });
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("atelier.sid", { httpOnly: true, sameSite: "lax" });
    res.status(204).end();
  });
});

app.post("/api/orders", requireUser, (req, res, next) => {
  const items = req.body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return res.status(400).json({ error: "Votre panier est vide ou invalide." });
  }

  const quantities = new Map();
  for (const item of items) {
    const productId = Number(item && item.productId);
    const quantity = Number(item && item.quantity);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ error: "Un article de votre panier est invalide." });
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 20)) {
    return res.status(400).json({ error: "La quantité maximale par produit est de 20." });
  }

  try {
    const createOrder = () => transaction(() => {
      const products = [...quantities.entries()].map(([productId, quantity]) => {
        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
        if (!product) throw new Error("PRODUCT_NOT_FOUND");
        return { product, quantity };
      });
      const totalCents = products.reduce(
        (total, item) => total + item.product.price_cents * item.quantity,
        0
      );
      const orderResult = db
        .prepare("INSERT INTO orders (user_id, total_cents) VALUES (?, ?)")
        .run(req.session.user.id, totalCents);
      const orderId = Number(orderResult.lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
      products.forEach(({ product, quantity }) => {
        insertItem.run(orderId, product.id, product.name, product.price_cents, quantity);
      });
      return { id: orderId, total: totalCents / 100 };
    });
    res.status(201).json({ order: createOrder() });
  } catch (error) {
    if (error.message === "PRODUCT_NOT_FOUND") {
      return res.status(400).json({ error: "Un produit de votre panier n'est plus disponible." });
    }
    next(error);
  }
});

app.get("/api/orders", requireUser, (req, res) => {
  const orders = db
    .prepare("SELECT id, total_cents, created_at FROM orders WHERE user_id = ? ORDER BY id DESC")
    .all(req.session.user.id);
  const getItems = db.prepare(`
    SELECT product_name AS name, unit_price_cents AS unitPrice, quantity
    FROM order_items WHERE order_id = ?
  `);
  res.json(
    orders.map((order) => ({
      id: order.id,
      total: order.total_cents / 100,
      createdAt: order.created_at,
      items: getItems.all(order.id).map((item) => ({
        name: item.name,
        unitPrice: item.unitPrice / 100,
        quantity: item.quantity
      }))
    }))
  );
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Route API introuvable." });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Une erreur est survenue. Réessayez plus tard." });
});

app.listen(port, () => {
  console.log(`Boutique disponible sur http://localhost:${port}`);
});
