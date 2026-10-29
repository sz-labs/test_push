(() => {
  const key = 'inventoryAccountToken';
  const base = String(window.__INVENTORY_CONFIG__?.apiBaseUrl || '').replace(/\/+$/, '');
  window.InventoryAPI = {
    loginUrl: new URL('./login.html', window.location.href).href,
    homeUrl: new URL('./index.html', window.location.href).href,
    setToken(value) { sessionStorage.setItem(key, value); },
    clearToken() { sessionStorage.removeItem(key); },
    fetch(url, options = {}) {
      const headers = new Headers(options.headers || {});
      const token = sessionStorage.getItem(key);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(base + url, { ...options, headers, credentials: 'omit' });
    },
  };
})();
