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

const icon = (name) => {
  const icons = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.7 4.7 0 0 1 12 6a4.7 4.7 0 0 1 8.8 2.8Z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>'
  };
  return icons[name];
};

const getCart = () => {
  try {
    const raw = JSON.parse(localStorage.getItem("atelier-cart") || "[]");
    if (!Array.isArray(raw)) throw new TypeError("Le format du panier doit être une liste.");
    const quantities = new Map();
    raw.forEach((item) => {
      const productId = Number(item && item.productId);
      const quantity = Number(item && item.quantity);
      if (Number.isSafeInteger(productId) && productId > 0 &&
          Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 20) {
        quantities.set(productId, Math.min(20, (quantities.get(productId) || 0) + quantity));
      }
    });
    const cart = [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
    if (JSON.stringify(raw) !== JSON.stringify(cart)) {
      localStorage.setItem("atelier-cart", JSON.stringify(cart));
    }
    return cart;
  } catch (error) {
    console.error("Impossible de lire le panier local.", error);
    try {
      localStorage.removeItem("atelier-cart");
    } catch (storageError) {
      console.error("Impossible de réinitialiser le panier local.", storageError);
    }
    return [];
  }
};

const updateCartCount = () => {
  const count = getCart().reduce((total, item) => total + item.quantity, 0);
  document.querySelectorAll("[data-cart-count]").forEach((element) => {
    element.textContent = String(count);
    element.setAttribute("aria-label", `${count} article${count === 1 ? "" : "s"} dans le panier`);
  });
};

const saveCart = (cart) => {
  try {
    localStorage.setItem("atelier-cart", JSON.stringify(cart));
  } catch (error) {
    console.error("Impossible d'enregistrer le panier local.", error);
    notify("Le panier n'a pas pu être enregistré sur cet appareil.", "error");
  }
  updateCartCount();
};

let toastTimer;
const notify = (message, tone = "success") => {
  let toast = document.querySelector("[data-toast]");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.toast = "";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
};

const setMessage = (message, tone = "error") => {
  const element = document.querySelector("[data-message]");
  if (element) {
    element.textContent = message;
    element.dataset.tone = tone;
  }
  if (message) notify(message, tone);
};

const api = async (url, options = {}) => {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers }
    });
  } catch (error) {
    throw new Error("Impossible de joindre la boutique. Vérifiez votre connexion et réessayez.");
  }
  if (response.status === 204) return null;
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Le serveur a renvoyé une réponse invalide.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "Une erreur est survenue.");
    error.code = result.code;
    error.status = response.status;
    throw error;
  }
  return result;
};

let currentUser = null;
let favoriteIds = new Set();

const signInFor = (target = `${location.pathname}${location.search}${location.hash}`) => {
  location.href = `/auth.html?next=${encodeURIComponent(target)}`;
};

const renderProductCard = (product) => {
  const favorite = favoriteIds.has(product.id);
  const stockLabel = product.stock > 0
    ? product.stock <= 5 ? `Plus que ${product.stock} en stock` : "En stock"
    : "Épuisé";
  return `
    <article class="product-card">
      <div class="product-image-wrap">
        <a class="product-image-link" href="/product.html?id=${product.id}" aria-label="Voir ${escapeHtml(product.name)}">
          <img class="product-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">
          <span class="product-category">${escapeHtml(product.category)}</span>
        </a>
        <button class="favorite-button ${favorite ? "is-favorite" : ""}" type="button"
          data-favorite="${product.id}" aria-label="${favorite ? "Retirer" : "Ajouter"} ${escapeHtml(product.name)} ${favorite ? "des" : "aux"} favoris" aria-pressed="${favorite}">
          ${icon("heart")}
        </button>
      </div>
      <div class="product-info">
        <div class="product-heading"><h3><a href="/product.html?id=${product.id}">${escapeHtml(product.name)}</a></h3><span class="product-price">${money(product.price)}</span></div>
        <div class="product-meta"><span>${escapeHtml(product.category)}</span><span class="${product.stock > 0 ? "stock-available" : "stock-empty"}">${stockLabel}</span></div>
        <button class="quick-add" type="button" data-add-cart="${product.id}" ${product.stock < 1 ? "disabled" : ""}>
          ${icon("bag")} ${product.stock < 1 ? "Indisponible" : "Ajouter au panier"}
        </button>
      </div>
    </article>
  `;
};

const bindProductActions = (container, products) => {
  container.querySelectorAll("[data-add-cart]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = products.find((entry) => entry.id === Number(button.dataset.addCart));
      if (product) addProductToCart(product, 1);
    });
  });
  container.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", () => toggleFavorite(Number(button.dataset.favorite)));
  });
};

const addProductToCart = (product, quantity) => {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
    setMessage("Choisissez une quantité valide.", "error");
    return false;
  }
  if (product.stock < 1) {
    setMessage("Ce produit est momentanément indisponible.", "error");
    return false;
  }
  const cart = getCart();
  const existing = cart.find((item) => item.productId === product.id);
  const nextQuantity = (existing ? existing.quantity : 0) + quantity;
  if (nextQuantity > 20 || nextQuantity > product.stock) {
    setMessage(`Quantité indisponible. Stock actuel : ${product.stock}.`, "error");
    return false;
  }
  if (existing) existing.quantity = nextQuantity;
  else cart.push({ productId: product.id, quantity });
  saveCart(cart);
  notify(`${product.name} ajouté au panier.`, "success");
  return true;
};

async function toggleFavorite(productId) {
  if (!currentUser) {
    signInFor();
    return;
  }
  const isFavorite = favoriteIds.has(productId);
  try {
    await api(`/api/favorites/${productId}`, { method: isFavorite ? "DELETE" : "POST" });
    if (isFavorite) favoriteIds.delete(productId);
    else favoriteIds.add(productId);
    document.querySelectorAll(`[data-favorite="${productId}"]`).forEach((button) => {
      button.classList.toggle("is-favorite", !isFavorite);
      button.setAttribute("aria-pressed", String(!isFavorite));
      if (button.classList.contains("detail-favorite")) {
        button.innerHTML = `${icon("heart")} ${isFavorite ? "Ajouter à mes favoris" : "Dans mes favoris"}`;
      }
    });
    const homeGrid = document.querySelector("[data-product-grid]");
    if (homeGrid) renderCatalog();
    const favoritesGrid = document.querySelector("[data-favorites-grid]");
    if (favoritesGrid) showFavorites();
    notify(isFavorite ? "Retiré de vos favoris." : "Ajouté à vos favoris.", "success");
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") signInFor();
    else setMessage(error.message, "error");
  }
}

let catalogProducts = [];
let catalogCategory = "";
let catalogSearch = "";
let catalogSort = "relevance";

function renderCatalog() {
  const grid = document.querySelector("[data-product-grid]");
  if (!grid) return;
  const normalizedSearch = catalogSearch.trim().toLocaleLowerCase("fr");
  const filtered = catalogProducts.filter((product) => {
    const matchesSearch = !normalizedSearch ||
      `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("fr").includes(normalizedSearch);
    return matchesSearch && (!catalogCategory || product.category === catalogCategory);
  });
  if (catalogSort === "price-asc") filtered.sort((a, b) => a.price - b.price || a.id - b.id);
  if (catalogSort === "price-desc") filtered.sort((a, b) => b.price - a.price || a.id - b.id);
  if (catalogSort === "newest") filtered.sort((a, b) => b.id - a.id);
  if (catalogSort === "relevance" && normalizedSearch) {
    filtered.sort((a, b) => Number(!a.name.toLocaleLowerCase("fr").includes(normalizedSearch)) -
      Number(!b.name.toLocaleLowerCase("fr").includes(normalizedSearch)));
  }
  const count = document.querySelector("[data-catalog-count]");
  if (count) count.textContent = `${filtered.length} article${filtered.length === 1 ? "" : "s"}`;
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-mark" aria-hidden="true">⌕</span><h3>Aucun résultat</h3><p>Essayez un autre mot-clé ou choisissez une autre catégorie.</p><button type="button" class="text-button" data-clear-filters>Effacer les filtres</button></div>`;
    grid.querySelector("[data-clear-filters]").addEventListener("click", () => {
      catalogCategory = "";
      catalogSearch = "";
      const search = document.querySelector("[data-search]");
      if (search) search.value = "";
      const filter = document.querySelector("[data-category-filter]");
      if (filter) filter.value = "";
      renderCatalog();
      renderCategoryChips();
    });
    return;
  }
  grid.innerHTML = filtered.map(renderProductCard).join("");
  bindProductActions(grid, filtered);
}

function renderCategoryChips(categories) {
  const chips = document.querySelector("[data-category-chips]");
  if (!chips) return;
  chips.innerHTML = ["", ...categories].map((category) => `
    <button type="button" class="category-chip ${catalogCategory === category ? "is-active" : ""}"
      data-category-chip="${escapeHtml(category)}">${category ? escapeHtml(category) : "Tout voir"}</button>
  `).join("");
  chips.querySelectorAll("[data-category-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      catalogCategory = button.dataset.categoryChip;
      const select = document.querySelector("[data-category-filter]");
      if (select) select.value = catalogCategory;
      renderCatalog();
      renderCategoryChips(categories);
    });
  });
}

async function showProducts() {
  const grid = document.querySelector("[data-product-grid]");
  if (!grid) return;
  try {
    catalogProducts = await api("/api/products");
    const categories = [...new Set(catalogProducts.map((product) => product.category))].sort((a, b) => a.localeCompare(b, "fr"));
    const select = document.querySelector("[data-category-filter]");
    if (select) {
      select.innerHTML = '<option value="">Toutes</option>' +
        categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
      select.addEventListener("change", () => {
        catalogCategory = select.value;
        renderCatalog();
        renderCategoryChips(categories);
      });
    }
    document.querySelector("[data-search]")?.addEventListener("input", (event) => {
      catalogSearch = event.target.value;
      renderCatalog();
    });
    document.querySelector("[data-sort]")?.addEventListener("change", (event) => {
      catalogSort = event.target.value;
      renderCatalog();
    });
    renderCategoryChips(categories);
    renderCatalog();
    showRecentlyViewed(catalogProducts);
  } catch (error) {
    grid.innerHTML = `<div class="empty-state"><h3>La collection est momentanément indisponible.</h3><p>${escapeHtml(error.message)}</p><button class="button button-light" type="button" data-retry>Réessayer</button></div>`;
    grid.querySelector("[data-retry]").addEventListener("click", showProducts);
  }
}

function getRecentlyViewed() {
  try {
    const value = JSON.parse(localStorage.getItem("atelier-recent") || "[]");
    return Array.isArray(value) ? value.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 6) : [];
  } catch (error) {
    console.error("Impossible de lire les produits récemment consultés.", error);
    return [];
  }
}

function showRecentlyViewed(products) {
  const recentIds = getRecentlyViewed();
  const recent = recentIds.map((id) => products.find((product) => product.id === id)).filter(Boolean);
  const section = document.querySelector("[data-recent-section]");
  const grid = document.querySelector("[data-recent-grid]");
  if (!section || !grid || !recent.length) return;
  section.hidden = false;
  grid.innerHTML = recent.map(renderProductCard).join("");
  bindProductActions(grid, recent);
}

async function showProduct() {
  const container = document.querySelector("[data-product-detail]");
  if (!container) return;
  const id = new URLSearchParams(location.search).get("id");
  try {
    const product = await api(`/api/products/${encodeURIComponent(id || "")}`);
    document.title = `${product.name} — Atelier`;
    try {
      const recent = getRecentlyViewed().filter((productId) => productId !== product.id);
      localStorage.setItem("atelier-recent", JSON.stringify([product.id, ...recent].slice(0, 6)));
    } catch (error) {
      console.error("Impossible d'enregistrer les produits récemment consultés.", error);
    }
    container.innerHTML = `
      <div class="detail-media">
        <img class="detail-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">
        <span class="detail-image-note">Un objet choisi avec soin</span>
      </div>
      <div class="detail-copy">
        <a class="detail-category" href="/#boutique">${escapeHtml(product.category)}</a>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="detail-price">${money(product.price)}</p>
        <p class="detail-description">${escapeHtml(product.description)}</p>
        <p class="detail-stock ${product.stock > 0 ? "stock-available" : "stock-empty"}">${product.stock > 0 ? `${product.stock} pièce${product.stock === 1 ? "" : "s"} disponible${product.stock === 1 ? "" : "s"}` : "Momentanément indisponible"}</p>
        <div class="detail-buy">
          <label class="visually-hidden" for="product-quantity">Quantité</label>
          <input class="quantity-input" id="product-quantity" type="number" min="1" max="${Math.min(20, product.stock)}" value="1" ${product.stock < 1 ? "disabled" : ""}>
          <button class="button button-dark" type="button" data-add-product ${product.stock < 1 ? "disabled" : ""}>Ajouter au panier <span aria-hidden="true">↗</span></button>
        </div>
        <button class="detail-favorite ${favoriteIds.has(product.id) ? "is-favorite" : ""}" type="button" data-favorite="${product.id}" aria-pressed="${favoriteIds.has(product.id)}">${icon("heart")} ${favoriteIds.has(product.id) ? "Dans mes favoris" : "Ajouter à mes favoris"}</button>
        <p class="notice" data-message role="status" aria-live="polite"></p>
      </div>
    `;
    container.querySelector("[data-add-product]").addEventListener("click", () => {
      const quantity = Number(container.querySelector("#product-quantity").value);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > product.stock || quantity > 20) {
        setMessage(`Choisissez une quantité entre 1 et ${Math.min(20, product.stock)}.`, "error");
        return;
      }
      if (addProductToCart(product, quantity)) {
        container.querySelector("#product-quantity").value = "1";
      }
    });
    container.querySelector("[data-favorite]").addEventListener("click", () => toggleFavorite(product.id));
    const related = catalogProducts.length ? catalogProducts : await api("/api/products");
    const relatedProducts = related.filter((entry) => entry.id !== product.id && entry.category === product.category).slice(0, 3);
    if (relatedProducts.length) {
      container.insertAdjacentHTML("afterend", `
        <section class="related-section">
          <div class="section-heading"><div><p class="eyebrow">DANS LE MÊME ESPRIT</p><h2>À découvrir aussi</h2></div></div>
          <div class="product-grid" data-related-grid></div>
        </section>
      `);
      const relatedGrid = container.parentElement.querySelector("[data-related-grid]");
      relatedGrid.innerHTML = relatedProducts.map(renderProductCard).join("");
      bindProductActions(relatedGrid, relatedProducts);
    }
  } catch (error) {
    container.innerHTML = `<div class="empty-state"><h2>Produit introuvable</h2><p>${escapeHtml(error.message)}</p><a class="button button-dark" href="/#boutique">Retour à la boutique</a></div>`;
  }
}

async function showCart() {
  const container = document.querySelector("[data-cart-content]");
  if (!container) return;
  const cart = getCart();
  if (!cart.length) {
    container.innerHTML = `
      <div class="empty-state cart-empty-state">
        <span class="empty-mark" aria-hidden="true">${icon("bag")}</span>
        <h2>Votre panier prend son temps.</h2>
        <p>Les belles trouvailles vous attendent dans la boutique.</p>
        <a class="button button-dark" href="/#boutique">Découvrir la collection <span aria-hidden="true">↗</span></a>
      </div>`;
    return;
  }
  try {
    const products = await api("/api/products");
    const productMap = new Map(products.map((product) => [product.id, product]));
    let changed = false;
    const validCart = [];
    cart.forEach((item) => {
      const product = productMap.get(item.productId);
      if (!product || product.stock < 1) {
        changed = true;
        return;
      }
      if (item.quantity > product.stock) {
        validCart.push({ ...item, quantity: product.stock });
        changed = true;
        return;
      }
      validCart.push(item);
    });
    if (changed) {
      saveCart(validCart);
      notify("Votre panier a été actualisé selon les disponibilités du moment.", "info");
    }
    if (!validCart.length) return showCart();

    const total = validCart.reduce((sum, item) => sum + productMap.get(item.productId).price * item.quantity, 0);
    const rows = validCart.map((item) => {
      const product = productMap.get(item.productId);
      return `
        <article class="cart-item" data-cart-item="${product.id}">
          <a href="/product.html?id=${product.id}"><img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}"></a>
          <div class="cart-item-details"><h2><a href="/product.html?id=${product.id}">${escapeHtml(product.name)}</a></h2><p>${money(product.price)} / pièce</p>
            <span class="cart-stock ${product.stock <= 5 ? "stock-low" : "stock-available"}">${product.stock <= 5 ? `${product.stock} disponible${product.stock === 1 ? "" : "s"}` : "En stock"}</span>
            <div class="quantity-controls">
              <button type="button" data-quantity="-1" aria-label="Diminuer la quantité de ${escapeHtml(product.name)}">−</button>
              <span aria-live="polite">${item.quantity}</span>
              <button type="button" data-quantity="1" aria-label="Augmenter la quantité de ${escapeHtml(product.name)}" ${item.quantity >= Math.min(20, product.stock) ? "disabled" : ""}>+</button>
            </div>
            <button class="remove-item" type="button" data-remove>Retirer</button>
          </div>
          <strong class="cart-line-total">${money(product.price * item.quantity)}</strong>
        </article>`;
    }).join("");
    container.innerHTML = `
      <div class="cart-items">${rows}<a class="continue-shopping" href="/#boutique">← Continuer mes achats</a></div>
      <aside class="cart-summary">
        <p class="eyebrow">RÉCAPITULATIF</p><h2>Votre commande</h2>
        <div class="summary-line"><span>Sous-total</span><span>${money(total)}</span></div>
        <div class="summary-line"><span>Livraison</span><span>Non calculée</span></div>
        <div class="summary-total"><span>Total des articles</span><span>${money(total)}</span></div>
        <p class="summary-note">Livraison et paiement en ligne ne sont pas configurés pour cette démo.</p>
        <button class="button button-dark button-full" type="button" data-checkout>Confirmer la commande <span aria-hidden="true">↗</span></button>
        <p class="notice" data-message role="status" aria-live="polite"></p>
      </aside>`;
    container.querySelectorAll("[data-cart-item]").forEach((row) => {
      const productId = Number(row.dataset.cartItem);
      row.querySelectorAll("[data-quantity]").forEach((button) => {
        button.addEventListener("click", () => {
          const nextCart = getCart().map((item) => item.productId === productId
            ? { ...item, quantity: item.quantity + Number(button.dataset.quantity) }
            : item).filter((item) => item.quantity > 0);
          saveCart(nextCart);
          showCart();
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        saveCart(getCart().filter((item) => item.productId !== productId));
        notify("Article retiré du panier.", "info");
        showCart();
      });
    });
    container.querySelector("[data-checkout]").addEventListener("click", checkout);
  } catch (error) {
    container.innerHTML = `<div class="empty-state"><h2>Impossible de charger votre panier.</h2><p>${escapeHtml(error.message)}</p><button class="button button-light" type="button" data-retry>Réessayer</button></div>`;
    container.querySelector("[data-retry]").addEventListener("click", showCart);
  }
}

async function checkout(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Confirmation en cours…";
  try {
    let key;
    try {
      key = sessionStorage.getItem("atelier-order-key");
      if (!key) {
        key = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem("atelier-order-key", key);
      }
    } catch (error) {
      console.error("Le navigateur ne permet pas de conserver la clé de commande.", error);
      key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: getCart(), idempotencyKey: key })
    });
    saveCart([]);
    try {
      sessionStorage.removeItem("atelier-order-key");
    } catch (error) {
      console.error("Impossible de nettoyer la clé de commande.", error);
    }
    const container = document.querySelector("[data-cart-content]");
    container.innerHTML = `
      <div class="order-confirmation">
        <span class="confirmation-check" aria-hidden="true">✓</span>
        <p class="eyebrow">COMMANDE CONFIRMÉE</p>
        <h1>Merci pour votre commande.</h1>
        <p>La commande n° ${result.order.id} est enregistrée pour un total d'articles de <strong>${money(result.order.total)}</strong>.</p>
        <div class="confirmation-actions"><a class="button button-dark" href="/order.html?id=${result.order.id}">Voir ma commande</a><a class="text-link" href="/#boutique">Continuer mes achats</a></div>
      </div>`;
    notify("Votre commande a bien été confirmée.", "success");
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") {
      signInFor("/cart.html");
      return;
    }
    if (error.code === "INSUFFICIENT_STOCK" || error.code === "PRODUCT_NOT_FOUND") {
      await showCart();
    }
    setMessage(error.message, "error");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = 'Confirmer la commande <span aria-hidden="true">↗</span>';
    }
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
          <p class="eyebrow">VOTRE ESPACE</p><h1>Bonjour ${escapeHtml(user.name)}.</h1>
          <p>${escapeHtml(user.email)}</p>
          <div class="account-links"><a class="button button-dark" href="/account.html">Ouvrir mon espace</a><a href="/orders.html">Mes commandes</a></div>
          <button class="text-button" type="button" data-logout>Se déconnecter</button>
        </div>`;
      document.querySelector("[data-logout]").addEventListener("click", logout);
      return;
    }
  } catch (error) {
    setMessage(error.message, "error");
  }

  const switchButton = document.querySelector("[data-auth-switch]");
  const passwordToggle = document.querySelector("[data-password-toggle]");
  const updateMode = () => {
    document.querySelectorAll(".register-only").forEach((element) => {
      element.hidden = !registering;
      if (element.tagName === "INPUT") element.required = registering;
    });
    document.querySelector("[data-auth-title]").textContent = registering ? "Créer mon compte." : "Ravi de vous revoir.";
    document.querySelector("[data-auth-submit]").textContent = registering ? "Créer mon compte" : "Se connecter";
    form.querySelector("#password").autocomplete = registering ? "new-password" : "current-password";
    switchButton.textContent = registering ? "J'ai déjà un compte" : "Créer un compte";
  };
  switchButton.addEventListener("click", () => {
    registering = !registering;
    updateMode();
    setMessage("");
  });
  passwordToggle.addEventListener("click", () => {
    const password = form.querySelector("#password");
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    passwordToggle.textContent = show ? "Masquer" : "Afficher";
    passwordToggle.setAttribute("aria-label", `${show ? "Masquer" : "Afficher"} le mot de passe`);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("[data-auth-submit]");
    submit.disabled = true;
    submit.textContent = "Veuillez patienter…";
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      await api(registering ? "/api/register" : "/api/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account.html";
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      submit.disabled = false;
      submit.textContent = registering ? "Créer mon compte" : "Se connecter";
    }
  });
  updateMode();
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
    location.href = "/";
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function showDashboard() {
  try {
    const dashboard = await api("/api/dashboard");
    document.querySelector("[data-dashboard-name]").textContent = dashboard.user.name;
    document.querySelector("[data-dashboard-email]").textContent = dashboard.user.email;
    document.querySelector("[data-order-count]").textContent = String(dashboard.orderCount);
    document.querySelector("[data-favorite-count]").textContent = String(dashboard.favoriteCount);
    const orders = document.querySelector("[data-dashboard-orders]");
    orders.innerHTML = dashboard.recentOrders.length
      ? dashboard.recentOrders.map((order) => `
        <a class="dashboard-order" href="/order.html?id=${order.id}">
          <span><strong>Commande n° ${order.id}</strong><small>${new Date(`${order.createdAt}Z`).toLocaleDateString("fr-FR")}</small></span>
          <span class="dashboard-order-end"><strong>${money(order.total)}</strong><span class="order-status">${escapeHtml(order.status)}</span></span>
        </a>`).join("")
      : '<div class="empty-state compact-empty"><h3>Votre première commande vous attend.</h3><p>Explorez la sélection pour trouver votre prochain essentiel.</p><a class="text-link" href="/#boutique">Découvrir la boutique →</a></div>';
    document.querySelector("[data-logout]").addEventListener("click", logout);
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") signInFor("/account.html");
    else setMessage(error.message, "error");
  }
}

async function showFavorites() {
  const grid = document.querySelector("[data-favorites-grid]");
  if (!grid) return;
  try {
    const products = await api("/api/favorites");
    favoriteIds = new Set(products.map((product) => product.id));
    if (!products.length) {
      grid.innerHTML = `
        <div class="empty-state"><span class="empty-mark" aria-hidden="true">${icon("heart")}</span>
          <h2>Gardez vos belles découvertes.</h2><p>Ajoutez un produit à vos favoris pour le retrouver ici.</p>
          <a class="button button-dark" href="/#boutique">Explorer la boutique</a></div>`;
      return;
    }
    grid.innerHTML = products.map(renderProductCard).join("");
    bindProductActions(grid, products);
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") signInFor("/favorites.html");
    else grid.innerHTML = `<div class="empty-state"><h2>Impossible de charger vos favoris.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function showOrders() {
  const container = document.querySelector("[data-orders-list]");
  if (!container) return;
  try {
    const orders = await api("/api/orders");
    if (!orders.length) {
      container.innerHTML = `
        <div class="empty-state"><span class="empty-mark" aria-hidden="true">${icon("bag")}</span>
          <h2>Votre histoire Atelier commence ici.</h2><p>Vos commandes apparaîtront dans cet espace.</p>
          <a class="button button-dark" href="/#boutique">Découvrir la boutique</a></div>`;
      return;
    }
    container.innerHTML = orders.map((order) => `
      <a class="order-card" href="/order.html?id=${order.id}">
        <div class="order-card-header"><span>Commande n° ${order.id}<small>${new Date(`${order.createdAt}Z`).toLocaleDateString("fr-FR")}</small></span><strong>${money(order.total)}</strong></div>
        <div class="order-card-items">${order.items.map((item) => `<span>${escapeHtml(item.name)} × ${item.quantity}</span>`).join("")}</div>
        <span class="order-card-link">Voir le détail <span aria-hidden="true">→</span></span>
      </a>`).join("");
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") signInFor("/orders.html");
    else container.innerHTML = `<div class="empty-state"><h2>Impossible de charger vos commandes.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function showOrder() {
  const container = document.querySelector("[data-order-detail]");
  if (!container) return;
  const id = new URLSearchParams(location.search).get("id");
  try {
    const { order } = await api(`/api/orders/${encodeURIComponent(id || "")}`);
    container.innerHTML = `
      <p class="eyebrow">COMMANDE CONFIRMÉE</p>
      <div class="order-detail-heading"><h1 class="page-title">Commande n° ${order.id}</h1><span class="order-status">${escapeHtml(order.status)}</span></div>
      <p class="order-date">Passée le ${new Date(`${order.createdAt}Z`).toLocaleDateString("fr-FR", { dateStyle: "long" })}</p>
      <section class="order-detail-items" aria-label="Articles de la commande">
        ${order.items.map((item) => `
          <article class="order-detail-item"><div><h2>${escapeHtml(item.name)}</h2><p>${money(item.unitPrice)} × ${item.quantity}</p></div><strong>${money(item.unitPrice * item.quantity)}</strong></article>`).join("")}
        <div class="summary-total"><span>Total des articles</span><strong>${money(order.total)}</strong></div>
      </section>
      <p class="summary-note">Cette commande est confirmée. Aucun paiement en ligne n'a été effectué.</p>`;
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") signInFor(`/order.html?id=${encodeURIComponent(id || "")}`);
    else container.innerHTML = `<div class="empty-state"><h2>Commande introuvable</h2><p>${escapeHtml(error.message)}</p><a class="button button-dark" href="/orders.html">Retour à mes commandes</a></div>`;
  }
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

document.querySelector("[data-menu-toggle]")?.addEventListener("click", (event) => {
  const toggle = event.currentTarget;
  const open = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
  document.querySelector("[data-main-nav]")?.classList.toggle("is-open", open);
});

window.addEventListener("storage", (event) => {
  if (event.key === "atelier-cart") updateCartCount();
});

updateCartCount();
api("/api/me").then(async ({ user }) => {
  currentUser = user;
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    if (user) {
      link.textContent = "Mon espace";
      link.href = "/account.html";
    }
  });
  if (user) {
    try {
      const favorites = await api("/api/favorites");
      favoriteIds = new Set(favorites.map((product) => product.id));
      if (document.body.dataset.page === "home") renderCatalog();
    } catch (error) {
      console.error("Impossible de charger les favoris.", error);
    }
  }
}).catch((error) => {
  console.error("Impossible de vérifier la session.", error);
});

const page = document.body.dataset.page;
if (page === "home") showProducts();
if (page === "product") showProduct();
if (page === "cart") showCart();
if (page === "auth") showAccount();
if (page === "account") showDashboard();
if (page === "favorites") showFavorites();
if (page === "orders") showOrders();
if (page === "order") showOrder();
