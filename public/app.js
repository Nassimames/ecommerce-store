const money = (amount) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

const getCart = () => {
  try {
    const cart = JSON.parse(localStorage.getItem("atelier-cart") || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch (error) {
    console.error("Impossible de lire le panier local.", error);
    return [];
  }
};

const saveCart = (cart) => {
  localStorage.setItem("atelier-cart", JSON.stringify(cart));
  updateCartCount();
};

const updateCartCount = () => {
  const count = getCart().reduce((total, item) => total + Number(item.quantity || 0), 0);
  document.querySelectorAll("[data-cart-count]").forEach((element) => {
    element.textContent = String(count);
  });
};

const setMessage = (message) => {
  const element = document.querySelector("[data-message]");
  if (element) element.textContent = message;
};

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Une erreur est survenue.");
  return result;
};

const renderProductCard = (product) => `
  <article class="product-card">
    <a class="product-image-wrap" href="/product.html?id=${product.id}" aria-label="Voir ${escapeHtml(product.name)}">
      <img class="product-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">
      <span class="product-category">${escapeHtml(product.category)}</span>
    </a>
    <div class="product-info">
      <div><h3><a href="/product.html?id=${product.id}">${escapeHtml(product.name)}</a></h3><p>${escapeHtml(product.category)}</p></div>
      <span class="product-price">${money(product.price)}</span>
    </div>
  </article>
`;

async function showProducts() {
  const grid = document.querySelector("[data-product-grid]");
  if (!grid) return;
  try {
    const products = await api("/api/products");
    grid.innerHTML = products.map(renderProductCard).join("");
  } catch (error) {
    grid.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  }
}

async function showProduct() {
  const container = document.querySelector("[data-product-detail]");
  if (!container) return;
  const id = new URLSearchParams(location.search).get("id");
  try {
    const product = await api(`/api/products/${encodeURIComponent(id || "")}`);
    document.title = `${product.name} — Atelier`;
    container.innerHTML = `
      <img class="detail-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">
      <div class="detail-copy">
        <span class="detail-category">${escapeHtml(product.category)}</span>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="detail-price">${money(product.price)}</p>
        <p class="detail-description">${escapeHtml(product.description)}</p>
        <p class="detail-description">Une pièce choisie avec soin. Expédition sous 2 à 4 jours ouvrés.</p>
        <div class="detail-buy">
          <label class="visually-hidden" for="product-quantity">Quantité</label>
          <input class="quantity-input" id="product-quantity" type="number" min="1" max="20" value="1">
          <button class="button button-dark" type="button" data-add-product>Ajouter au panier <span aria-hidden="true">↗</span></button>
        </div>
        <p class="notice" data-message role="status" aria-live="polite"></p>
      </div>
    `;
    container.querySelector("[data-add-product]").addEventListener("click", () => {
      const quantity = Number(container.querySelector("#product-quantity").value);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        setMessage("Choisissez une quantité entre 1 et 20.");
        return;
      }
      const cart = getCart();
      const existing = cart.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity + quantity > 20) {
          setMessage("La quantité maximale par produit est de 20.");
          return;
        }
        existing.quantity += quantity;
      } else {
        cart.push({ productId: product.id, quantity });
      }
      saveCart(cart);
      setMessage("Ajouté au panier.");
    });
  } catch (error) {
    container.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  }
}

async function showCart() {
  const container = document.querySelector("[data-cart-content]");
  if (!container) return;
  const cart = getCart();
  if (!cart.length) {
    container.innerHTML = '<div class="cart-empty">Votre panier est encore vide. <a class="text-link" href="/#boutique">Voir la boutique →</a></div>';
    return;
  }
  try {
    const products = await api("/api/products");
    const productMap = new Map(products.map((product) => [product.id, product]));
    const validCart = cart.filter((item) => productMap.has(item.productId));
    if (validCart.length !== cart.length) saveCart(validCart);
    const total = validCart.reduce((sum, item) => sum + productMap.get(item.productId).price * item.quantity, 0);
    const rows = validCart.map((item) => {
      const product = productMap.get(item.productId);
      return `
        <article class="cart-item" data-cart-item="${product.id}">
          <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">
          <div><h3>${escapeHtml(product.name)}</h3><p>${money(product.price)}</p>
            <div class="quantity-controls">
              <button type="button" data-quantity="-1" aria-label="Diminuer la quantité">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-quantity="1" aria-label="Augmenter la quantité">+</button>
            </div>
            <button class="remove-item" type="button" data-remove>Retirer</button>
          </div>
          <strong>${money(product.price * item.quantity)}</strong>
        </article>
      `;
    }).join("");
    container.innerHTML = `
      <div class="cart-items">${rows}</div>
      <aside class="cart-summary">
        <h2>Récapitulatif</h2>
        <div class="summary-line"><span>Sous-total</span><span>${money(total)}</span></div>
        <div class="summary-line"><span>Livraison</span><span>Offerte</span></div>
        <div class="summary-total"><span>Total</span><span>${money(total)}</span></div>
        <button class="button button-dark button-full" type="button" data-checkout>Commander <span aria-hidden="true">↗</span></button>
        <p class="notice" data-message role="status" aria-live="polite"></p>
      </aside>
    `;
    container.querySelectorAll("[data-cart-item]").forEach((row) => {
      const productId = Number(row.dataset.cartItem);
      row.querySelectorAll("[data-quantity]").forEach((button) => {
        button.addEventListener("click", () => {
          const nextCart = getCart().map((item) => item.productId === productId
            ? { ...item, quantity: item.quantity + Number(button.dataset.quantity) }
            : item).filter((item) => item.quantity > 0);
          if (nextCart.some((item) => item.quantity > 20)) {
            setMessage("La quantité maximale par produit est de 20.");
            return;
          }
          saveCart(nextCart);
          showCart();
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        saveCart(getCart().filter((item) => item.productId !== productId));
        showCart();
      });
    });
    container.querySelector("[data-checkout]").addEventListener("click", checkout);
  } catch (error) {
    container.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  }
}

async function checkout() {
  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: getCart() })
    });
    saveCart([]);
    const container = document.querySelector("[data-cart-content]");
    container.innerHTML = `
      <div class="account-panel">
        <p class="eyebrow">COMMANDE CONFIRMÉE</p>
        <h1>Merci pour votre commande !</h1>
        <p>Votre commande n° ${result.order.id} a bien été enregistrée pour un total de ${money(result.order.total)}.</p>
        <a class="button button-dark" href="/orders.html">Voir mes commandes</a>
      </div>
    `;
  } catch (error) {
    if (error.message === "Connectez-vous pour continuer.") {
      location.href = `/auth.html?next=${encodeURIComponent("/cart.html")}`;
      return;
    }
    setMessage(error.message);
  }
}

let registering = false;

async function showAccount() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;
  try {
    const { user } = await api("/api/me");
    if (user) {
      document.querySelector(".auth-card").innerHTML = `
        <div class="account-panel">
          <p class="eyebrow">VOTRE ESPACE</p>
          <h1>Bonjour ${escapeHtml(user.name)}.</h1>
          <p>${escapeHtml(user.email)}</p>
          <div class="account-links"><a href="/orders.html">Mes commandes</a><a href="/">Continuer mes achats</a></div>
          <button class="button button-dark" type="button" data-logout>Se déconnecter</button>
          <p class="notice" data-message role="status"></p>
        </div>
      `;
      document.querySelector("[data-logout]").addEventListener("click", async () => {
        try {
          await api("/api/logout", { method: "POST" });
          location.reload();
        } catch (error) {
          setMessage(error.message);
        }
      });
      return;
    }
  } catch (error) {
    setMessage(error.message);
  }

  const switchButton = document.querySelector("[data-auth-switch]");
  const updateMode = () => {
    document.querySelectorAll(".register-only").forEach((element) => {
      element.hidden = !registering;
      if (element.tagName === "INPUT") element.required = registering;
    });
    document.querySelector("[data-auth-title]").textContent = registering ? "Créer mon compte." : "Ravi de vous revoir.";
    document.querySelector("[data-auth-submit]").textContent = registering ? "Créer mon compte" : "Se connecter";
    form.querySelector("#password").autocomplete = registering ? "new-password" : "current-password";
    switchButton.textContent = registering ? "J'ai déjà un compte" : "Créer un compte";
    setMessage("");
  };
  switchButton.addEventListener("click", () => {
    registering = !registering;
    updateMode();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    try {
      await api(registering ? "/api/register" : "/api/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") ? next : "/orders.html";
    } catch (error) {
      setMessage(error.message);
    }
  });
  updateMode();
}

async function showOrders() {
  const container = document.querySelector("[data-orders-list]");
  if (!container) return;
  try {
    const orders = await api("/api/orders");
    if (!orders.length) {
      container.innerHTML = '<p class="cart-empty">Vous n’avez pas encore passé de commande. <a class="text-link" href="/#boutique">Découvrir la boutique →</a></p>';
      return;
    }
    container.innerHTML = orders.map((order) => `
      <article class="order-card">
        <div class="order-card-header"><span>Commande n° ${order.id}</span><span>${money(order.total)}</span></div>
        <div class="order-card-items">${order.items.map((item) => `<span>${escapeHtml(item.name)} × ${item.quantity} — ${money(item.unitPrice * item.quantity)}</span>`).join("")}</div>
      </article>
    `).join("");
  } catch (error) {
    if (error.message === "Connectez-vous pour continuer.") {
      location.href = `/auth.html?next=${encodeURIComponent("/orders.html")}`;
      return;
    }
    container.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
  }
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});
updateCartCount();
api("/api/me").then(({ user }) => {
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    if (user) {
      link.textContent = "Mon espace";
      link.href = "/auth.html";
    }
  });
}).catch((error) => {
  console.error("Impossible de vérifier la session.", error);
});

const page = document.body.dataset.page;
if (page === "home") showProducts();
if (page === "product") showProduct();
if (page === "cart") showCart();
if (page === "auth") showAccount();
if (page === "orders") showOrders();
