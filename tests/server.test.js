const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer } = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-ecommerce-test-"));
const databasePath = path.join(tempDirectory, "test.sqlite");
let serverProcess;
let baseUrl;
let serverOutput = "";

async function getPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer(targetDatabasePath = databasePath) {
  const port = await getPort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_PATH: targetDatabasePath,
      NODE_ENV: "production",
      SESSION_SECRET: "test-session-secret-that-is-long-enough-for-local-tests"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverOutput = "";
  serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk; });
  serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error(`Test server stopped unexpectedly:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/products`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Test server did not become ready:\n${serverOutput}`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const child = serverProcess;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2500);
  await exited;
  clearTimeout(forceKill);
}

function client() {
  let cookie = "";
  return async (url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, {
      ...options,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      },
      redirect: "manual"
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
    return response;
  };
}

const json = (value) => JSON.stringify(value);
const hasThirtyDaySessionExpiry = (headers) =>
  headers.getSetCookie().some((cookie) => {
    const expires = cookie.match(/Expires=([^;]+)/);
    return expires && new Date(expires[1]).getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000;
  });

test("e-commerce API validates users, catalog, favorites, stock and owned orders", async (t) => {
  t.after(async () => {
    await stopServer();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
  await startServer();

  const visitor = client();
  const productsResponse = await visitor("/api/products");
  assert.equal(productsResponse.status, 200);
  const products = await productsResponse.json();
  assert.equal(products.length, 6);
  assert.equal(products[0].stock, 20);

  const search = await visitor("/api/products?q=cabas&sort=price-asc&page=1&limit=2");
  const searchResult = await search.json();
  assert.equal(search.status, 200);
  assert.equal(searchResult.total, 1);
  assert.equal(searchResult.products[0].name, "Sac cabas Alba");
  const categoryPage = await visitor("/api/products?category=Maison&sort=price-asc&page=1&limit=2");
  const categoryResult = await categoryPage.json();
  assert.equal(categoryPage.status, 200);
  assert.equal(categoryResult.total, 3);
  assert.equal(categoryResult.pages, 2);
  assert.equal(categoryResult.products[0].name, "Tasse Terre");

  const invalidRegister = await visitor("/api/register", {
    method: "POST",
    body: json({ name: "A", email: "not-an-email", password: "short" })
  });
  assert.equal(invalidRegister.status, 400);
  assert.equal((await invalidRegister.json()).code, "INVALID_INPUT");
  assert.equal((await visitor("/api/register", { method: "POST" })).status, 400);

  const privatePage = await visitor("/account.html");
  assert.equal(privatePage.status, 302);
  assert.match(privatePage.headers.get("location"), /auth\.html/);

  const register = await visitor("/api/register", {
    method: "POST",
    body: json({ name: "Acheteuse Test", email: "acheteuse@example.test", password: "test-password-123" })
  });
  assert.equal(register.status, 201);
  assert.ok(hasThirtyDaySessionExpiry(register.headers));
  const loginCookie = register.headers.getSetCookie().find((cookie) => cookie.startsWith("atelier.sid="));
  assert.ok(loginCookie);
  assert.doesNotMatch(loginCookie, /;\s*Secure(?:;|$)/i);
  const user = await register.json();
  assert.ok(user.user.id);
  const secureProxySession = await fetch(`${baseUrl}/api/me`, {
    headers: {
      "X-Forwarded-Proto": "https",
      Cookie: loginCookie.split(";")[0]
    }
  });
  assert.ok(secureProxySession.headers.getSetCookie().some((cookie) => /;\s*Secure(?:;|$)/i.test(cookie)));
  const refreshedSession = await visitor("/api/me");
  assert.equal((await refreshedSession.json()).user.email, "acheteuse@example.test");
  assert.ok(hasThirtyDaySessionExpiry(refreshedSession.headers));

  const duplicate = await visitor("/api/register", {
    method: "POST",
    body: json({ name: "Acheteuse Test", email: "acheteuse@example.test", password: "test-password-123" })
  });
  assert.equal(duplicate.status, 409);

  const favoritesUnauthorized = await client()("/api/favorites");
  assert.equal(favoritesUnauthorized.status, 401);
  const favoriteAdded = await visitor("/api/favorites/1", { method: "POST" });
  assert.equal(favoriteAdded.status, 201);
  assert.equal((await (await visitor("/api/favorites")).json()).length, 1);
  assert.equal((await visitor("/api/favorites/1", { method: "DELETE" })).status, 200);
  assert.equal((await (await visitor("/api/favorites")).json()).length, 0);

  const db = new DatabaseSync(databasePath);
  db.prepare("UPDATE products SET stock = 1 WHERE id = ?").run(1);
  db.close();

  const insufficientStock = await visitor("/api/orders", {
    method: "POST",
    body: json({ items: [{ productId: 1, quantity: 2 }] })
  });
  const insufficientStockBody = await insufficientStock.json();
  assert.equal(insufficientStock.status, 409, `${JSON.stringify(insufficientStockBody)}\n${serverOutput}`);
  assert.equal(insufficientStockBody.code, "INSUFFICIENT_STOCK");
  assert.equal((await (await visitor("/api/orders")).json()).length, 0);

  const idempotencyKey = "test-order-key-00001";
  const checkoutPayload = {
    items: [{ productId: 1, quantity: 1, price: 0, total: 0 }],
    idempotencyKey
  };
  const checkout = await visitor("/api/orders", { method: "POST", body: json(checkoutPayload) });
  assert.equal(checkout.status, 201);
  const createdOrder = (await checkout.json()).order;
  assert.equal(createdOrder.total, 39);
  assert.equal(createdOrder.items[0].unitPrice, 39);

  const replay = await visitor("/api/orders", { method: "POST", body: json(checkoutPayload) });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).order.id, createdOrder.id);
  const afterReplayDb = new DatabaseSync(databasePath);
  assert.equal(afterReplayDb.prepare("SELECT stock FROM products WHERE id = 1").get().stock, 0);
  afterReplayDb.close();

  assert.equal((await visitor(`/api/orders/${createdOrder.id}`)).status, 200);
  const otherUser = client();
  const login = await otherUser("/api/login", {
    method: "POST",
    body: json({ email: "acheteuse@example.test", password: "test-password-123" })
  });
  assert.equal(login.status, 200);
  assert.equal((await otherUser(`/api/orders/${createdOrder.id}`)).status, 200);

  const anotherAccount = client();
  const registerOther = await anotherAccount("/api/register", {
    method: "POST",
    body: json({ name: "Autre Client", email: "autre@example.test", password: "another-password-123" })
  });
  assert.equal(registerOther.status, 201);
  assert.equal((await anotherAccount(`/api/orders/${createdOrder.id}`)).status, 404);
  assert.equal((await anotherAccount("/api/dashboard")).status, 200);

  const passwordHash = new DatabaseSync(databasePath);
  const storedPassword = passwordHash.prepare("SELECT password_hash FROM users WHERE email = ?").get("acheteuse@example.test").password_hash;
  passwordHash.close();
  assert.notEqual(storedPassword, "test-password-123");

  await stopServer();
  await startServer();
  assert.equal((await visitor("/api/me")).status, 200);
  const sessionAfterRestart = await visitor("/api/me");
  assert.equal((await sessionAfterRestart.json()).user.email, "acheteuse@example.test");

  await stopServer();
  const legacyDatabasePath = path.join(tempDirectory, "legacy.sqlite");
  const legacyDb = new DatabaseSync(legacyDatabasePath);
  legacyDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      image_url TEXT NOT NULL,
      category TEXT NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    INSERT INTO users (id, name, email, password_hash) VALUES (42, 'Client existant', 'existing@example.test', 'hashed-placeholder');
    INSERT INTO products (id, name, description, price_cents, image_url, category)
      VALUES (42, 'Produit existant', 'À préserver', 1250, 'https://images.unsplash.com/photo-1514228742587-6b1558fCCA3d?auto=format', 'Maison');
    INSERT INTO orders (id, user_id, total_cents) VALUES (42, 42, 1250);
    INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
      VALUES (42, 42, 'Produit existant', 1250, 1);
  `);
  legacyDb.close();
  await startServer(legacyDatabasePath);
  const migratedProduct = await (await fetch(`${baseUrl}/api/products/42`)).json();
  assert.equal(migratedProduct.stock, 20);
  const migratedDb = new DatabaseSync(legacyDatabasePath);
  assert.equal(migratedDb.prepare("SELECT email FROM users WHERE id = 42").get().email, "existing@example.test");
  assert.equal(migratedDb.prepare("SELECT total_cents FROM orders WHERE id = 42").get().total_cents, 1250);
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM order_items WHERE order_id = 42").get().count, 1);
  assert.match(migratedProduct.imageUrl, /6b1558fcca3d/);
  assert.deepEqual(migratedDb.prepare("PRAGMA foreign_key_check").all(), []);
  migratedDb.close();
});
